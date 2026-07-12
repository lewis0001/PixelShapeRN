/**
 * Golden-trace conformance: every fixture in ../fixtures runs through the
 * reference interpreter and must produce the exact expected HAL trace.
 * The C++ VM (pio test -d packages/firmware -e native) runs the same files.
 *
 * BSJ_FIXTURES_UPDATE=1 rewrites each fixture's `expected` from the current
 * interpreter output (see fixtures/README.md) instead of asserting.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { FIXTURES_DIR, loadFixture, loadFixtureIndex, runFixture } from "./harness.js";

const UPDATE = process.env.BSJ_FIXTURES_UPDATE === "1";

describe("golden-trace fixtures", () => {
  const files = loadFixtureIndex();

  it("index.json lists at least 8 fixtures", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  for (const file of files) {
    it(file, () => {
      const fx = loadFixture(file);
      const result = runFixture(fx);

      if (UPDATE) {
        const raw = JSON.parse(readFileSync(FIXTURES_DIR + file, "utf8")) as Record<
          string,
          unknown
        >;
        raw.expected = result.trace;
        writeFileSync(FIXTURES_DIR + file, JSON.stringify(raw, null, 2) + "\n");
        return;
      }

      expect(result.trace).toEqual(fx.expected);
      if (fx.expect_error !== undefined) {
        expect(result.error).toBe(fx.expect_error);
        expect(result.running).toBe(false);
      } else {
        expect(result.error).toBeNull();
      }
    });
  }
});
