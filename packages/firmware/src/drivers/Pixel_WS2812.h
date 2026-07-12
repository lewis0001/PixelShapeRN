/**
 * botforge firmware — WS2812 addressable pixel driver (registry:
 * led-ws2812-2), via Adafruit NeoPixel.
 *
 * pins:   din
 * params: count (default 2)
 *
 * ops:
 *   "led"     {r, g, b, id?}  — id omitted or < 0 = all pixels (§5.3)
 *   "led_off" {id?}           — same id semantics
 *
 * reads:  none.
 */
#pragma once
#ifndef NATIVE_BUILD

#include <Adafruit_NeoPixel.h>

#include "IModule.h"

namespace botforge {

class Pixel_WS2812 : public IModule {
 public:
  ~Pixel_WS2812() override;

  bool begin(JsonObjectConst cfg) override;
  void tick(uint32_t now) override;
  bool read(const char* field, float& out) override;
  bool act(const char* op, JsonObjectConst params) override;

 private:
  void fill(int id, uint8_t r, uint8_t g, uint8_t b);

  Adafruit_NeoPixel* strip_ = nullptr;
  int count_ = 0;
  bool ready_ = false;
};

}  // namespace botforge

#endif  // NATIVE_BUILD
