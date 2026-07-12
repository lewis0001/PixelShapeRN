#ifndef NATIVE_BUILD

#include "Buzzer_PWM.h"

#include <Arduino.h>

#include "../core/Log.h"

namespace botforge {

bool Buzzer_PWM::begin(JsonObjectConst cfg) {
  pin_ = cfg["pins"]["sig"] | -1;
  if (pin_ < 0) {
    logf(LOG_ERROR, "buzzer: missing sig pin");
    return false;
  }
  // Attach once; ledcWriteTone reconfigures the frequency per tone.
  if (!ledcAttach(static_cast<uint8_t>(pin_), 2000, 10)) {
    logf(LOG_ERROR, "buzzer: ledcAttach failed on gpio%d", pin_);
    return false;
  }
  ledcWriteTone(static_cast<uint8_t>(pin_), 0);
  ready_ = true;
  return true;
}

void Buzzer_PWM::tick(uint32_t now) {
  now_ = now;
  if (!ready_ || !active_) return;
  if (static_cast<uint32_t>(now - offAt_) <= 0x7fffffffu) {
    // Off moment reached (unsigned-wrap-safe "now >= offAt_").
    ledcWriteTone(static_cast<uint8_t>(pin_), 0);
    active_ = false;
  }
}

bool Buzzer_PWM::read(const char* field, float& out) {
  (void)field;
  (void)out;
  return false;
}

bool Buzzer_PWM::act(const char* op, JsonObjectConst params) {
  if (strcmp(op, "tone") != 0) return false;
  if (!ready_) return true;  // op is ours even if hardware is unavailable
  int hz = params["hz"] | 0;
  uint32_t ms = params["ms"] | kDefaultMs;
  if (hz <= 0) {
    ledcWriteTone(static_cast<uint8_t>(pin_), 0);
    active_ = false;
    return true;
  }
  ledcWriteTone(static_cast<uint8_t>(pin_), static_cast<uint32_t>(hz));
  offAt_ = now_ + ms;
  active_ = true;
  return true;
}

}  // namespace botforge

#endif  // NATIVE_BUILD
