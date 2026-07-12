/**
 * botforge firmware — universal driver interface (PLAN Phase 2 / P2).
 *
 * One instance per entry in config.json "modules[]". The engine decides
 * which drivers exist on which pins; the firmware never contains
 * robot-specific logic (§0 rule 5).
 *
 * Contract per PLAN: begin(cfg), tick(now_ms), read(field)->float,
 * act(op, params). `cfg` is the FULL module object from config.json —
 * {id, driver, pins:{...}, params:{...}} — so drivers read their own pins
 * and params.
 *
 * This header is Arduino-free (ArduinoJson is portable) so pure logic that
 * references IModule stays native-compilable.
 */
#pragma once

#include <ArduinoJson.h>
#include <stdint.h>

namespace botforge {

struct IModule {
  virtual ~IModule() = default;

  /// One-time init from the module's config.json object. Returning false
  /// marks the module unavailable (logged); boot continues without it.
  virtual bool begin(JsonObjectConst cfg) = 0;

  /// Called every loop() iteration with millis().
  virtual void tick(uint32_t now) = 0;

  /// Read a named telemetry/sensor field (e.g. "mm", "l"). Returns false
  /// when the field is not provided by this driver.
  virtual bool read(const char* field, float& out) = 0;

  /// Perform a named action (e.g. "drive" {l,r}, "servo" {deg}, "led"
  /// {r,g,b,id?}, "tone" {hz,ms}, "stop", "led_off" {id?}). Returns false
  /// when the op is not handled by this driver.
  virtual bool act(const char* op, JsonObjectConst params) = 0;

  /// Additive extension (defaults keep the PLAN contract intact): space-
  /// separated field names to publish in WS telemetry `sensors.<instance>`.
  /// Empty string = this instance publishes nothing.
  virtual const char* telemetryFields() const { return ""; }
};

}  // namespace botforge
