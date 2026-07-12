/**
 * botforge firmware — connectivity & provisioning (§5.4).
 *
 * Boot flow:
 *   /wifi.json has creds --> STA join, up to 3 attempts (10 s each)
 *        success --> mDNS <hostname>.local  (hostname = sanitized user name
 *                    from provisioning, else "botforge-xxxx" from MAC)
 *        3 failures --> SoftAP fallback
 *   no creds (first boot) --> SoftAP "Botforge-XXXX" (XXXX from MAC), open
 *        network + DNSServer wildcard so every phone URL lands on the
 *        captive portal (data/portal/index.html from LittleFS).
 *
 * Portal endpoints (registered on the shared port-80 WebServer; kept out of
 * the frozen /api namespace on purpose — they are provisioning UI plumbing,
 * not the §5.4 API):
 *   GET  /provision/scan   -> [{ssid, rssi, open}] (synchronous scan)
 *   POST /provision        {ssid, pass, name} -> save /wifi.json, reply
 *                          {ok, host, url}, reboot into STA join
 *
 * BOOT-hold-5s wipe of wifi creds lives in main.cpp (BootButton + wipeWifi).
 */
#pragma once
#ifndef NATIVE_BUILD

#include <DNSServer.h>
#include <WebServer.h>
#include <WiFi.h>

#include "Config.h"

namespace botforge {

class Net {
 public:
  enum class State { Boot, Sta, Ap };

  /// Join STA or fall back to the provisioning AP. Blocking (boot-time).
  void begin(Config& config);

  /// Register portal routes on the shared HTTP server (called by main after
  /// HttpApi::begin).
  void registerPortalRoutes(WebServer& server);

  /// Pump DNS (AP mode) and any scheduled reboot. Call every loop().
  void tick(uint32_t now);

  State state() const { return state_; }
  bool inPortalMode() const { return state_ == State::Ap; }
  const char* hostname() const { return hostname_; }
  const char* apSsid() const { return apSsid_; }
  IPAddress ip() const;
  int rssi() const;

  /// Reboot `delay_ms` from now (lets an HTTP response flush first).
  void scheduleReboot(uint32_t delay_ms);

 private:
  bool tryJoin(const char* ssid, const char* pass);
  void startAp();
  void sendPortalIndex(WebServer& server);

  Config* config_ = nullptr;
  DNSServer dns_;
  State state_ = State::Boot;
  char hostname_[32] = {0};
  char apSsid_[16] = {0};
  uint32_t rebootAt_ = 0;
  bool rebootPending_ = false;
};

}  // namespace botforge

#endif  // NATIVE_BUILD
