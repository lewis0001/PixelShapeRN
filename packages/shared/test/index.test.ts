import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type RobotId } from "../src/index.js";

describe("@botforge/shared", () => {
  it("exports SCHEMA_VERSION = 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("exports the RobotId type", () => {
    const id: RobotId = "robot-001";
    expect(typeof id).toBe("string");
  });
});
