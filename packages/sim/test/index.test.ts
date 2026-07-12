import { describe, expect, it } from "vitest";
import { SIM_FIXED_STEP_HZ } from "../src/index.js";

describe("@botforge/sim", () => {
  it("exports SIM_FIXED_STEP_HZ = 120", () => {
    expect(SIM_FIXED_STEP_HZ).toBe(120);
  });
});
