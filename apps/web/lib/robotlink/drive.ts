/**
 * Pure helpers for the /drive page: joystick → cmd.drive arcade mixing
 * and battery voltage → percentage. Kept UI-free so they're unit-testable.
 */

export const JOYSTICK_DEADZONE = 0.08;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Arcade-mix a normalized joystick vector into wheel powers.
 *
 * @param x steer, −1 (left) .. 1 (right)
 * @param y throttle, −1 (reverse) .. 1 (forward)
 * @returns integer `{l, r}` in −100..100 for `cmd.drive`
 *
 * A radial deadzone (default 8%) zeroes tiny stick offsets; outside it the
 * magnitude is rescaled so output ramps smoothly from 0 at the deadzone edge.
 */
export function arcadeMix(
  x: number,
  y: number,
  deadzone: number = JOYSTICK_DEADZONE
): { l: number; r: number } {
  const magnitude = Math.hypot(x, y);
  if (magnitude < deadzone) return { l: 0, r: 0 };

  const scale = (Math.min(magnitude, 1) - deadzone) / (1 - deadzone) / magnitude;
  const steer = x * scale;
  const throttle = y * scale;

  const l = clamp(Math.round((throttle + steer) * 100), -100, 100);
  const r = clamp(Math.round((throttle - steer) * 100), -100, 100);
  return { l, r };
}

export const BATT_EMPTY_MV = 3300;
export const BATT_FULL_MV = 4200;

/** Map 1S Li-ion millivolts to a display percentage (3.3 V = 0, 4.2 V = 100). */
export function batteryPct(mv: number): number {
  const pct = ((mv - BATT_EMPTY_MV) / (BATT_FULL_MV - BATT_EMPTY_MV)) * 100;
  return Math.round(clamp(pct, 0, 100));
}
