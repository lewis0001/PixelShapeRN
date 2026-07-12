/**
 * botforge firmware — driver-name -> constructor table (PLAN Phase 2, P2).
 */
#ifndef NATIVE_BUILD

#include "Factory.h"

#include <string.h>

#include "Buzzer_PWM.h"
#include "Line_TCRT.h"
#include "Motor_DRV8833.h"
#include "Pixel_WS2812.h"
#include "PowerMon.h"
#include "Range_VL53L0X.h"
#include "Servo_Std.h"

namespace botforge {

namespace {

struct FactoryEntry {
  const char* name;
  IModule* (*make)();
};

const FactoryEntry kTable[] = {
    {"Motor_DRV8833", []() -> IModule* { return new Motor_DRV8833(); }},
    {"Servo_Std", []() -> IModule* { return new Servo_Std(); }},
    {"Range_VL53L0X", []() -> IModule* { return new Range_VL53L0X(); }},
    {"Line_TCRT", []() -> IModule* { return new Line_TCRT(); }},
    {"Pixel_WS2812", []() -> IModule* { return new Pixel_WS2812(); }},
    {"Buzzer_PWM", []() -> IModule* { return new Buzzer_PWM(); }},
    {"PowerMon", []() -> IModule* { return new PowerMon(); }},
    // IMU_6050 lands in Phase 6 (PLAN Phase 6.2).
};

}  // namespace

IModule* createDriver(const char* name) {
  if (name == nullptr) return nullptr;
  for (const FactoryEntry& entry : kTable) {
    if (strcmp(entry.name, name) == 0) return entry.make();
  }
  return nullptr;
}

}  // namespace botforge

#endif  // NATIVE_BUILD
