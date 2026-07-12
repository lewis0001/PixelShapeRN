import { describe, expect, it } from "vitest";
import { formatUsd } from "../lib/utils";

describe("smoke", () => {
  it("runs the test harness", () => {
    expect(true).toBe(true);
  });
});

describe("formatUsd", () => {
  it("formats cents as US dollars", () => {
    expect(formatUsd(123456)).toBe("$1,234.56");
    expect(formatUsd(99)).toBe("$0.99");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("rejects non-finite input", () => {
    expect(() => formatUsd(Number.NaN)).toThrow(TypeError);
  });
});
