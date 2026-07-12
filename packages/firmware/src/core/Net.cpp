#ifndef NATIVE_BUILD

#include "Net.h"

#include <Arduino.h>
#include <ESPmDNS.h>
#include <LittleFS.h>

#include "Hostname.h"
#include "Log.h"

namespace botforge {

namespace {

constexpr int kJoinAttempts = 3;          // §5.4: 3 failed joins => AP
constexpr uint32_t kJoinTimeoutMs = 10000;  // per attempt
constexpr const char* kPortalPath = "/portal/index.html";

}  // namespace

void Net::begin(Config& config) {
  config_ = &config;

  // Derive names from the station MAC (stable per device).
  uint8_t mac[6] = {0};
  WiFi.macAddress(mac);
  defaultApSsid(mac[4], mac[5], apSsid_);
  char defaultHost[16];
  defaultHostname(mac[4], mac[5], defaultHost);

  // mDNS hostname: user-chosen robot name when provisioned, else the default.
  const char* userName = config.robotName();
  char sanitized[kHostnameMax];
  sanitizeHostname(userName, sanitized, sizeof(sanitized));
  // robotName() falls back to name_default ("Rover"); only use it when the
  // user actually provisioned a name, so unprovisioned devices stay unique.
  if (config.hasWifi()) {
    strncpy(hostname_, sanitized, sizeof(hostname_) - 1);
  } else {
    strncpy(hostname_, defaultHost, sizeof(hostname_) - 1);
  }
  hostname_[sizeof(hostname_) - 1] = '\0';

  if (config.hasWifi()) {
    WiFi.mode(WIFI_STA);
    WiFi.setHostname(hostname_);
    for (int attempt = 1; attempt <= kJoinAttempts; ++attempt) {
      logf(LOG_INFO, "net: joining \"%s\" (attempt %d/%d)", config.wifiSsid(),
           attempt, kJoinAttempts);
      if (tryJoin(config.wifiSsid(), config.wifiPass())) {
        state_ = State::Sta;
        WiFi.setAutoReconnect(true);
        if (MDNS.begin(hostname_)) {
          MDNS.addService("http", "tcp", 80);
          MDNS.addService("ws", "tcp", 81);
          logf(LOG_INFO, "net: up at http://%s.local (%s)", hostname_,
               WiFi.localIP().toString().c_str());
        } else {
          logf(LOG_WARN, "net: mDNS start failed; use %s",
               WiFi.localIP().toString().c_str());
        }
        return;
      }
      WiFi.disconnect(true);
      delay(250);
    }
    logf(LOG_WARN, "net: %d joins failed, falling back to setup AP",
         kJoinAttempts);
  }
  startAp();
}

bool Net::tryJoin(const char* ssid, const char* pass) {
  WiFi.begin(ssid, pass);
  uint32_t start = millis();
  while (millis() - start < kJoinTimeoutMs) {
    if (WiFi.status() == WL_CONNECTED) return true;
    delay(100);
  }
  return false;
}

void Net::startAp() {
  // AP+STA so the portal's /provision/scan can still scan for networks.
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(apSsid_);  // open network — it only serves the captive portal
  delay(100);            // settle softAPIP
  dns_.setErrorReplyCode(DNSReplyCode::NoError);
  dns_.start(53, "*", WiFi.softAPIP());  // wildcard: everything -> portal
  state_ = State::Ap;
  logf(LOG_INFO, "net: setup AP \"%s\" up at %s", apSsid_,
       WiFi.softAPIP().toString().c_str());
}

void Net::registerPortalRoutes(WebServer& server) {
  // Portal page. Served in every mode ("/" is not part of the §5.4 API); in
  // STA mode it allows renaming/re-provisioning from the browser.
  server.on("/", HTTP_GET, [this, &server]() { sendPortalIndex(server); });

  server.on("/provision/scan", HTTP_GET, [this, &server]() {
    // Synchronous scan: the portal is the only client in AP mode, so a ~2 s
    // blocking scan is acceptable and far simpler than async bookkeeping.
    int n = WiFi.scanNetworks();
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    for (int i = 0; i < n && i < 20; ++i) {
      JsonObject o = arr.add<JsonObject>();
      o["ssid"] = WiFi.SSID(i);
      o["rssi"] = WiFi.RSSI(i);
      o["open"] = WiFi.encryptionType(i) == WIFI_AUTH_OPEN;
    }
    WiFi.scanDelete();
    String out;
    serializeJson(doc, out);
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "application/json", out);
  });

  server.on("/provision", HTTP_POST, [this, &server]() {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, server.arg("plain"));
    const char* ssid = doc["ssid"] | "";
    if (err != DeserializationError::Ok || ssid[0] == '\0') {
      server.send(400, "application/json",
                  "{\"ok\":false,\"error\":\"ssid required\"}");
      return;
    }
    const char* pass = doc["pass"] | "";
    const char* name = doc["name"] | "";
    config_->saveWifi(ssid, pass, name);

    char host[kHostnameMax];
    if (name[0] != '\0') {
      sanitizeHostname(name, host, sizeof(host));
    } else {
      strncpy(host, hostname_, sizeof(host) - 1);
      host[sizeof(host) - 1] = '\0';
    }

    JsonDocument resp;
    resp["ok"] = true;
    resp["host"] = String(host) + ".local";
    resp["url"] = String("http://") + host + ".local";
    String out;
    serializeJson(resp, out);
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "application/json", out);
    scheduleReboot(1500);  // let the response flush, then join the new Wi-Fi
  });
}

void Net::sendPortalIndex(WebServer& server) {
  File f = LittleFS.open(kPortalPath, "r");
  if (!f) {
    server.send(500, "text/plain", "portal page missing from LittleFS");
    return;
  }
  server.streamFile(f, "text/html");
  f.close();
}

void Net::tick(uint32_t now) {
  if (state_ == State::Ap) {
    dns_.processNextRequest();
  }
  if (rebootPending_ && static_cast<uint32_t>(now - rebootAt_) <= 0x7fffffffu) {
    logf(LOG_INFO, "net: rebooting");
    delay(100);
    ESP.restart();
  }
}

IPAddress Net::ip() const {
  return state_ == State::Ap ? WiFi.softAPIP() : WiFi.localIP();
}

int Net::rssi() const { return state_ == State::Sta ? WiFi.RSSI() : 0; }

void Net::scheduleReboot(uint32_t delay_ms) {
  rebootAt_ = millis() + delay_ms;
  rebootPending_ = true;
}

}  // namespace botforge

#endif  // NATIVE_BUILD
