/**
 * Blockly ↔ BSJ codec tests: lossless round-trip on the three shipped rover
 * behaviors and every golden-trace fixture program, limits-meter math, and
 * zod rejection of a broken program. Pure data — no Blockly, no DOM.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BSJ_LIMITS, parseBsj, type BsjProgram, type Stmt } from "@botforge/behavior-ts";
import {
  bsjToWorkspace,
  formatKb,
  measureBsj,
  workspaceToBsj,
  type WorkspaceState,
} from "../lib/blockly/codec";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const behaviorsDir = join(repoRoot, "robots", "rover-v1", "behaviors");
const examplesDir = join(here, "..", "public", "examples");
const fixturesDir = join(repoRoot, "packages", "behavior-ts", "fixtures");

const BEHAVIOR_NAMES = ["avoid_obstacles", "line_follow", "pet_mode"] as const;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Full round-trip: BSJ → workspace state → BSJ. */
function roundTrip(program: BsjProgram): BsjProgram {
  return workspaceToBsj(bsjToWorkspace(program), program.name);
}

describe("codec round-trip: shipped rover behaviors", () => {
  for (const name of BEHAVIOR_NAMES) {
    it(`round-trips ${name} losslessly`, () => {
      const program = readJson<BsjProgram>(join(behaviorsDir, `${name}.json`));
      expect(parseBsj(program)).toBeTruthy(); // sanity: source is valid BSJ
      expect(roundTrip(program)).toStrictEqual(program);
    });
  }

  it("ships identical copies under public/examples for the Examples menu", () => {
    for (const name of BEHAVIOR_NAMES) {
      const original = readJson<BsjProgram>(join(behaviorsDir, `${name}.json`));
      const copy = readJson<BsjProgram>(join(examplesDir, `${name}.json`));
      expect(copy).toStrictEqual(original);
    }
  });

  it("round-trips again from the produced BSJ (stable fixed point)", () => {
    for (const name of BEHAVIOR_NAMES) {
      const program = readJson<BsjProgram>(join(behaviorsDir, `${name}.json`));
      const once = roundTrip(program);
      expect(roundTrip(once)).toStrictEqual(once);
    }
  });
});

describe("codec round-trip: behavior-ts golden-trace fixtures", () => {
  const index = readJson<string[]>(join(fixturesDir, "index.json"));

  it("covers every fixture in index.json", () => {
    expect(index).toHaveLength(12);
  });

  for (const file of index) {
    it(`round-trips ${file} losslessly`, () => {
      const fixture = readJson<{ program: BsjProgram }>(join(fixturesDir, file));
      expect(roundTrip(fixture.program)).toStrictEqual(fixture.program);
    });
  }
});

describe("codec details", () => {
  it("maps if-without-else and if-with-else to distinct blocks (lossless else)", () => {
    const noElse: BsjProgram = {
      bsj: 1,
      vars: [],
      handlers: [
        { event: { type: "on_start" }, body: [{ op: "if", cond: 1, body: [{ op: "stop" }] }] },
      ],
    };
    const withEmptyElse: BsjProgram = {
      bsj: 1,
      vars: [],
      handlers: [
        {
          event: { type: "on_start" },
          body: [{ op: "if", cond: 1, body: [{ op: "stop" }], else: [] }],
        },
      ],
    };
    const wsNoElse = bsjToWorkspace(noElse);
    const wsEmptyElse = bsjToWorkspace(withEmptyElse);
    expect(wsNoElse.blocks?.blocks[0]?.next?.block?.type).toBe("bsj_if");
    expect(wsEmptyElse.blocks?.blocks[0]?.next?.block?.type).toBe("bsj_if_else");
    expect(roundTrip(noElse)).toStrictEqual(noElse);
    expect(roundTrip(withEmptyElse)).toStrictEqual(withEmptyElse);
  });

  it("keeps led/led_off optional id lossless (omitted = all pixels)", () => {
    const program: BsjProgram = {
      bsj: 1,
      vars: [],
      handlers: [
        {
          event: { type: "on_start" },
          body: [
            { op: "led", r: 1, g: 2, b: 3 },
            { op: "led", r: 1, g: 2, b: 3, id: 4 },
            { op: "led_off" },
            { op: "led_off", id: { var: "px" } },
          ],
        },
      ],
    };
    expect(roundTrip(program)).toStrictEqual(program);
  });

  it("preserves var declarations (name + init) and handler order", () => {
    const program: BsjProgram = {
      bsj: 1,
      name: "vars_everywhere",
      vars: [
        { name: "th", init: 2000 },
        { name: "lost", init: -1.5 },
      ],
      handlers: [
        { event: { type: "on_button" }, body: [] },
        { event: { type: "on_tick", ms: 40 }, body: [{ op: "set_var", name: "th", value: 7 }] },
        { event: { type: "on_start" }, body: [] },
      ],
    };
    expect(roundTrip(program)).toStrictEqual(program);
  });

  it("exports plain numbers as editable shadow blocks on required inputs", () => {
    const program: BsjProgram = {
      bsj: 1,
      vars: [],
      handlers: [{ event: { type: "on_start" }, body: [{ op: "drive", l: 70, r: -70 }] }],
    };
    const drive = bsjToWorkspace(program).blocks?.blocks[0]?.next?.block;
    expect(drive?.inputs?.L?.shadow?.type).toBe("bsj_number");
    expect(drive?.inputs?.L?.shadow?.fields?.NUM).toBe(70);
    expect(drive?.inputs?.L?.block).toBeUndefined();
  });

  it("prefers a real block plugged over a shadow when reading back", () => {
    const state: WorkspaceState = {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: "bsj_on_start",
            next: {
              block: {
                type: "bsj_wait",
                inputs: {
                  MS: {
                    shadow: { type: "bsj_number", fields: { NUM: 500 } },
                    block: { type: "bsj_var_get", fields: { NAME: "t" } },
                  },
                },
              },
            },
          },
        ],
      },
    };
    expect(workspaceToBsj(state).handlers[0]?.body[0]).toStrictEqual({
      op: "wait",
      ms: { var: "t" },
    });
  });

  it("reads an empty required socket as the literal 0 (meter-friendly)", () => {
    const state: WorkspaceState = {
      blocks: {
        languageVersion: 0,
        blocks: [{ type: "bsj_on_start", next: { block: { type: "bsj_wait" } } }],
      },
    };
    expect(workspaceToBsj(state).handlers[0]?.body[0]).toStrictEqual({ op: "wait", ms: 0 });
  });

  it("ignores loose non-hat fragments parked on the canvas", () => {
    const state: WorkspaceState = {
      blocks: {
        languageVersion: 0,
        blocks: [
          { type: "bsj_stop" }, // detached statement
          { type: "bsj_number", fields: { NUM: 9 } }, // detached expr
          { type: "bsj_on_start" },
        ],
      },
    };
    expect(workspaceToBsj(state)).toStrictEqual({
      bsj: 1,
      vars: [],
      handlers: [{ event: { type: "on_start" }, body: [] }],
    });
  });

  it("throws a readable error on unknown block types", () => {
    const state: WorkspaceState = {
      blocks: {
        languageVersion: 0,
        blocks: [{ type: "bsj_on_start", next: { block: { type: "bsj_explode" } } }],
      },
    };
    expect(() => workspaceToBsj(state)).toThrow(/unknown statement block type "bsj_explode"/);
  });

  it("throws a readable error on unknown ops when building a workspace", () => {
    const stmt = { op: "explode" } as unknown as Stmt;
    const program: BsjProgram = {
      bsj: 1,
      vars: [],
      handlers: [{ event: { type: "on_start" }, body: [stmt] }],
    };
    expect(() => bsjToWorkspace(program)).toThrow(/unknown op "explode"/);
  });
});

describe("limits meter", () => {
  it("counts statements recursively and measures serialized bytes", () => {
    const program = readJson<BsjProgram>(join(behaviorsDir, "avoid_obstacles.json"));
    const meter = measureBsj(program);
    // 4 (on_start) + 8 (on_tick: if + 2 led + 3 drive_time + inner if + drive) + 2 (on_button)
    expect(meter.statements).toBe(14);
    expect(meter.maxStatements).toBe(BSJ_LIMITS.maxStatements);
    expect(meter.bytes).toBe(new TextEncoder().encode(JSON.stringify(program)).length);
    expect(meter.maxBytes).toBe(16 * 1024);
    expect(meter.overStatements).toBe(false);
    expect(meter.overBytes).toBe(false);
    expect(meter.over).toBe(false);
  });

  it("flags a program over the 128-statement limit", () => {
    const body: Stmt[] = Array.from({ length: 129 }, () => ({ op: "stop" }) as Stmt);
    const meter = measureBsj({ bsj: 1, handlers: [{ event: { type: "on_start" }, body }] });
    expect(meter.statements).toBe(129);
    expect(meter.overStatements).toBe(true);
    expect(meter.over).toBe(true);
    expect(meter.overBytes).toBe(false);
  });

  it("flags a program over the 16 KB file limit", () => {
    const big: BsjProgram = {
      bsj: 1,
      vars: [],
      handlers: [{ event: { type: "on_start" }, body: [{ op: "log", msg: "x".repeat(17_000) }] }],
    };
    const meter = measureBsj(big);
    expect(meter.overBytes).toBe(true);
    expect(meter.over).toBe(true);
    expect(meter.overStatements).toBe(false);
  });

  it("formats the KB figure with one decimal", () => {
    expect(formatKb(0)).toBe("0.0");
    expect(formatKb(1024)).toBe("1.0");
    expect(formatKb(1536)).toBe("1.5");
    expect(formatKb(16 * 1024)).toBe("16.0");
  });
});

describe("zod validation of broken programs", () => {
  it("rejects an unknown op with a readable error", () => {
    const broken = {
      bsj: 1,
      name: "broken",
      vars: [],
      handlers: [{ event: { type: "on_start" }, body: [{ op: "explode" }] }],
    };
    expect(() => parseBsj(broken)).toThrow(/invalid BSJ/);
    expect(() => parseBsj(broken)).toThrow(/handlers\.0\.body\.0/);
  });

  it("rejects a workspace export that references an undeclared variable", () => {
    const state: WorkspaceState = {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: "bsj_on_start",
            next: {
              block: {
                type: "bsj_set_var",
                fields: { NAME: "ghost" },
                inputs: { VALUE: { shadow: { type: "bsj_number", fields: { NUM: 1 } } } },
              },
            },
          },
        ],
      },
    };
    const exported = workspaceToBsj(state, "ghost_var");
    expect(() => parseBsj(exported)).toThrow(/undeclared variable "ghost"/);
  });
});
