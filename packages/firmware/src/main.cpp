/**
 * botforge firmware — Phase-0 placeholder for the universal ESP32-S3 robot
 * firmware. For now it only proves the toolchain: blink the devkit LED.
 *
 * In later phases, pin maps and robot configuration are loaded from the
 * engine-generated config.json on the LittleFS partition; nothing here is
 * meant to survive Phase 2.
 *
 * The whole file is compiled out for the native (host) test environment.
 */
#ifndef NATIVE_BUILD

#include <Arduino.h>

// The ESP32-S3-DevKitC-1's on-board LED is an addressable (WS2812-style) LED
// whose data line is GPIO48. Phase 0 keeps it simple and just toggles the pin
// with digitalWrite — enough to verify the build/flash pipeline. Some board
// variants define LED_BUILTIN already; fall back to 48 if not.
#ifndef LED_BUILTIN
#define LED_BUILTIN 48
#endif

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.println("botforge firmware (Phase 0) — blink");
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}

#endif // NATIVE_BUILD
