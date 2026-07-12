/**
 * botforge firmware — configuration store.
 *
 * Files on LittleFS (§5.4 / §5.5):
 *   /config.json    engine-generated robot config (frozen §5.5 shape)
 *   /wifi.json      {"ssid": "...", "pass": "...", "name": "..."}   (*)
 *   /behavior.json  current BSJ program (uploaded via POST /api/behavior)
 *   /autostart_off  marker file: present => behavior autostart disabled
 *
 * (*) wifi.json's exact shape is not specified in the PLAN; this is our
 * interpretation, recorded in docs/DECISIONS.md. `name` is the user-chosen
 * robot name from the captive portal (falls back to config name_default).
 *
 * cfg_hash = first 8 hex chars of sha256(raw /config.json bytes) — computed
 * on load/save, reported by /api/info and hello.ack (§5.4).
 *
 * Split: parsing/accessors are pure (ArduinoJson is header-only, portable,
 * and part of the fixed stack §4.2) and are native-tested in
 * test/native/test_core with the real rover config.json content. Everything
 * that touches LittleFS lives behind #ifndef NATIVE_BUILD in Config.cpp.
 */
#pragma once

#include <ArduinoJson.h>

#include <string>

#include "Sha256.h"

namespace botforge {

class Config {
 public:
  static constexpr size_t kMaxConfigBytes = 8 * 1024;
  static constexpr size_t kMaxBehaviorBytes = 16 * 1024;  // §5.4 / §5.3

  // ---- pure: config.json --------------------------------------------------

  /// Parse a config.json document. On success stores the raw text (for
  /// GET /api/config) and computes cfg_hash. Returns false on JSON errors
  /// or a missing/foreign shape (no "cfg" version field).
  bool setConfigJson(const char* json, size_t len) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json, len);
    if (err != DeserializationError::Ok) return false;
    if (!doc["cfg"].is<int>()) return false;
    doc_ = doc;
    raw_.assign(json, len);
    cfgHash8(raw_.data(), raw_.size(), hash_);
    return true;
  }

  bool hasConfig() const { return !raw_.empty(); }
  int cfgVersion() const { return doc_["cfg"] | 0; }
  const char* robotId() const { return doc_["robot_id"] | "unknown"; }
  const char* nameDefault() const { return doc_["name_default"] | "Botforge"; }
  const char* autostartId() const { return doc_["autostart"] | ""; }

  /// Optional §5.4/Phase-2.6 OTA flags (not emitted by the engine yet; the
  /// firmware honours them when present): "ota_check": true and an optional
  /// "ota_url" override for the GitHub Releases latest.json location.
  bool otaCheckOnBoot() const { return doc_["ota_check"] | false; }
  const char* otaUrl() const { return doc_["ota_url"] | ""; }

  size_t moduleCount() const { return doc_["modules"].as<JsonArrayConst>().size(); }

  /// Full module object {id, driver, pins, params} — handed to IModule::begin.
  JsonObjectConst module(size_t i) const {
    return doc_["modules"].as<JsonArrayConst>()[i].as<JsonObjectConst>();
  }

  /// Raw config.json text (exact bytes, for GET /api/config).
  const char* rawConfig() const { return raw_.c_str(); }
  size_t rawConfigLen() const { return raw_.size(); }

  /// First 8 hex chars of sha256(raw config bytes); "00000000" until loaded.
  const char* cfgHash() const { return hasConfig() ? hash_ : "00000000"; }

  // ---- pure: wifi.json ----------------------------------------------------

  bool setWifiJson(const char* json, size_t len) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json, len);
    if (err != DeserializationError::Ok) return false;
    wifi_ = doc;
    return true;
  }

  void clearWifi() { wifi_.clear(); }
  bool hasWifi() const {
    const char* ssid = wifi_["ssid"] | "";
    return ssid[0] != '\0';
  }
  const char* wifiSsid() const { return wifi_["ssid"] | ""; }
  const char* wifiPass() const { return wifi_["pass"] | ""; }

  /// User-chosen robot name (portal), falling back to config name_default.
  const char* robotName() const {
    const char* name = wifi_["name"] | "";
    return name[0] != '\0' ? name : nameDefault();
  }

  // ---- target-only: LittleFS load/save (Config.cpp) ------------------------
#ifndef NATIVE_BUILD
  /// Mount-time load of /config.json + /wifi.json. Returns false when
  /// /config.json is absent or invalid (the firmware still boots into the
  /// provisioning portal so the config can be PUT over HTTP).
  bool loadFromFs();

  /// Validate + persist a new /config.json (PUT /api/config). Re-parses into
  /// this instance (cfg_hash updates). Returns false on invalid JSON/IO error.
  bool saveConfig(const char* json, size_t len);

  /// Persist /wifi.json from portal provisioning.
  bool saveWifi(const char* ssid, const char* pass, const char* name);

  /// §5.4: hold BOOT 5 s -> wipe Wi-Fi creds.
  void wipeWifi();

  /// Persist /behavior.json (POST /api/behavior). Enforces kMaxBehaviorBytes.
  bool saveBehavior(const char* json, size_t len);

  /// Read /behavior.json into `out`; false when absent.
  bool loadBehavior(std::string& out);

  bool autostartEnabled() const;
  void setAutostartEnabled(bool enabled);
#endif

 private:
  JsonDocument doc_;
  JsonDocument wifi_;
  std::string raw_;
  char hash_[9] = {0};
};

}  // namespace botforge
