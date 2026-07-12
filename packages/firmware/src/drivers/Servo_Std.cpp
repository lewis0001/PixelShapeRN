#ifndef NATIVE_BUILD

#include "Servo_Std.h"

#include <Arduino.h>

#include "../core/Log.h"

namespace botforge {

int Servo_Std::s_attachCount = 0;

bool Servo_Std::begin(JsonObjectConst cfg) {
  pin_ = cfg["pins"]["sig"] | -1;
  if (pin_ < 0) {
    logf(LOG_ERROR, "servo: missing sig pin");
    return false;
  }
  JsonObjectConst params = cfg["params"];
  minUs_ = params["min_us"] | 500;
  maxUs_ = params["max_us"] | 2400;
  degMin_ = params["deg_min"] | 0.0f;
  degMax_ = params["deg_max"] | 180.0f;
  staggerMs_ = params["attach_stagger_ms"] | 60u;
  pendingDeg_ = (degMin_ + degMax_) * 0.5f;  // center until commanded
  attachSlot_ = s_attachCount++;
  ready_ = true;
  return true;
}

void Servo_Std::tick(uint32_t now) {
  if (!ready_ || attached_) return;
  if (!haveFirstTick_) {
    haveFirstTick_ = true;
    attachAt_ = now + static_cast<uint32_t>(attachSlot_) * staggerMs_;
  }
  if (static_cast<uint32_t>(now - attachAt_) > 0x7fffffffu) return;  // not yet
  // Attach moment reached (unsigned-wrap-safe "now >= attachAt_").
  servo_.setPeriodHertz(50);
  if (servo_.attach(pin_, minUs_, maxUs_) == 0) {
    logf(LOG_ERROR, "servo: attach failed on gpio%d", pin_);
    ready_ = false;
    return;
  }
  attached_ = true;
  writeAngle(pendingDeg_);
}

bool Servo_Std::read(const char* field, float& out) {
  if (strcmp(field, "deg") == 0) {
    out = pendingDeg_;
    return true;
  }
  return false;
}

bool Servo_Std::act(const char* op, JsonObjectConst params) {
  if (strcmp(op, "servo") != 0) return false;
  float deg = params["deg"] | pendingDeg_;
  if (deg < degMin_) deg = degMin_;
  if (deg > degMax_) deg = degMax_;
  pendingDeg_ = deg;
  if (attached_) writeAngle(deg);
  return true;
}

void Servo_Std::writeAngle(float deg) {
  // ESP32Servo maps write(0..180) across [minUs_, maxUs_].
  servo_.write(static_cast<int>(deg + 0.5f));
}

}  // namespace botforge

#endif  // NATIVE_BUILD
