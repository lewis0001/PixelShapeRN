#ifndef NATIVE_BUILD

#include "Pixel_WS2812.h"

#include <Arduino.h>

#include "../core/Log.h"

namespace botforge {

Pixel_WS2812::~Pixel_WS2812() { delete strip_; }

bool Pixel_WS2812::begin(JsonObjectConst cfg) {
  int din = cfg["pins"]["din"] | -1;
  count_ = cfg["params"]["count"] | 2;
  if (din < 0 || count_ <= 0) {
    logf(LOG_ERROR, "ws2812: missing din pin / bad count");
    return false;
  }
  strip_ = new Adafruit_NeoPixel(static_cast<uint16_t>(count_),
                                 static_cast<int16_t>(din),
                                 NEO_GRB + NEO_KHZ800);
  strip_->begin();
  strip_->clear();
  strip_->show();
  ready_ = true;
  return true;
}

void Pixel_WS2812::tick(uint32_t now) {
  (void)now;  // shows happen synchronously in act(); nothing periodic
}

bool Pixel_WS2812::read(const char* field, float& out) {
  (void)field;
  (void)out;
  return false;
}

bool Pixel_WS2812::act(const char* op, JsonObjectConst params) {
  if (!ready_) return false;
  if (strcmp(op, "led") == 0) {
    int id = params["id"] | -1;  // omitted = all pixels (§5.3)
    int r = params["r"] | 0;
    int g = params["g"] | 0;
    int b = params["b"] | 0;
    fill(id, static_cast<uint8_t>(constrain(r, 0, 255)),
         static_cast<uint8_t>(constrain(g, 0, 255)),
         static_cast<uint8_t>(constrain(b, 0, 255)));
    return true;
  }
  if (strcmp(op, "led_off") == 0) {
    int id = params["id"] | -1;
    fill(id, 0, 0, 0);
    return true;
  }
  return false;
}

void Pixel_WS2812::fill(int id, uint8_t r, uint8_t g, uint8_t b) {
  if (id >= 0) {
    if (id < count_) {
      strip_->setPixelColor(static_cast<uint16_t>(id),
                            Adafruit_NeoPixel::Color(r, g, b));
    }
  } else {
    for (int i = 0; i < count_; ++i) {
      strip_->setPixelColor(static_cast<uint16_t>(i),
                            Adafruit_NeoPixel::Color(r, g, b));
    }
  }
  strip_->show();
}

}  // namespace botforge

#endif  // NATIVE_BUILD
