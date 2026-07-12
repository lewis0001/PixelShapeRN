/** Schema + limits validation, including the real shipped behavior files. */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BSJ_LIMITS, BSJ_VERSION, countStatements, parseBsj, type Stmt } from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function validProgram(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bsj: 1,
    name: "t",
    vars: [],
    handlers: [{ event: { type: "on_start" }, body: [{ op: "log", msg: "hi" }] }],
    ...overrides,
  };
}

describe("BSJ schema", () => {
  it("exports BSJ_VERSION = 1", () => {
    expect(BSJ_VERSION).toBe(1);
  });

  it("accepts all shipped behavior files", () => {
    const dirs = ["robots/rover-v1/behaviors", "robots/_test-min/behaviors"];
    for (const dir of dirs) {
      for (const f of readdirSync(repoRoot + dir).filter((f) => f.endsWith(".json"))) {
        const text = readFileSync(`${repoRoot}${dir}/${f}`, "utf8");
        expect(() => parseBsj(text), `${dir}/${f}`).not.toThrow();
      }
    }
  });

  it("rejects a wrong version", () => {
    expect(() => parseBsj(validProgram({ bsj: 2 }))).toThrow(/invalid BSJ/);
  });

  it("rejects unknown ops", () => {
    expect(() =>
      parseBsj(
        validProgram({
          handlers: [{ event: { type: "on_start" }, body: [{ op: "fly" }] }],
        })
      )
    ).toThrow(/invalid BSJ/);
  });

  it("rejects unknown events and on_tick ms < 1", () => {
    expect(() =>
      parseBsj(validProgram({ handlers: [{ event: { type: "on_shake" }, body: [] }] }))
    ).toThrow(/invalid BSJ/);
    expect(() =>
      parseBsj(validProgram({ handlers: [{ event: { type: "on_tick", ms: 0 }, body: [] }] }))
    ).toThrow(/invalid BSJ/);
  });

  it("rejects more than 8 vars", () => {
    const vars = Array.from({ length: 9 }, (_, i) => ({ name: `v${i}`, init: 0 }));
    expect(() => parseBsj(validProgram({ vars }))).toThrow(/invalid BSJ/);
  });

  it("rejects duplicate var names", () => {
    expect(() =>
      parseBsj(
        validProgram({
          vars: [
            { name: "a", init: 0 },
            { name: "a", init: 1 },
          ],
        })
      )
    ).toThrow(/duplicate variable/);
  });

  it("rejects references to undeclared vars", () => {
    expect(() =>
      parseBsj(
        validProgram({
          handlers: [
            {
              event: { type: "on_start" },
              body: [{ op: "set_var", name: "ghost", value: 1 }],
            },
          ],
        })
      )
    ).toThrow(/undeclared variable/);
    expect(() =>
      parseBsj(
        validProgram({
          handlers: [
            {
              event: { type: "on_start" },
              body: [{ op: "drive", l: { var: "ghost" }, r: 0 }],
            },
          ],
        })
      )
    ).toThrow(/undeclared variable/);
  });

  it("rejects programs with more than 128 statements", () => {
    const body: Stmt[] = Array.from({ length: 129 }, () => ({ op: "stop" }) as Stmt);
    expect(() =>
      parseBsj(validProgram({ handlers: [{ event: { type: "on_start" }, body }] }))
    ).toThrow(/128/);
  });

  it("counts nested statements toward the 128 limit", () => {
    const nested: Stmt = {
      op: "if",
      cond: 1,
      body: Array.from({ length: 64 }, () => ({ op: "stop" }) as Stmt),
      else: Array.from({ length: 64 }, () => ({ op: "stop" }) as Stmt),
    };
    expect(countStatements([nested])).toBe(129);
    expect(() =>
      parseBsj(validProgram({ handlers: [{ event: { type: "on_start" }, body: [nested] }] }))
    ).toThrow(/128/);
  });

  it("rejects files over 16 KB", () => {
    const pad = " ".repeat(BSJ_LIMITS.maxFileBytes);
    expect(() => parseBsj(JSON.stringify(validProgram()) + pad)).toThrow(/16384/);
  });

  it("rejects expressions nested deeper than 32", () => {
    let e: unknown = 1;
    for (let i = 0; i < 33; i++) e = { not: e };
    expect(() =>
      parseBsj(
        validProgram({
          handlers: [{ event: { type: "on_start" }, body: [{ op: "wait", ms: e }] }],
        })
      )
    ).toThrow(/deeper than 32/);
  });
});
