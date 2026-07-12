/**
 * Virtual sensors (PLAN.md Phase 3.3): ToF range, 2-channel line sensor,
 * battery discharge model. All readings are derived from `SimWorld` state
 * and the world's seeded RNG, so runs are deterministic per seed.
 */

import * as THREE from "three";
import type { SimWorld } from "./world.js";

export interface RangeSensorConfig {
  /** URDF link the sensor frame is read from. */
  link: string;
  /** Max reported distance, mm (VL53L0X-class: 2 m). */
  maxMm: number;
  /** Gaussian noise σ, mm. */
  sigmaMm: number;
  /**
   * Field of view simulated as a horizontal fan of `rays` rays spanning
   * ±fovRad/2 around the sensor's +x axis; the reading is the nearest hit
   * (the VL53L0X reports the closest object inside its ~25° cone).
   */
  fovRad: number;
  rays: number;
}

export interface LineSensorConfig {
  /** URDF link of the 2-channel line module. */
  link: string;
  /** Lateral offset of each channel from the link origin, m (±y). */
  offsetM: number;
}

export const DEFAULT_RANGE_SENSOR: RangeSensorConfig = {
  link: "range",
  maxMm: 2000,
  sigmaMm: 2,
  fovRad: (25 * Math.PI) / 180,
  rays: 5,
};

export const DEFAULT_LINE_SENSOR: LineSensorConfig = {
  link: "line",
  offsetM: 0.01,
};

/** Battery model: 4.1 V → 3.5 V over 20 min of active driving (§3.3 task 2). */
export const BATTERY_MODEL = {
  fullMv: 4100,
  emptyMv: 3500,
  activeDriveMsToEmpty: 20 * 60 * 1000,
} as const;

export class VirtualSensors {
  private readonly world: SimWorld;
  readonly range: RangeSensorConfig;
  readonly line: LineSensorConfig;

  constructor(
    world: SimWorld,
    range: Partial<RangeSensorConfig> = {},
    line: Partial<LineSensorConfig> = {}
  ) {
    this.world = world;
    this.range = { ...DEFAULT_RANGE_SENSOR, ...range };
    this.line = { ...DEFAULT_LINE_SENSOR, ...line };
  }

  /**
   * ToF distance in mm: nearest obstacle hit across the sensor's ray fan,
   * plus seeded gaussian noise (σ = sigmaMm). No hit ⇒ maxMm.
   */
  rangeMm(): number {
    const frame = this.world.getLinkWorldTransform(this.range.link);
    if (!frame) return this.range.maxMm;
    const maxM = this.range.maxMm / 1000;
    let best: number | null = null;
    const half = this.range.fovRad / 2;
    const n = Math.max(1, this.range.rays);
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? 0 : -half + (i * this.range.fovRad) / (n - 1);
      // Fan in the sensor's local x/y plane, around its +x boresight.
      const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0).applyQuaternion(frame.quaternion);
      const hit = this.world.castObstacleRay(frame.position, dir, maxM);
      if (hit !== null && (best === null || hit < best)) best = hit;
    }
    if (best === null) return this.range.maxMm;
    const noisy = best * 1000 + this.world.gaussian() * this.range.sigmaMm;
    return Math.max(0, Math.min(this.range.maxMm, Math.round(noisy)));
  }

  /** Left line channel, 0–4095 (dark line = high). */
  lineL(): number {
    return this.lineChannel(+this.line.offsetM);
  }

  /** Right line channel, 0–4095 (dark line = high). */
  lineR(): number {
    return this.lineChannel(-this.line.offsetM);
  }

  private lineChannel(offsetY: number): number {
    const frame = this.world.getLinkWorldTransform(this.line.link);
    if (!frame) return 0;
    const p = new THREE.Vector3(0, offsetY, 0)
      .applyQuaternion(frame.quaternion)
      .add(frame.position);
    const darkness = this.world.sampleGround(p.x, p.y);
    return Math.max(0, Math.min(4095, Math.round(darkness * 4095)));
  }

  /** Battery voltage in mV: linear discharge while the wheels are powered. */
  batteryMv(): number {
    const { fullMv, emptyMv, activeDriveMsToEmpty } = BATTERY_MODEL;
    const used = Math.min(1, this.world.activeDriveMs / activeDriveMsToEmpty);
    return Math.round(fullMv - (fullMv - emptyMv) * used);
  }

  /** Battery percentage 0–100 over the modelled 4.1→3.5 V window. */
  batteryPct(): number {
    const { fullMv, emptyMv } = BATTERY_MODEL;
    const pct = ((this.batteryMv() - emptyMv) / (fullMv - emptyMv)) * 100;
    return Math.max(0, Math.min(100, pct));
  }

  /** BSJ sensor-field reader (§5.3): range.mm, line.l, line.r, battery.pct. */
  read(name: string): number {
    switch (name) {
      case "range.mm":
        return this.rangeMm();
      case "line.l":
        return this.lineL();
      case "line.r":
        return this.lineR();
      case "battery.pct":
        return this.batteryPct();
      case "battery.mv":
        return this.batteryMv();
      default:
        return 0;
    }
  }
}
