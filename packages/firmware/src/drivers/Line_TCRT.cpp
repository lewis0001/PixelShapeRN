#ifndef NATIVE_BUILD

#include "Line_TCRT.h"

#include <Arduino.h>

#include "../core/Log.h"

namespace botforge {

bool Line_TCRT::begin(JsonObjectConst cfg) {
  JsonObjectConst pins = cfg["pins"];
  // Engine emits registry pin names out_l/out_r; accept the §5.5 example's
  // abbreviated l/r too.
  pinL_ = pins["out_l"] | (pins["l"] | -1);
  pinR_ = pins["out_r"] | (pins["r"] | -1);
  if (pinL_ < 0 || pinR_ < 0) {
    logf(LOG_ERROR, "line: missing out_l/out_r pins");
    return false;
  }
  // 12-bit reads (0..4095) per §5.3. Global + idempotent.
  analogReadResolution(12);
  ready_ = true;
  return true;
}

void Line_TCRT::tick(uint32_t now) {
  if (!ready_) return;
  if (static_cast<uint32_t>(now - lastSample_) < kSampleMs) return;
  lastSample_ = now;
  l_ = static_cast<float>(analogRead(pinL_));
  r_ = static_cast<float>(analogRead(pinR_));
}

bool Line_TCRT::read(const char* field, float& out) {
  if (strcmp(field, "l") == 0) {
    out = l_;
    return true;
  }
  if (strcmp(field, "r") == 0) {
    out = r_;
    return true;
  }
  return false;
}

bool Line_TCRT::act(const char* op, JsonObjectConst params) {
  (void)op;
  (void)params;
  return false;  // sensors have no actions
}

}  // namespace botforge

#endif  // NATIVE_BUILD
