#ifndef NATIVE_BUILD

#include "Range_VL53L0X.h"

#include <Arduino.h>
#include <Wire.h>

#include "../core/Log.h"

namespace botforge {

bool Range_VL53L0X::begin(JsonObjectConst cfg) {
  int sda = cfg["pins"]["sda"] | -1;
  int scl = cfg["pins"]["scl"] | -1;
  if (sda < 0 || scl < 0) {
    logf(LOG_ERROR, "vl53l0x: missing sda/scl pins");
    return false;
  }
  Wire.begin(sda, scl);
  Wire.setClock(400000);

  sensor_.setTimeout(50);
  if (!sensor_.init()) {
    logf(LOG_ERROR, "vl53l0x: init failed (check wiring)");
    return false;
  }
  // Continuous back-to-back at ~50 ms; tick() polls at 60 ms so a reading is
  // normally already available and the blocking read returns immediately.
  sensor_.startContinuous(50);
  ready_ = true;
  return true;
}

void Range_VL53L0X::tick(uint32_t now) {
  if (!ready_) return;
  if (static_cast<uint32_t>(now - lastPoll_) < kPollMs) return;
  lastPoll_ = now;

  uint16_t mm = sensor_.readRangeContinuousMillimeters();
  if (sensor_.timeoutOccurred() || mm > kMaxMm) {
    mm = kMaxMm;  // out of range / no target reads as "far"
  }
  mm_ = static_cast<float>(mm);
}

bool Range_VL53L0X::read(const char* field, float& out) {
  if (strcmp(field, "mm") == 0) {
    out = mm_;
    return true;
  }
  return false;
}

bool Range_VL53L0X::act(const char* op, JsonObjectConst params) {
  (void)op;
  (void)params;
  return false;  // sensors have no actions
}

}  // namespace botforge

#endif  // NATIVE_BUILD
