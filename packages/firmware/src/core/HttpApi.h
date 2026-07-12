/**
 * botforge firmware — HTTP API, port 80 (§5.4 — implement exactly).
 *
 *   GET  /api/info          {fw, robot_id, name, cfg_hash, ip}
 *   GET  /api/config        raw config.json
 *   PUT  /api/config        replace config.json (validated), then reboot
 *   POST /api/behavior      BSJ <= 16 KB -> /behavior.json; ?run=1 also runs
 *   POST /api/behavior/ctl  {action: run|stop|autostart_on|autostart_off}
 *   POST /api/ota           firmware.bin -> Update.h, reboot on success
 *   GET  /api/logs          ring buffer as text/plain
 *
 * CORS: every /api response carries Access-Control-Allow-Origin: * and
 * OPTIONS preflights get 204 — the drive page runs from the website origin
 * (PLAN §3 graph: APP <-> FW over WebSocket + HTTP).
 *
 * Server choice: the bundled synchronous WebServer.h (see platformio.ini
 * comment). The portal routes (/, /provision*) are registered on this same
 * server by Net::registerPortalRoutes.
 */
#pragma once
#ifndef NATIVE_BUILD

#include <WebServer.h>

#include <functional>

#include "Config.h"
#include "Net.h"

namespace botforge {

class HttpApi {
 public:
  /// Behavior/VM glue injected by main.cpp (the VM is vm/Vm.h's module).
  struct BehaviorCtl {
    /// Persist a new behavior (and start it when run=true). False = bad JSON.
    std::function<bool(const char* json, size_t len, bool run)> upload;
    /// One of run|stop|autostart_on|autostart_off. False = action failed.
    std::function<bool(const char* action)> ctl;
  };

  void begin(Config& config, Net& net, BehaviorCtl ctl);

  /// Pump the server. Call every loop().
  void tick();

  /// Shared server instance (Net registers portal routes on it).
  WebServer& server() { return server_; }

 private:
  void addCors();
  void sendJson(int code, const char* body);
  void handleInfo();
  void handleGetConfig();
  void handlePutConfig();
  void handleBehavior();
  void handleBehaviorCtl();
  void handleOtaDone();
  void handleLogs();
  void handleNotFound();

  WebServer server_{80};
  Config* config_ = nullptr;
  Net* net_ = nullptr;
  BehaviorCtl ctl_;
};

}  // namespace botforge

#endif  // NATIVE_BUILD
