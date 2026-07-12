/**
 * botforge firmware — WebSocket server, port 81, path /ws (§5.4 — the
 * message table is implemented exactly).
 *
 *   inbound:  hello · ping · mode {mode} · cmd.drive {l,r} ·
 *             cmd.servo {id,deg} · cmd.led {r,g,b,id?} · cmd.tone {hz,ms}
 *   outbound: hello.ack {fw, robot_id, name, cfg_hash} ·
 *             telemetry @5 Hz {batt_mv, rssi, mode, behavior_running,
 *                              sensors:{<inst>:{<field>:v}}} ·
 *             log {level, msg}   (forwarded from the RingLog sink)
 *
 * Safety (§5.4): in manual mode a DeadmanTimer (pure, native-tested) trips
 * 800 ms after the last cmd message or ping and hard-stops the motors.
 * Behavior mode is unaffected (P8).
 *
 * Library note: links2004/WebSockets' WebSocketsServer accepts any request
 * path; clients connect to ws://host:81/ws per the contract and the path is
 * simply not filtered.
 */
#pragma once
#ifndef NATIVE_BUILD

#include <WebSocketsServer.h>

#include <functional>

#include "Config.h"
#include "DeadmanTimer.h"
#include "Log.h"
#include "ModuleRegistry.h"
#include "Net.h"

namespace botforge {

class WsServer {
 public:
  /// VM glue injected by main.cpp.
  struct VmHooks {
    std::function<void()> startBehavior;  // enter behavior mode
    std::function<void()> stopBehavior;   // enter manual mode / halt program
    std::function<bool()> behaviorRunning;
  };

  void begin(Config& config, Net& net, ModuleRegistry& modules, VmHooks hooks);

  /// Pump the socket, the deadman and the 5 Hz telemetry.
  void tick(uint32_t now);

  bool manualMode() const { return manual_; }
  const char* modeName() const { return manual_ ? "manual" : "behavior"; }

  /// Forward a log line to connected clients ({t:"log"} message). Wired to
  /// the RingLog sink by main.cpp.
  void broadcastLog(LogLevel level, const char* msg);

 private:
  static constexpr uint32_t kTelemetryMs = 200;  // 5 Hz

  void onEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length);
  void handleMessage(uint8_t num, const char* payload, size_t length);
  void sendHelloAck(uint8_t num);
  void sendTelemetry();

  WebSocketsServer ws_{81};
  Config* config_ = nullptr;
  Net* net_ = nullptr;
  ModuleRegistry* modules_ = nullptr;
  VmHooks hooks_;
  DeadmanTimer deadman_;
  bool manual_ = false;
  uint32_t now_ = 0;
  uint32_t lastTelemetry_ = 0;
};

}  // namespace botforge

#endif  // NATIVE_BUILD
