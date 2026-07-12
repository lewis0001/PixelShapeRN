/**
 * botforge vmcore — Phase-0 placeholder.
 * Tiny pure helper so the native Unity test has real project code to exercise.
 */
#pragma once

/// Clamp a value to the inclusive range [-100, 100]
/// (the canonical botforge motor/actuator power range).
inline int clamp100(int v) {
  if (v < -100) return -100;
  if (v > 100) return 100;
  return v;
}
