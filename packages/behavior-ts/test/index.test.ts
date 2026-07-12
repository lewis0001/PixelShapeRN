import { describe, expect, it } from "vitest";
import { BSJ_VERSION, type BsjProgram } from "../src/index.js";

describe("@botforge/behavior-ts", () => {
  it("exports BSJ_VERSION = 1", () => {
    expect(BSJ_VERSION).toBe(1);
  });

  it("exports the BsjProgram type stub", () => {
    const program: BsjProgram = { version: BSJ_VERSION };
    expect(program.version).toBe(1);
  });
});
