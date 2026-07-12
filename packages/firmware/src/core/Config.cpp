/**
 * botforge firmware — Config: LittleFS persistence (target-only half).
 *
 * The pure parsing/accessor half lives inline in Config.h and is
 * native-tested; this file only touches the filesystem, so it compiles to
 * an empty translation unit under NATIVE_BUILD.
 */
#ifndef NATIVE_BUILD

#include "Config.h"

#include <Arduino.h>
#include <LittleFS.h>

#include "Log.h"

namespace botforge {

namespace {

constexpr const char* kConfigPath = "/config.json";
constexpr const char* kWifiPath = "/wifi.json";
constexpr const char* kBehaviorPath = "/behavior.json";
constexpr const char* kAutostartOffPath = "/autostart_off";

bool readFileToString(const char* path, std::string& out, size_t maxBytes) {
  File f = LittleFS.open(path, "r");
  if (!f || f.isDirectory()) return false;
  size_t size = f.size();
  if (size == 0 || size > maxBytes) {
    f.close();
    return false;
  }
  out.resize(size);
  size_t got = f.read(reinterpret_cast<uint8_t*>(&out[0]), size);
  f.close();
  if (got != size) return false;
  return true;
}

bool writeStringToFile(const char* path, const char* data, size_t len) {
  File f = LittleFS.open(path, "w");
  if (!f) return false;
  size_t wrote = f.write(reinterpret_cast<const uint8_t*>(data), len);
  f.close();
  return wrote == len;
}

}  // namespace

bool Config::loadFromFs() {
  std::string buf;
  bool ok = false;
  if (readFileToString(kConfigPath, buf, kMaxConfigBytes)) {
    if (setConfigJson(buf.data(), buf.size())) {
      ok = true;
    } else {
      logf(LOG_ERROR, "config: %s is not valid config JSON", kConfigPath);
    }
  } else {
    logf(LOG_ERROR, "config: %s missing/unreadable", kConfigPath);
  }

  buf.clear();
  if (readFileToString(kWifiPath, buf, kMaxConfigBytes)) {
    if (!setWifiJson(buf.data(), buf.size())) {
      logf(LOG_WARN, "config: %s corrupt, ignoring", kWifiPath);
      clearWifi();
    }
  }
  return ok;
}

bool Config::saveConfig(const char* json, size_t len) {
  if (json == nullptr || len == 0 || len > kMaxConfigBytes) return false;
  // Validate by parsing into this instance first; only persist valid configs.
  if (!setConfigJson(json, len)) return false;
  if (!writeStringToFile(kConfigPath, json, len)) {
    logf(LOG_ERROR, "config: write %s failed", kConfigPath);
    return false;
  }
  logf(LOG_INFO, "config: saved %s (cfg_hash %s)", kConfigPath, cfgHash());
  return true;
}

bool Config::saveWifi(const char* ssid, const char* pass, const char* name) {
  JsonDocument doc;
  doc["ssid"] = ssid != nullptr ? ssid : "";
  doc["pass"] = pass != nullptr ? pass : "";
  doc["name"] = name != nullptr ? name : "";
  std::string out;
  serializeJson(doc, out);
  if (!writeStringToFile(kWifiPath, out.data(), out.size())) {
    logf(LOG_ERROR, "config: write %s failed", kWifiPath);
    return false;
  }
  wifi_ = doc;
  logf(LOG_INFO, "config: wifi saved (ssid \"%s\")", wifiSsid());
  return true;
}

void Config::wipeWifi() {
  LittleFS.remove(kWifiPath);
  clearWifi();
  logf(LOG_WARN, "config: wifi credentials wiped");
}

bool Config::saveBehavior(const char* json, size_t len) {
  if (json == nullptr || len == 0 || len > kMaxBehaviorBytes) return false;
  if (!writeStringToFile(kBehaviorPath, json, len)) {
    logf(LOG_ERROR, "config: write %s failed", kBehaviorPath);
    return false;
  }
  logf(LOG_INFO, "config: behavior saved (%u bytes)",
       static_cast<unsigned>(len));
  return true;
}

bool Config::loadBehavior(std::string& out) {
  return readFileToString(kBehaviorPath, out, kMaxBehaviorBytes);
}

bool Config::autostartEnabled() const {
  return !LittleFS.exists(kAutostartOffPath);
}

void Config::setAutostartEnabled(bool enabled) {
  if (enabled) {
    LittleFS.remove(kAutostartOffPath);
  } else {
    File f = LittleFS.open(kAutostartOffPath, "w");
    if (f) {
      f.write('1');
      f.close();
    }
  }
  logf(LOG_INFO, "config: behavior autostart %s", enabled ? "on" : "off");
}

}  // namespace botforge

#endif  // NATIVE_BUILD
