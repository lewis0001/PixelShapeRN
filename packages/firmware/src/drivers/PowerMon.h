/**
 * botforge firmware — battery/power monitor driver (registry: pwr-1s-boost).
 *
 * pins:   none (the boost shield has no data connection at v1)
 * params: vbat_adc (GPIO of a battery divider, or null when absent —
 *         the rover's shield exposes none, so config emits null),
 *         divider  (voltage divider ratio, default 2.0)
 *
 * With vbat_adc=null the module still exists so telemetry has a stable
 * batt_mv source; it reports 0 mV meaning "unknown" (the drive page renders
 * that as no battery reading).
 *
 * reads:  "mv" — battery millivolts (0 = unknown). WS telemetry publishes
 *         this as the top-level `batt_mv` field (§5.4), not under sensors.
 */
#pragma once
#ifndef NATIVE_BUILD

#include "IModule.h"

namespace botforge {

class PowerMon : public IModule {
 public:
  bool begin(JsonObjectConst cfg) override;
  void tick(uint32_t now) override;
  bool read(const char* field, float& out) override;
  bool act(const char* op, JsonObjectConst params) override;

 private:
  static constexpr uint32_t kSampleMs = 500;

  int adcPin_ = -1;  // -1 = no divider wired (vbat_adc null)
  float divider_ = 2.0f;
  uint32_t lastSample_ = 0;
  float mv_ = 0.0f;
};

}  // namespace botforge

#endif  // NATIVE_BUILD
