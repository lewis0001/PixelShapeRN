#ifndef NATIVE_BUILD

#include "HttpApi.h"

#include <Arduino.h>

#include "Log.h"
#include "Ota.h"
#include "Version.h"

namespace botforge {

void HttpApi::begin(Config& config, Net& net, BehaviorCtl ctl) {
  config_ = &config;
  net_ = &net;
  ctl_ = ctl;

  server_.on("/api/info", HTTP_GET, [this]() { handleInfo(); });
  server_.on("/api/config", HTTP_GET, [this]() { handleGetConfig(); });
  server_.on("/api/config", HTTP_PUT, [this]() { handlePutConfig(); });
  server_.on("/api/behavior", HTTP_POST, [this]() { handleBehavior(); });
  server_.on("/api/behavior/ctl", HTTP_POST,
             [this]() { handleBehaviorCtl(); });
  server_.on(
      "/api/ota", HTTP_POST, [this]() { handleOtaDone(); },
      [this]() { Ota::handleUploadChunk(server_); });
  server_.on("/api/logs", HTTP_GET, [this]() { handleLogs(); });
  server_.onNotFound([this]() { handleNotFound(); });

  server_.begin();
  logf(LOG_INFO, "http: api up on :80");
}

void HttpApi::tick() { server_.handleClient(); }

void HttpApi::addCors() {
  // Allow any origin: the drive page runs from the website (§5.4).
  server_.sendHeader("Access-Control-Allow-Origin", "*");
  server_.sendHeader("Access-Control-Allow-Methods",
                     "GET, POST, PUT, OPTIONS");
  server_.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void HttpApi::sendJson(int code, const char* body) {
  addCors();
  server_.send(code, "application/json", body);
}

void HttpApi::handleInfo() {
  JsonDocument doc;
  doc["fw"] = BOTFORGE_FW_VERSION;
  doc["robot_id"] = config_->robotId();
  doc["name"] = config_->robotName();
  doc["cfg_hash"] = config_->cfgHash();
  doc["ip"] = net_->ip().toString();
  String out;
  serializeJson(doc, out);
  sendJson(200, out.c_str());
}

void HttpApi::handleGetConfig() {
  if (!config_->hasConfig()) {
    sendJson(404, "{\"error\":\"no config loaded\"}");
    return;
  }
  addCors();
  server_.send(200, "application/json", config_->rawConfig());
}

void HttpApi::handlePutConfig() {
  const String& body = server_.arg("plain");
  if (body.length() == 0 || body.length() > Config::kMaxConfigBytes) {
    sendJson(400, "{\"ok\":false,\"error\":\"bad size\"}");
    return;
  }
  if (!config_->saveConfig(body.c_str(), body.length())) {
    sendJson(400, "{\"ok\":false,\"error\":\"invalid config json\"}");
    return;
  }
  JsonDocument doc;
  doc["ok"] = true;
  doc["cfg_hash"] = config_->cfgHash();
  doc["rebooting"] = true;  // drivers re-init from the new config on boot
  String out;
  serializeJson(doc, out);
  sendJson(200, out.c_str());
  net_->scheduleReboot(1200);
}

void HttpApi::handleBehavior() {
  const String& body = server_.arg("plain");
  if (body.length() == 0 || body.length() > Config::kMaxBehaviorBytes) {
    sendJson(413, "{\"ok\":false,\"error\":\"behavior must be 1..16384 bytes\"}");
    return;
  }
  bool run = server_.arg("run") == "1" || server_.arg("run") == "true";
  if (!ctl_.upload || !ctl_.upload(body.c_str(), body.length(), run)) {
    sendJson(400, "{\"ok\":false,\"error\":\"invalid behavior\"}");
    return;
  }
  sendJson(200, run ? "{\"ok\":true,\"running\":true}" : "{\"ok\":true}");
}

void HttpApi::handleBehaviorCtl() {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, server_.arg("plain"));
  const char* action = doc["action"] | "";
  bool known = strcmp(action, "run") == 0 || strcmp(action, "stop") == 0 ||
               strcmp(action, "autostart_on") == 0 ||
               strcmp(action, "autostart_off") == 0;
  if (err != DeserializationError::Ok || !known) {
    sendJson(400, "{\"ok\":false,\"error\":\"action must be run|stop|autostart_on|autostart_off\"}");
    return;
  }
  if (!ctl_.ctl || !ctl_.ctl(action)) {
    sendJson(409, "{\"ok\":false,\"error\":\"action failed\"}");
    return;
  }
  sendJson(200, "{\"ok\":true}");
}

void HttpApi::handleOtaDone() {
  if (Ota::uploadOk()) {
    sendJson(200, "{\"ok\":true,\"rebooting\":true}");
    net_->scheduleReboot(1000);
  } else {
    JsonDocument doc;
    doc["ok"] = false;
    doc["error"] = Ota::lastError();
    String out;
    serializeJson(doc, out);
    sendJson(500, out.c_str());
  }
}

void HttpApi::handleLogs() {
  RingLog& log = logger();
  String out;
  out.reserve(log.size() * 48);
  for (size_t i = 0; i < log.size(); ++i) {
    char line[RingLog::kLineLen + 32];
    snprintf(line, sizeof(line), "[%8lu] [%-5s] %s\n",
             static_cast<unsigned long>(log.timeMs(i)),
             RingLog::levelName(log.level(i)), log.text(i));
    out += line;
  }
  addCors();
  server_.send(200, "text/plain", out);
}

void HttpApi::handleNotFound() {
  // CORS preflight for any /api path.
  if (server_.method() == HTTP_OPTIONS) {
    addCors();
    server_.send(204);
    return;
  }
  // Captive portal: in AP mode every unknown URL (connectivity probes like
  // /generate_204, /hotspot-detect.html, ...) redirects to the portal.
  if (net_->inPortalMode()) {
    String location = String("http://") + net_->ip().toString() + "/";
    server_.sendHeader("Location", location);
    server_.send(302, "text/plain", "");
    return;
  }
  sendJson(404, "{\"error\":\"not found\"}");
}

}  // namespace botforge

#endif  // NATIVE_BUILD
