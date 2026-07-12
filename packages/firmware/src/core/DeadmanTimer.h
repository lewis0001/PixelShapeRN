/**
 * botforge firmware — manual-mode deadman timer (§5.4 Safety).
 *
 * In `manual` mode the motors must stop if no `cmd.*` or `ping` message has
 * been received for 800 ms. `behavior` mode is unaffected (P8): the timer is
 * simply disarmed outside manual mode.
 *
 * Pure logic, header-only: no Arduino includes; native-tested in
 * test/native/test_core. All timestamps are uint32 milliseconds; elapsed
 * time is computed with unsigned subtraction so millis() wraparound
 * (every ~49.7 days) is handled correctly.
 */
#pragma once

#include <stdint.h>

namespace botforge {

class DeadmanTimer {
 public:
  static constexpr uint32_t kDefaultTimeoutMs = 800;

  explicit DeadmanTimer(uint32_t timeout_ms = kDefaultTimeoutMs)
      : timeout_(timeout_ms) {}

  /// Arm the timer (entering manual mode). Starts a fresh window from `now`.
  void arm(uint32_t now) {
    armed_ = true;
    tripped_ = false;
    lastFeed_ = now;
  }

  /// Disarm the timer (leaving manual mode). No trips until re-armed.
  void disarm() {
    armed_ = false;
    tripped_ = false;
  }

  /// Record link activity (any cmd.* or ping).
  void feed(uint32_t now) {
    if (!armed_) return;
    lastFeed_ = now;
    tripped_ = false;
  }

  /// Edge-triggered: returns true exactly once when the timeout elapses with
  /// no feed. Stays false until the next feed() re-opens the window (so the
  /// motor-stop action fires once, not every loop iteration).
  bool shouldTrip(uint32_t now) {
    if (!armed_ || tripped_) return false;
    if (static_cast<uint32_t>(now - lastFeed_) >= timeout_) {
      tripped_ = true;
      return true;
    }
    return false;
  }

  /// Level view: true while armed and the window has expired.
  bool expired(uint32_t now) const {
    return armed_ && static_cast<uint32_t>(now - lastFeed_) >= timeout_;
  }

  bool armed() const { return armed_; }
  uint32_t timeoutMs() const { return timeout_; }

 private:
  uint32_t timeout_;
  uint32_t lastFeed_ = 0;
  bool armed_ = false;
  bool tripped_ = false;
};

}  // namespace botforge
