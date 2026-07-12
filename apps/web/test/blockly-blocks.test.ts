/**
 * Block inventory tests: the custom block set covers the complete BSJ v1
 * surface, the toolbox has exactly the seven required categories (one colour
 * each), and every block type the codec emits is actually defined.
 * Pure data — no Blockly, no DOM.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { BsjProgram } from "@botforge/behavior-ts";
import {
  BSJ_BLOCK_DEFINITIONS,
  BSJ_BLOCK_TYPES,
  BSJ_TOOLBOX,
  CATEGORY_COLOURS,
} from "../lib/blockly/blocks";
import { bsjToWorkspace, type BlockState, type WorkspaceState } from "../lib/blockly/codec";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

const CATEGORY_NAMES = [
  "Events",
  "Move",
  "Sense",
  "Light & Sound",
  "Logic",
  "Loops",
  "Variables",
] as const;

function collectTypes(state: WorkspaceState): Set<string> {
  const types = new Set<string>();
  const visitConn = (conn?: { block?: BlockState; shadow?: BlockState }) => {
    if (conn?.block) visitBlock(conn.block);
    if (conn?.shadow) visitBlock(conn.shadow);
  };
  const visitBlock = (b: BlockState) => {
    types.add(b.type);
    for (const conn of Object.values(b.inputs ?? {})) visitConn(conn);
    visitConn(b.next);
  };
  for (const b of state.blocks?.blocks ?? []) visitBlock(b);
  return types;
}

describe("block inventory", () => {
  it("defines 31 blocks: 3 events + 18 statements + 9 expressions + var_decl", () => {
    expect(BSJ_BLOCK_TYPES).toHaveLength(31);
    expect(new Set(BSJ_BLOCK_TYPES).size).toBe(31);
    const events = BSJ_BLOCK_DEFINITIONS.filter((d) => "hat" in d);
    const statements = BSJ_BLOCK_DEFINITIONS.filter((d) => "previousStatement" in d);
    const expressions = BSJ_BLOCK_DEFINITIONS.filter((d) => "output" in d);
    expect(events.map((d) => d.type)).toStrictEqual([
      "bsj_on_start",
      "bsj_on_tick",
      "bsj_on_button",
    ]);
    expect(statements).toHaveLength(18); // 16 ops, with if split into if / if_else
    expect(expressions).toHaveLength(9); // number, sensor, var, rand, cmp, math, logic, not, call
    expect(BSJ_BLOCK_TYPES).toContain("bsj_var_decl"); // workspace-only vars carrier
  });

  it("has exactly the seven required toolbox categories, in order", () => {
    const names = BSJ_TOOLBOX.contents.map((c) => c.name);
    expect(names).toStrictEqual([...CATEGORY_NAMES]);
  });

  it("gives each category a distinct colour, with Move on forge orange", () => {
    const colours = Object.values(CATEGORY_COLOURS);
    expect(new Set(colours).size).toBe(CATEGORY_NAMES.length);
    expect(CATEGORY_COLOURS.Move).toBe("#ff6b35");
    for (const category of BSJ_TOOLBOX.contents) {
      expect(category.colour).toBe(CATEGORY_COLOURS[category.name]);
    }
  });

  it("blocks inherit their category's colour", () => {
    const colourByType = new Map<string, string>(
      BSJ_BLOCK_DEFINITIONS.map((d) => [d.type, d.colour])
    );
    for (const category of BSJ_TOOLBOX.contents) {
      for (const entry of category.contents) {
        expect(colourByType.get(entry.type)).toBe(category.colour);
      }
    }
  });

  it("lists every defined block in the toolbox exactly once", () => {
    const toolboxTypes = BSJ_TOOLBOX.contents.flatMap((c) => c.contents.map((b) => b.type));
    expect([...toolboxTypes].sort()).toStrictEqual([...BSJ_BLOCK_TYPES].sort());
  });

  it("only uses defined block types in toolbox shadows", () => {
    const defined = new Set<string>(BSJ_BLOCK_TYPES);
    for (const category of BSJ_TOOLBOX.contents) {
      for (const entry of category.contents) {
        const inputs = ("inputs" in entry ? entry.inputs : {}) as Record<
          string,
          { shadow?: { type: string } }
        >;
        for (const conn of Object.values(inputs ?? {})) {
          if (conn.shadow) expect(defined.has(conn.shadow.type)).toBe(true);
        }
      }
    }
  });

  it("codec only emits defined block types across all shipped programs", () => {
    const defined = new Set<string>(BSJ_BLOCK_TYPES);
    const programs: BsjProgram[] = [];
    for (const name of ["avoid_obstacles", "line_follow", "pet_mode"]) {
      programs.push(
        JSON.parse(
          readFileSync(join(repoRoot, "robots/rover-v1/behaviors", `${name}.json`), "utf8")
        )
      );
    }
    const fixturesDir = join(repoRoot, "packages/behavior-ts/fixtures");
    const index: string[] = JSON.parse(readFileSync(join(fixturesDir, "index.json"), "utf8"));
    for (const file of index) {
      programs.push(JSON.parse(readFileSync(join(fixturesDir, file), "utf8")).program);
    }
    const seen = new Set<string>();
    for (const program of programs) {
      for (const type of collectTypes(bsjToWorkspace(program))) seen.add(type);
    }
    for (const type of seen) expect(defined.has(type)).toBe(true);
    // The shipped programs exercise a healthy majority of the block set.
    expect(seen.size).toBeGreaterThanOrEqual(20);
  });

  it("keeps the sensor dropdown to §5.3's rover fields", () => {
    const sensor = BSJ_BLOCK_DEFINITIONS.find((d) => d.type === "bsj_sensor");
    const dropdown = sensor?.args0?.[0] as unknown as {
      options: readonly (readonly [string, string])[];
    };
    expect(dropdown.options.map((o) => o[1])).toStrictEqual(["range.mm", "line.l", "line.r"]);
  });
});
