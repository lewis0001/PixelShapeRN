#ifndef NATIVE_BUILD

#include "PowerMon.h"

#include <Arduino.h>

namespace botforge {

bool PowerMon::begin(JsonObjectConst cfg) {
  JsonObjectConst params = cfg["params"];
  // vbat_adc is null in the rover config (§5.5): no divider wired.
  if (params["vbat_adc"].is<int>()) {
    adcPin_ = params["vbat_adc"].as<int>();
  }
  divider_ = params["divider"] | 2.0f;
  return true;
}

void PowerMon::tick(uint32_t now) {
  if (adcPin_ < 0) return;
  if (static_cast<uint32_t>(now - lastSample_) < kSampleMs) return;
  lastSample_ = now;
  // analogReadMilliVolts is the calibrated ADC path in arduino-esp32 3.x.
  mv_ = static_cast<float>(analogReadMilliVolts(adcPin_)) * divider_;
}

bool PowerMon::read(const char* field, float& out) {
  if (strcmp(field, "mv") == 0) {
    out = mv_;
    return true;
  }
  return false;
}

bool PowerMon::act(const char* op, JsonObjectConst params) {
  (void)op;
  (void)params;
  return false;
}

}  // namespace botforge

#endif  // NATIVE_BUILD
