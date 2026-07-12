/**
 * botforge firmware — BOOT button press classifier.
 *
 * §5.4: hold BOOT 5 s at runtime -> wipe Wi-Fi creds + reboot.
 * §5.3: the `on_button` behavior event fires on a short BOOT press.
 *
 * This class turns a polled pin level into exactly one of those two events:
 *   - ShortPress: released after >= debounce (30 ms) and < 1 s held.
 *   - LongHold:   fired once as soon as the hold reaches 5 s (while still
 *                 held, so the wipe+reboot happens even if the user never
 *                 lets go). The subsequent release emits nothing.
 *
 * Pure logic, header-only: no Arduino includes; native-tested in
 * test/native/test_core.
 */
#pragma once

#include <stdint.h>

namespace botforge {

class BootButton {
 public:
  enum Event : uint8_t { None = 0, ShortPress, LongHold };

  explicit BootButton(uint32_t hold_ms = 5000, uint32_t short_max_ms = 1000,
                      uint32_t debounce_ms = 30)
      : holdMs_(hold_ms), shortMaxMs_(short_max_ms), debounceMs_(debounce_ms) {}

  /// Poll with the current (debounced-at-source or raw) pressed level.
  Event update(bool pressed, uint32_t now) {
    if (pressed) {
      if (!down_) {
        down_ = true;
        longFired_ = false;
        pressedAt_ = now;
      } else if (!longFired_ &&
                 static_cast<uint32_t>(now - pressedAt_) >= holdMs_) {
        longFired_ = true;
        return LongHold;
      }
      return None;
    }
    // Released.
    if (!down_) return None;
    down_ = false;
    uint32_t held = static_cast<uint32_t>(now - pressedAt_);
    if (!longFired_ && held >= debounceMs_ && held < shortMaxMs_) {
      return ShortPress;
    }
    return None;
  }

  bool isDown() const { return down_; }

 private:
  uint32_t holdMs_;
  uint32_t shortMaxMs_;
  uint32_t debounceMs_;
  uint32_t pressedAt_ = 0;
  bool down_ = false;
  bool longFired_ = false;
};

}  // namespace botforge
