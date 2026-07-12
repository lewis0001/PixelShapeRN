/**
 * botforge firmware — 2-channel TCRT5000 analog line sensor driver
 * (registry: sens-line-2ch).
 *
 * pins:   out_l, out_r (ADC). The engine emits the registry pin names
 *         "out_l"/"out_r" (see dist/rover-v1/firmware/config.json); the §5.5
 *         example abbreviates them as "l"/"r" — both spellings are accepted.
 * params: none at v1
 *
 * Readings are raw 12-bit ADC values 0..4095 (§5.3 sensor fields "line.l",
 * "line.r"), sampled every 20 ms.
 *
 * reads:  "l", "r"    telemetry: sensors.<id>.{l,r}
 */
#pragma once
#ifndef NATIVE_BUILD

#include "IModule.h"

namespace botforge {

class Line_TCRT : public IModule {
 public:
  bool begin(JsonObjectConst cfg) override;
  void tick(uint32_t now) override;
  bool read(const char* field, float& out) override;
  bool act(const char* op, JsonObjectConst params) override;
  const char* telemetryFields() const override { return "l r"; }

 private:
  static constexpr uint32_t kSampleMs = 20;

  int pinL_ = -1;
  int pinR_ = -1;
  uint32_t lastSample_ = 0;
  float l_ = 0.0f;
  float r_ = 0.0f;
  bool ready_ = false;
};

}  // namespace botforge

#endif  // NATIVE_BUILD
