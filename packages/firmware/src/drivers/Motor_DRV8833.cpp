#ifndef NATIVE_BUILD

#include "Motor_DRV8833.h"

#include <Arduino.h>

#include "../core/Log.h"

namespace botforge {

namespace {

float clampPower(float v) {
  if (v < -100.0f) return -100.0f;
  if (v > 100.0f) return 100.0f;
  return v;
}

}  // namespace

bool Motor_DRV8833::begin(JsonObjectConst cfg) {
  JsonObjectConst pins = cfg["pins"];
  ain1_ = pins["ain1"] | -1;
  ain2_ = pins["ain2"] | -1;
  bin1_ = pins["bin1"] | -1;
  bin2_ = pins["bin2"] | -1;
  slp_ = pins["slp"] | -1;
  if (ain1_ < 0 || ain2_ < 0 || bin1_ < 0 || bin2_ < 0) {
    logf(LOG_ERROR, "drv8833: missing pwm pins");
    return false;
  }

  JsonObjectConst params = cfg["params"];
  pwmHz_ = params["pwm_hz"] | 20000u;
  float slewPerS = params["slew_per_s"] | 400.0f;
  slewL_.configure(slewPerS);
  slewR_.configure(slewPerS);

  const int pwmPins[4] = {ain1_, ain2_, bin1_, bin2_};
  for (int pin : pwmPins) {
    if (!ledcAttach(static_cast<uint8_t>(pin), pwmHz_, kPwmResolutionBits)) {
      logf(LOG_ERROR, "drv8833: ledcAttach failed on gpio%d", pin);
      return false;
    }
    ledcWrite(static_cast<uint8_t>(pin), 0);
  }
  if (slp_ >= 0) {
    pinMode(slp_, OUTPUT);
    digitalWrite(slp_, HIGH);  // enable the H-bridge
  }
  ready_ = true;
  return true;
}

void Motor_DRV8833::tick(uint32_t now) {
  if (!ready_) return;
  if (!haveTick_) {
    haveTick_ = true;
    lastTick_ = now;
    return;
  }
  uint32_t dt = now - lastTick_;
  lastTick_ = now;
  if (dt == 0) return;

  float l = slewL_.update(targetL_, dt);
  float r = slewR_.update(targetR_, dt);
  applyChannel(ain1_, ain2_, l);
  applyChannel(bin1_, bin2_, r);
}

bool Motor_DRV8833::read(const char* field, float& out) {
  if (strcmp(field, "l") == 0) {
    out = slewL_.value();
    return true;
  }
  if (strcmp(field, "r") == 0) {
    out = slewR_.value();
    return true;
  }
  return false;
}

bool Motor_DRV8833::act(const char* op, JsonObjectConst params) {
  if (strcmp(op, "drive") == 0) {
    targetL_ = clampPower(params["l"] | 0.0f);
    targetR_ = clampPower(params["r"] | 0.0f);
    return true;
  }
  if (strcmp(op, "stop") == 0) {
    hardStop();
    return true;
  }
  return false;
}

void Motor_DRV8833::hardStop() {
  // Safety path (deadman, VM halt): bypass the slew and cut PWM now.
  targetL_ = 0.0f;
  targetR_ = 0.0f;
  slewL_.reset(0.0f);
  slewR_.reset(0.0f);
  if (!ready_) return;
  applyChannel(ain1_, ain2_, 0.0f);
  applyChannel(bin1_, bin2_, 0.0f);
}

void Motor_DRV8833::applyChannel(int pinFwd, int pinRev, float power) {
  // Fast-decay (coast) drive: forward = PWM on IN1, 0 on IN2; reverse
  // mirrored. A small deadband avoids buzzing the bridge at ~0 power.
  float mag = power < 0 ? -power : power;
  if (mag < 0.5f) {
    ledcWrite(static_cast<uint8_t>(pinFwd), 0);
    ledcWrite(static_cast<uint8_t>(pinRev), 0);
    return;
  }
  if (mag > 100.0f) mag = 100.0f;
  uint32_t duty = static_cast<uint32_t>(mag * kMaxDuty / 100.0f + 0.5f);
  if (power >= 0) {
    ledcWrite(static_cast<uint8_t>(pinFwd), duty);
    ledcWrite(static_cast<uint8_t>(pinRev), 0);
  } else {
    ledcWrite(static_cast<uint8_t>(pinFwd), 0);
    ledcWrite(static_cast<uint8_t>(pinRev), duty);
  }
}

}  // namespace botforge

#endif  // NATIVE_BUILD
