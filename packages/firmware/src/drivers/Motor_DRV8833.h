/**
 * botforge firmware — DRV8833 dual H-bridge driver (registry: drv-8833).
 *
 * pins:   ain1, ain2, bin1, bin2 (PWM), slp (optional enable, active high)
 * params: pwm_hz (default 20000), slew_per_s (default 400)
 *
 * Power is the canonical -100..100 range. Channel A = left, B = right
 * (the engine wires them that way; the firmware only knows "l"/"r").
 * Slew limiting (SlewLimiter, pure + native-tested) ramps applied power to
 * prevent boost-rail brownouts. "stop" is a HARD stop (bypasses the slew):
 * it is the §5.4 deadman/safety path.
 *
 * ops:    "drive" {l, r}  ·  "stop" {}
 * reads:  "l", "r" — currently applied (slewed) powers.
 *
 * LEDC via the arduino-esp32 core 3.x pin-oriented API (ledcAttach/ledcWrite).
 */
#pragma once
#ifndef NATIVE_BUILD

#include "../core/SlewLimiter.h"
#include "IModule.h"

namespace botforge {

class Motor_DRV8833 : public IModule {
 public:
  bool begin(JsonObjectConst cfg) override;
  void tick(uint32_t now) override;
  bool read(const char* field, float& out) override;
  bool act(const char* op, JsonObjectConst params) override;

 private:
  static constexpr uint8_t kPwmResolutionBits = 10;  // 0..1023 duty
  static constexpr uint32_t kMaxDuty = (1u << kPwmResolutionBits) - 1;

  void applyChannel(int pinFwd, int pinRev, float power);
  void hardStop();

  int ain1_ = -1, ain2_ = -1, bin1_ = -1, bin2_ = -1, slp_ = -1;
  uint32_t pwmHz_ = 20000;
  SlewLimiter slewL_;
  SlewLimiter slewR_;
  float targetL_ = 0.0f;
  float targetR_ = 0.0f;
  uint32_t lastTick_ = 0;
  bool haveTick_ = false;
  bool ready_ = false;
};

}  // namespace botforge

#endif  // NATIVE_BUILD
