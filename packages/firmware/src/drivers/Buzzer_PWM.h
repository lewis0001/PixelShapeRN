/**
 * botforge firmware — passive piezo buzzer driver (registry: buzzer-passive).
 *
 * pins:   sig (PWM)
 * params: none at v1
 *
 * ops:    "tone" {hz, ms} — starts the tone and returns immediately; tick()
 *         silences it after ms (non-blocking, mirrors the BSJ `tone` op
 *         semantics §5.3). hz <= 0 stops any current tone.
 *
 * LEDC tone via the arduino-esp32 core 3.x pin API (ledcAttach +
 * ledcWriteTone).
 */
#pragma once
#ifndef NATIVE_BUILD

#include "IModule.h"

namespace botforge {

class Buzzer_PWM : public IModule {
 public:
  bool begin(JsonObjectConst cfg) override;
  void tick(uint32_t now) override;
  bool read(const char* field, float& out) override;
  bool act(const char* op, JsonObjectConst params) override;

 private:
  static constexpr uint32_t kDefaultMs = 100;

  int pin_ = -1;
  uint32_t now_ = 0;     // latest tick time, used to schedule the off moment
  uint32_t offAt_ = 0;
  bool active_ = false;
  bool ready_ = false;
};

}  // namespace botforge

#endif  // NATIVE_BUILD
