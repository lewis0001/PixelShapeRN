import { describe, expect, it } from "vitest";
import {
  ARENAS,
  SIM_FIXED_STEP_HZ,
  SimLink,
  SimWorld,
  loadRobotUrdf,
  mulberry32,
  parseUrdf,
} from "../src/index.js";

describe("@botforge/sim", () => {
  it("exports SIM_FIXED_STEP_HZ = 120", () => {
    expect(SIM_FIXED_STEP_HZ).toBe(120);
  });

  it("exports the /play public API", () => {
    expect(typeof SimWorld.create).toBe("function");
    expect(typeof SimLink).toBe("function");
    expect(typeof loadRobotUrdf).toBe("function");
    expect(typeof parseUrdf).toBe("function");
    expect(Object.keys(ARENAS).sort()).toEqual(["line_oval", "obstacle_pen", "open_floor"]);
  });

  it("mulberry32 is deterministic per seed", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const c = mulberry32(124);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA[0]).not.toBe(c());
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("loadRobotUrdf refuses to run without a DOM", async () => {
    await expect(loadRobotUrdf("<robot name='x'></robot>")).rejects.toThrow(/DOM/);
  });
});
