import { describe, expect, it } from "vitest";
import { createRoverWorld } from "./helpers.js";

describe("virtual ToF (range.mm)", () => {
  it("measures a wall at a known distance within ±10 mm", async () => {
    const world = await createRoverWorld({ arena: "open_floor", seed: 9 });
    // Wall face at x = 0.45 m, in front of the spawn (robot at origin, yaw 0).
    world.addStaticBox({ cx: 0.5, cy: 0, cz: 0.25, hx: 0.05, hy: 0.75, hz: 0.25, yaw: 0 });
    // Sensor frame: range link at (0.042, 0, 0.02) on the chassis, pitched
    // 10° up (URDF rpy 0 -0.174533 0). Boresight hit distance:
    //   (0.45 − 0.042) / cos(10°)
    const expected = ((0.45 - 0.042) / Math.cos((10 * Math.PI) / 180)) * 1000;
    const mm = world.sensors.rangeMm();
    expect(Math.abs(mm - expected)).toBeLessThanOrEqual(10);
    world.dispose();
  });

  it("reports 2000 mm when nothing is in range", async () => {
    const world = await createRoverWorld({ arena: "open_floor" });
    expect(world.sensors.rangeMm()).toBe(2000);
    world.dispose();
  });

  it("applies seeded gaussian noise (σ = 2 mm)", async () => {
    const world = await createRoverWorld({ arena: "open_floor", seed: 4 });
    world.addStaticBox({ cx: 0.5, cy: 0, cz: 0.25, hx: 0.05, hy: 0.75, hz: 0.25, yaw: 0 });
    const readings = Array.from({ length: 50 }, () => world.sensors.rangeMm());
    const unique = new Set(readings);
    expect(unique.size).toBeGreaterThan(1); // noise present
    const spread = Math.max(...readings) - Math.min(...readings);
    expect(spread).toBeLessThanOrEqual(16); // ≈ ±4σ
    world.dispose();
  });
});

describe("virtual line sensors (line.l / line.r)", () => {
  it("reads high on the line and low off it", async () => {
    const world = await createRoverWorld({ arena: "line_oval" });
    // Spawn sits on the bottom straight: both channels over the line.
    expect(world.sensors.lineL()).toBeGreaterThan(3500);
    expect(world.sensors.lineR()).toBeGreaterThan(3500);
    // Middle of the oval: plain floor.
    world.setRobotPose(0, 0, 0);
    expect(world.sensors.lineL()).toBeLessThan(300);
    expect(world.sensors.lineR()).toBeLessThan(300);
    world.dispose();
  });

  it("splits left/right when straddling the line edge", async () => {
    const world = await createRoverWorld({ arena: "line_oval" });
    // Shift the robot left of the bottom straight so only the RIGHT channel
    // (robot -y) stays over the dark line.
    world.setRobotPose(0, -0.4 + 0.02, 0);
    const l = world.sensors.lineL();
    const r = world.sensors.lineR();
    expect(r).toBeGreaterThan(2000);
    expect(l).toBeLessThan(2000);
    world.dispose();
  });

  it("reads 0 on arenas without ground texture", async () => {
    const world = await createRoverWorld({ arena: "open_floor" });
    expect(world.sensors.lineL()).toBe(0);
    expect(world.sensors.lineR()).toBe(0);
    world.dispose();
  });
});

describe("battery model", () => {
  it("discharges 4.1 V → 3.5 V over 20 min of active drive", async () => {
    const world = await createRoverWorld({ arena: "open_floor" });
    expect(world.sensors.batteryMv()).toBe(4100);
    expect(world.sensors.batteryPct()).toBe(100);
    world.setDrive(100, 100);
    world.step(60_000); // 1 minute of driving = 30 mV
    expect(world.sensors.batteryMv()).toBe(4070);
    world.setDrive(0, 0);
    world.step(60_000); // idle: no discharge
    expect(world.sensors.batteryMv()).toBe(4070);
    expect(world.sensors.read("battery.pct")).toBeCloseTo(95, 0);
    world.dispose();
  }, 30000);
});
