/**
 * botforge firmware — VL53L0X time-of-flight range driver (registry:
 * sens-vl53l0x), via the Pololu VL53L0X library.
 *
 * pins:   sda, scl (I2C)
 * params: none at v1
 *
 * The sensor runs in continuous mode at ~50 ms and is polled every 60 ms
 * from tick(); out-of-range / timeout readings clamp to kMaxMm (the sensor
 * is specced to 2 m — §5.1). BSJ sensor field (§5.3): "range.mm".
 *
 * reads:  "mm"    telemetry: sensors.<id>.mm
 */
#pragma once
#ifndef NATIVE_BUILD

#include <VL53L0X.h>

#include "IModule.h"

namespace botforge {

class Range_VL53L0X : public IModule {
 public:
  bool begin(JsonObjectConst cfg) override;
  void tick(uint32_t now) override;
  bool read(const char* field, float& out) override;
  bool act(const char* op, JsonObjectConst params) override;
  const char* telemetryFields() const override { return "mm"; }

 private:
  static constexpr uint16_t kMaxMm = 2000;
  static constexpr uint32_t kPollMs = 60;

  VL53L0X sensor_;
  uint32_t lastPoll_ = 0;
  float mm_ = kMaxMm;
  bool ready_ = false;
};

}  // namespace botforge

#endif  // NATIVE_BUILD
