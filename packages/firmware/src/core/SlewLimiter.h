/**
 * botforge firmware — motor power slew limiter (brownout prevention).
 *
 * The DRV8833 driver ramps the applied power toward the commanded target at
 * a maximum of `slew_per_s` power-units per second (power is the canonical
 * -100..100 range, so slew_per_s=400 means full reverse -> full forward in
 * 500 ms). Sudden full-power steps are what brown out the 1S boost rail;
 * see PLAN Phase 2.2 and the risk register ("Servo/motor brownouts").
 *
 * Pure logic, header-only: no Arduino includes; native-tested in
 * test/native/test_core.
 */
#pragma once

#include <stdint.h>

namespace botforge {

class SlewLimiter {
 public:
  SlewLimiter() = default;

  /// `unitsPerSecond` <= 0 disables limiting (targets apply instantly).
  explicit SlewLimiter(float unitsPerSecond) : rate_(unitsPerSecond) {}

  void configure(float unitsPerSecond) { rate_ = unitsPerSecond; }

  /// Force the current output (e.g. hard stop on deadman trip).
  void reset(float value = 0.0f) { value_ = value; }

  /// Advance by `dt_ms` toward `target`; returns the new limited output.
  float update(float target, uint32_t dt_ms) {
    if (rate_ <= 0.0f) {
      value_ = target;
      return value_;
    }
    float maxStep = rate_ * static_cast<float>(dt_ms) * 0.001f;
    float delta = target - value_;
    if (delta > maxStep) {
      delta = maxStep;
    } else if (delta < -maxStep) {
      delta = -maxStep;
    }
    value_ += delta;
    return value_;
  }

  float value() const { return value_; }
  float rate() const { return rate_; }

 private:
  float rate_ = 0.0f;   // units per second; <=0 = unlimited
  float value_ = 0.0f;  // current output
};

}  // namespace botforge
