#ifndef NATIVE_BUILD

#include "WsServer.h"

#include <Arduino.h>

#include "Version.h"

namespace botforge {

void WsServer::begin(Config& config, Net& net, ModuleRegistry& modules,
                     VmHooks hooks) {
  config_ = &config;
  net_ = &net;
  modules_ = &modules;
  hooks_ = hooks;

  ws_.begin();
  ws_.onEvent([this](uint8_t num, WStype_t type, uint8_t* payload,
                     size_t length) { onEvent(num, type, payload, length); });
  logf(LOG_INFO, "ws: server up on :81 (/ws)");
}

void WsServer::tick(uint32_t now) {
  now_ = now;
  ws_.loop();

  // §5.4 safety: manual mode + 800 ms silence => motors stop. Edge-triggered
  // so the stop (and its log line) fires once per dropout.
  if (manual_ && deadman_.shouldTrip(now)) {
    JsonDocument empty;
    modules_->actAll("stop", empty.as<JsonObjectConst>());
    logf(LOG_WARN, "ws: deadman tripped, motors stopped");
  }

  if (static_cast<uint32_t>(now - lastTelemetry_) >= kTelemetryMs) {
    lastTelemetry_ = now;
    if (ws_.connectedClients() > 0) sendTelemetry();
  }
}

void WsServer::onEvent(uint8_t num, WStype_t type, uint8_t* payload,
                       size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      logf(LOG_INFO, "ws: client %u connected", num);
      break;
    case WStype_DISCONNECTED:
      logf(LOG_INFO, "ws: client %u disconnected", num);
      break;
    case WStype_TEXT:
      handleMessage(num, reinterpret_cast<const char*>(payload), length);
      break;
    default:
      break;  // binary/fragments unused by the §5.4 protocol
  }
}

void WsServer::handleMessage(uint8_t num, const char* payload, size_t length) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err != DeserializationError::Ok) {
    logf(LOG_DEBUG, "ws: bad json from client %u", num);
    return;
  }
  const char* t = doc["t"] | "";
  JsonObjectConst msg = doc.as<JsonObjectConst>();

  if (strcmp(t, "hello") == 0) {
    sendHelloAck(num);
    return;
  }
  if (strcmp(t, "ping") == 0) {
    deadman_.feed(now_);
    return;
  }
  if (strcmp(t, "mode") == 0) {
    const char* mode = doc["mode"] | "";
    if (strcmp(mode, "manual") == 0) {
      manual_ = true;
      deadman_.arm(now_);
      if (hooks_.stopBehavior) hooks_.stopBehavior();
      logf(LOG_INFO, "ws: mode manual");
    } else if (strcmp(mode, "behavior") == 0) {
      manual_ = false;
      deadman_.disarm();  // behavior mode is unaffected by link loss (P8)
      if (hooks_.startBehavior) hooks_.startBehavior();
      logf(LOG_INFO, "ws: mode behavior");
    }
    return;
  }
  if (strcmp(t, "cmd.drive") == 0) {
    deadman_.feed(now_);
    modules_->actAll("drive", msg);
    return;
  }
  if (strcmp(t, "cmd.servo") == 0) {
    deadman_.feed(now_);
    IModule* mod = modules_->find(doc["id"] | "");
    if (mod != nullptr) mod->act("servo", msg);
    return;
  }
  if (strcmp(t, "cmd.led") == 0) {
    deadman_.feed(now_);
    modules_->actAll("led", msg);
    return;
  }
  if (strcmp(t, "cmd.tone") == 0) {
    deadman_.feed(now_);
    modules_->actAll("tone", msg);
    return;
  }
  logf(LOG_DEBUG, "ws: unknown message t=%s", t);
}

void WsServer::sendHelloAck(uint8_t num) {
  JsonDocument doc;
  doc["t"] = "hello.ack";
  doc["fw"] = BOTFORGE_FW_VERSION;
  doc["robot_id"] = config_->robotId();
  doc["name"] = config_->robotName();
  doc["cfg_hash"] = config_->cfgHash();
  String out;
  serializeJson(doc, out);
  ws_.sendTXT(num, out);
}

void WsServer::sendTelemetry() {
  JsonDocument doc;
  doc["t"] = "telemetry";

  // batt_mv comes from whichever module answers read("mv") — PowerMon.
  float mv = 0.0f;
  for (size_t i = 0; i < modules_->size(); ++i) {
    if (modules_->at(i)->read("mv", mv)) break;
    mv = 0.0f;
  }
  doc["batt_mv"] = static_cast<int>(mv);
  doc["rssi"] = net_->rssi();
  doc["mode"] = modeName();
  doc["behavior_running"] =
      hooks_.behaviorRunning ? hooks_.behaviorRunning() : false;

  // sensors: {<instance>: {<field>: value}} for every module that publishes
  // telemetry fields (space-separated list from the driver).
  JsonObject sensors = doc["sensors"].to<JsonObject>();
  for (size_t i = 0; i < modules_->size(); ++i) {
    const char* fields = modules_->at(i)->telemetryFields();
    if (fields == nullptr || fields[0] == '\0') continue;
    JsonObject inst = sensors[modules_->idAt(i)].to<JsonObject>();
    char buf[64];
    strncpy(buf, fields, sizeof(buf) - 1);
    buf[sizeof(buf) - 1] = '\0';
    char* save = nullptr;
    for (char* tok = strtok_r(buf, " ", &save); tok != nullptr;
         tok = strtok_r(nullptr, " ", &save)) {
      float v = 0.0f;
      if (modules_->at(i)->read(tok, v)) inst[tok] = v;
    }
  }

  String out;
  serializeJson(doc, out);
  ws_.broadcastTXT(out);
}

void WsServer::broadcastLog(LogLevel level, const char* msg) {
  if (ws_.connectedClients() == 0) return;
  JsonDocument doc;
  doc["t"] = "log";
  doc["level"] = RingLog::levelName(level);
  doc["msg"] = msg;
  String out;
  serializeJson(doc, out);
  ws_.broadcastTXT(out);
}

}  // namespace botforge

#endif  // NATIVE_BUILD
