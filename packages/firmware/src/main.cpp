/**
 * botforge firmware — universal ESP32-S3 robot firmware (PLAN Phase 2).
 *
 * Boot sequence (PLAN Phase 2 structure):
 *   LittleFS -> Config (/config.json, /wifi.json) -> drivers from
 *   config.json modules[] (Factory, P2) -> Net (STA join or provisioning
 *   AP, §5.4) -> HTTP API (:80) + WS server (:81/ws) -> Behavior VM
 *   autostart (P8 — the robot runs with no connection at all).
 *
 * The Behavior VM lives in vm/Vm.h (a concurrent Phase-2 module); this file
 * codes against its frozen API and bridges VmHal to the driver registry:
 * sensor names like "range.mm" route to instance "range", field "mm".
 *
 * The whole file is compiled out for the native (host) test environment.
 */
#ifndef NATIVE_BUILD

#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>

#include <string>

#include "core/BootButton.h"
#include "core/Config.h"
#include "core/HttpApi.h"
#include "core/Log.h"
#include "core/ModuleRegistry.h"
#include "core/Net.h"
#include "core/Ota.h"
#include "core/Version.h"
#include "core/WsServer.h"
#include "drivers/Factory.h"
#include "vm/Vm.h"

using namespace botforge;

// ---------------------------------------------------------------------------
// Globals (single-threaded Arduino loop; no locking needed)
// ---------------------------------------------------------------------------

static Config g_config;
static ModuleRegistry g_modules;
static Net g_net;
static HttpApi g_http;
static WsServer g_ws;
static Vm g_vm;
static BootButton g_bootButton;  // short press -> on_button; 5 s -> wifi wipe

// The VM references the behavior JSON during load; keep the buffer alive for
// the lifetime of the loaded program.
static std::string g_behaviorJson;

// ---------------------------------------------------------------------------
// VmHal bridge: BSJ ops -> driver registry (P2: fully generic routing)
// ---------------------------------------------------------------------------

struct DriverHal final : public VmHal {
  void drive(int l, int r) override {
    JsonDocument d;
    d["l"] = l;
    d["r"] = r;
    g_modules.actAll("drive", d.as<JsonObjectConst>());
  }

  void servo(const char* id, int deg) override {
    IModule* mod = g_modules.find(id);
    if (mod == nullptr) return;
    JsonDocument d;
    d["deg"] = deg;
    mod->act("servo", d.as<JsonObjectConst>());
  }

  void led(int r, int g, int b, int id) override {
    JsonDocument d;
    d["r"] = r;
    d["g"] = g;
    d["b"] = b;
    if (id >= 0) d["id"] = id;  // id < 0 = all pixels (§5.3 "id omitted")
    g_modules.actAll("led", d.as<JsonObjectConst>());
  }

  void ledOff(int id) override {
    JsonDocument d;
    if (id >= 0) d["id"] = id;
    g_modules.actAll("led_off", d.as<JsonObjectConst>());
  }

  void tone(int hz, int ms) override {
    JsonDocument d;
    d["hz"] = hz;
    d["ms"] = ms;
    g_modules.actAll("tone", d.as<JsonObjectConst>());
  }

  float readSensor(const char* name) override {
    // "<instance>.<field>" (e.g. "range.mm", "line.l") per §5.3.
    float v = 0.0f;
    return g_modules.readField(name, v) ? v : 0.0f;
  }

  void log(int level, const char* msg) override {
    LogLevel lvl = level <= 0   ? LOG_DEBUG
                   : level == 1 ? LOG_INFO
                   : level == 2 ? LOG_WARN
                                : LOG_ERROR;
    logf(lvl, "%s", msg);
  }

  long random(long lo, long hi) override {
    // BSJ {"rand": [min, max]} is inclusive on both ends (Appendix B uses
    // rand [0,1] as a coin flip); Arduino random() excludes the upper bound.
    return ::random(lo, hi + 1);
  }
};

static DriverHal g_hal;

// ---------------------------------------------------------------------------
// Behavior control (shared by HTTP /api/behavior*, WS mode switch, autostart)
// ---------------------------------------------------------------------------

static void stopMotors() {
  JsonDocument empty;
  g_modules.actAll("stop", empty.as<JsonObjectConst>());
}

static bool startBehaviorFromBuffer(uint32_t now) {
  if (g_behaviorJson.empty()) {
    logf(LOG_WARN, "behavior: nothing loaded");
    return false;
  }
  if (!g_vm.load(g_behaviorJson.c_str(), g_behaviorJson.size(), &g_hal)) {
    const char* err = g_vm.error();
    logf(LOG_ERROR, "behavior: load failed: %s",
         err != nullptr ? err : "unknown");
    return false;
  }
  g_vm.start(now);
  logf(LOG_INFO, "behavior: running");
  return true;
}

static bool behaviorUpload(const char* json, size_t len, bool run) {
  if (!g_config.saveBehavior(json, len)) return false;
  g_behaviorJson.assign(json, len);
  if (run) {
    g_vm.stop();
    stopMotors();
    return startBehaviorFromBuffer(millis());
  }
  return true;
}

static bool behaviorCtl(const char* action) {
  if (strcmp(action, "run") == 0) {
    if (g_behaviorJson.empty() && !g_config.loadBehavior(g_behaviorJson)) {
      return false;
    }
    g_vm.stop();
    stopMotors();
    return startBehaviorFromBuffer(millis());
  }
  if (strcmp(action, "stop") == 0) {
    g_vm.stop();
    stopMotors();
    logf(LOG_INFO, "behavior: stopped");
    return true;
  }
  if (strcmp(action, "autostart_on") == 0) {
    g_config.setAutostartEnabled(true);
    return true;
  }
  if (strcmp(action, "autostart_off") == 0) {
    g_config.setAutostartEnabled(false);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(300);  // give USB-CDC a moment so the boot banner is visible
  logf(LOG_INFO, "botforge fw %s booting", BOTFORGE_FW_VERSION);

  // 1. Filesystem + config.
  if (!LittleFS.begin(true /* format on first mount */)) {
    logf(LOG_ERROR, "littlefs: mount failed — no config or portal available");
  }
  g_config.loadFromFs();
  logf(LOG_INFO, "config: robot %s (cfg_hash %s, %u modules)",
       g_config.robotId(), g_config.cfgHash(),
       static_cast<unsigned>(g_config.moduleCount()));

  // 2. Drivers from config.json modules[] (P2 — the config IS the robot).
  analogReadResolution(12);
  for (size_t i = 0; i < g_config.moduleCount(); ++i) {
    JsonObjectConst m = g_config.module(i);
    const char* id = m["id"] | "";
    const char* driver = m["driver"] | "";
    IModule* mod = createDriver(driver);
    if (mod == nullptr) {
      logf(LOG_WARN, "driver: %s (%s) unknown — skipped", driver, id);
      continue;
    }
    if (!mod->begin(m)) {
      logf(LOG_ERROR, "driver: %s (%s) begin failed — disabled", driver, id);
      delete mod;
      continue;
    }
    if (!g_modules.add(id, driver, mod)) {
      logf(LOG_ERROR, "driver: registry full, %s dropped", id);
      delete mod;
      continue;
    }
    logf(LOG_INFO, "driver: %s ready (%s)", id, driver);
  }

  // 3. Connectivity (STA join or provisioning AP) + servers.
  g_net.begin(g_config);

  HttpApi::BehaviorCtl ctl;
  ctl.upload = behaviorUpload;
  ctl.ctl = behaviorCtl;
  g_http.begin(g_config, g_net, ctl);
  g_net.registerPortalRoutes(g_http.server());

  WsServer::VmHooks hooks;
  hooks.startBehavior = []() {
    if (g_vm.running()) return;
    if (g_behaviorJson.empty()) g_config.loadBehavior(g_behaviorJson);
    startBehaviorFromBuffer(millis());
  };
  hooks.stopBehavior = []() {
    g_vm.stop();
    stopMotors();
  };
  hooks.behaviorRunning = []() { return g_vm.running(); };
  g_ws.begin(g_config, g_net, g_modules, hooks);

  // Forward every log line to WS clients (outbound `log` message, §5.4).
  logger().setSink(
      [](void* ctx, LogLevel level, uint32_t ms, const char* msg) {
        (void)ms;
        static_cast<WsServer*>(ctx)->broadcastLog(level, msg);
      },
      &g_ws);

  // 4. Optional OTA check-on-boot (config-flagged; Phase 2.6).
  Ota::checkOnBoot(g_config);

  // 5. Behavior VM autostart (P8: runs without any connection).
  if (g_config.autostartEnabled() && g_config.loadBehavior(g_behaviorJson)) {
    if (startBehaviorFromBuffer(millis())) {
      logf(LOG_INFO, "behavior: autostarted");
    }
  }

  pinMode(0, INPUT_PULLUP);  // BOOT button (short = on_button, 5 s = wipe)
  logf(LOG_INFO, "boot complete, free heap %u B",
       static_cast<unsigned>(ESP.getFreeHeap()));
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

void loop() {
  uint32_t now = millis();

  g_net.tick(now);         // DNS (portal) + scheduled reboots
  g_http.tick();           // HTTP API
  g_ws.tick(now);          // WS, deadman, 5 Hz telemetry
  g_modules.tickAll(now);  // drivers: slew, servo stagger, sensor polls
  g_vm.tick(now);          // behavior VM scheduler

  BootButton::Event ev = g_bootButton.update(digitalRead(0) == LOW, now);
  if (ev == BootButton::ShortPress) {
    g_vm.onButton(now);  // §5.3 on_button event
  } else if (ev == BootButton::LongHold) {
    logf(LOG_WARN, "boot: held 5 s — wiping wifi creds + reboot (§5.4)");
    stopMotors();
    g_config.wipeWifi();
    delay(300);
    ESP.restart();
  }

  delay(1);  // yield to Wi-Fi/RTOS
}

#endif  // NATIVE_BUILD
