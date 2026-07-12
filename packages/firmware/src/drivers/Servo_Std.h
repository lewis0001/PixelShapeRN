/**
 * botforge firmware — standard hobby servo driver (registry: servo-sg90 /
 * servo-mg90s).
 *
 * pins:   sig (PWM)
 * params: min_us (500), max_us (2400), deg_min (0), deg_max (180),
 *         attach_stagger_ms (60)
 *
 * Staggered attach (brownout prevention, PLAN Phase 2.2): servos are NOT
 * attached in begin(). Each instance takes a global attach slot and attaches
 * `slot * attach_stagger_ms` after its first tick(), so the inrush of several
 * servos energising never lands on the same instant.
 *
 * ops:    "servo" {deg}  (angle clamped to [deg_min, deg_max])
 * reads:  "deg" — last commanded angle.
 */
#pragma once
#ifndef NATIVE_BUILD

#include <ESP32Servo.h>

#include "IModule.h"

namespace botforge {

class Servo_Std : public IModule {
 public:
  bool begin(JsonObjectConst cfg) override;
  void tick(uint32_t now) override;
  bool read(const char* field, float& out) override;
  bool act(const char* op, JsonObjectConst params) override;

 private:
  void writeAngle(float deg);

  Servo servo_;
  int pin_ = -1;
  int minUs_ = 500;
  int maxUs_ = 2400;
  float degMin_ = 0.0f;
  float degMax_ = 180.0f;
  uint32_t staggerMs_ = 60;
  int attachSlot_ = 0;      // global order this instance was begun in
  uint32_t attachAt_ = 0;   // computed from first tick
  bool haveFirstTick_ = false;
  bool attached_ = false;
  float pendingDeg_ = 90.0f;  // written on attach
  bool ready_ = false;

  static int s_attachCount;  // global attach-slot allocator
};

}  // namespace botforge

#endif  // NATIVE_BUILD
