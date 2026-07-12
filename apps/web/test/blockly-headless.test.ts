/**
 * Headless Blockly integration: register the real block set, load
 * codec-produced workspace state into an actual (headless) Blockly
 * workspace, re-save through Blockly's own serializer, and decode back.
 *
 * This proves the codec's states are genuinely loadable by Blockly (input
 * and field names exist, connections are legal) and that the full
 * BSJ → codec → Blockly → codec → BSJ loop is lossless — not just the pure
 * data transform.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import * as BlocklyNs from "blockly/core";
import type { BsjProgram } from "@botforge/behavior-ts";
import { BSJ_BLOCK_TYPES, registerBsjBlocks } from "../lib/blockly/blocks";
import { bsjToWorkspace, workspaceToBsj, type WorkspaceState } from "../lib/blockly/codec";

// blockly/core resolves to a CJS bundle under Node — unwrap the interop default.
const Blockly = ((BlocklyNs as { default?: typeof BlocklyNs }).default ??
  BlocklyNs) as typeof BlocklyNs;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function allPrograms(): { label: string; program: BsjProgram }[] {
  const out: { label: string; program: BsjProgram }[] = [];
  for (const name of ["avoid_obstacles", "line_follow", "pet_mode"]) {
    out.push({
      label: name,
      program: readJson<BsjProgram>(join(repoRoot, "robots/rover-v1/behaviors", `${name}.json`)),
    });
  }
  const fixturesDir = join(repoRoot, "packages/behavior-ts/fixtures");
  for (const file of readJson<string[]>(join(fixturesDir, "index.json"))) {
    out.push({
      label: file,
      program: readJson<{ program: BsjProgram }>(join(fixturesDir, file)).program,
    });
  }
  return out;
}

beforeAll(() => {
  registerBsjBlocks(Blockly);
});

describe("headless Blockly", () => {
  it("instantiates every custom block type without errors", () => {
    const ws = new Blockly.Workspace();
    try {
      for (const type of BSJ_BLOCK_TYPES) {
        const block = ws.newBlock(type);
        expect(block.type).toBe(type);
      }
      expect(ws.getAllBlocks(false)).toHaveLength(BSJ_BLOCK_TYPES.length);
    } finally {
      ws.dispose();
    }
  });

  for (const { label, program } of allPrograms()) {
    it(`round-trips ${label} through a real Blockly workspace`, () => {
      const ws = new Blockly.Workspace();
      try {
        Blockly.serialization.workspaces.load(bsjToWorkspace(program) as never, ws);
        const saved = Blockly.serialization.workspaces.save(ws) as WorkspaceState;
        expect(workspaceToBsj(saved, program.name)).toStrictEqual(program);
      } finally {
        ws.dispose();
      }
    });
  }
});
