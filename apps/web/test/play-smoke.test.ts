/**
 * /play smoke test — the page's run wiring end-to-end, headless:
 * a SimWorld (collidersOnly, no DOM/WebGL) + SimLink driven through the
 * SAME lib/play/session helpers the UI buttons call, running a tiny
 * drive-then-stop BSJ and observing physics, logs and telemetry.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SimLink, SimWorld } from "@botforge/sim";
import type { LogEntry, Telemetry } from "@botforge/sim";
import { resetSimWorld, runInSim, stopSim } from "../lib/play/session";

const here = dirname(fileURLToPath(import.meta.url));
/** The committed rover fixture (same files served from /public/sim-assets). */
const FIXTURE_DIR = join(here, "..", "..", "..", "packages", "sim", "test", "fixtures", "rover-v1");

function roverMeshes(): Record<string, Uint8Array> {
  const meshes: Record<string, Uint8Array> = {};
  const dir = join(FIXTURE_DIR, "meshes");
  for (const f of readdirSync(dir)) meshes[`meshes/${f}`] = readFileSync(join(dir, f));
  return meshes;
}

async function createHeadlessSim() {
  const world = await SimWorld.create({
    urdf: readFileSync(join(FIXTURE_DIR, "robot.urdf"), "utf8"),
    meshes: roverMeshes(),
    collidersOnly: true, // no three.js scene — pure physics + sensors
    arena: "open_floor",
    seed: 7,
  });
  const link = new SimLink(world, { robotId: "rover-v1", name: "Play smoke" });
  await link.connect();
  return { world, link };
}

/** Drive forward, wait half a second, stop — the tiniest useful behavior. */
const TINY_BSJ = {
  bsj: 1,
  name: "smoke_drive",
  vars: [],
  handlers: [
    {
      event: { type: "on_start" },
      body: [
        { op: "log", msg: "rolling" },
        { op: "drive", l: 60, r: 60 },
        { op: "wait", ms: 500 },
        { op: "stop" },
        { op: "log", msg: "done" },
      ],
    },
  ],
};

describe("/play run wiring in a headless SimWorld", () => {
  it("runs a drive-then-stop behavior through runInSim", async () => {
    const { world, link } = await createHeadlessSim();
    try {
      const logs: LogEntry[] = [];
      const frames: Telemetry[] = [];
      link.on("log", (entry) => logs.push(entry));
      link.on("telemetry", (frame) => frames.push(frame));

      const spawn = world.arena.spawn;
      const outcome = runInSim(link, TINY_BSJ);
      expect(outcome.ok).toBe(true);
      expect(link.mode).toBe("behavior");

      // Mid-drive: motors on, robot moving forward.
      world.step(300);
      expect(world.getDrive()).toEqual({ l: 60, r: 60 });

      // Past the wait: stop op executed, robot has covered real ground.
      world.step(1000);
      expect(world.getDrive()).toEqual({ l: 0, r: 0 });
      const pose = world.getRobotPose();
      const displacement = Math.hypot(pose.x - spawn.x, pose.y - spawn.y);
      expect(displacement).toBeGreaterThan(0.05);

      // Console + telemetry flowed through the link like the page sees them.
      expect(logs.map((l) => l.msg)).toEqual(["rolling", "done"]);
      expect(frames.length).toBeGreaterThanOrEqual(5); // 5 Hz of sim time
      expect(frames.at(-1)?.mode).toBe("behavior");
      expect(link.behaviorError).toBeNull();
    } finally {
      world.dispose();
    }
  });

  it("stopSim halts a running behavior and the motors", async () => {
    const { world, link } = await createHeadlessSim();
    try {
      expect(runInSim(link, TINY_BSJ).ok).toBe(true);
      world.step(200);
      expect(link.behaviorRunning).toBe(true);
      expect(world.getDrive()).toEqual({ l: 60, r: 60 });

      stopSim(link);
      expect(link.behaviorRunning).toBe(false);
      expect(world.getDrive()).toEqual({ l: 0, r: 0 });
    } finally {
      world.dispose();
    }
  });

  it("rejects an invalid program without touching the running state", async () => {
    const { world, link } = await createHeadlessSim();
    try {
      const outcome = runInSim(link, { bsj: 1, vars: [], handlers: [] });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.issues[0]).toMatch(/event block/i);
      expect(link.behaviorRunning).toBe(false);
      world.step(300);
      expect(world.getDrive()).toEqual({ l: 0, r: 0 });
    } finally {
      world.dispose();
    }
  });

  it("resetSimWorld rewinds to spawn and keeps the link usable", async () => {
    const { world, link } = await createHeadlessSim();
    try {
      expect(runInSim(link, TINY_BSJ).ok).toBe(true);
      world.step(800);
      const moved = world.getRobotPose();
      expect(Math.hypot(moved.x, moved.y)).toBeGreaterThan(0.05);

      await resetSimWorld(link, world);
      expect(world.timeMs).toBe(0);
      const pose = world.getRobotPose();
      expect(pose.x).toBeCloseTo(world.arena.spawn.x, 5);
      expect(pose.y).toBeCloseTo(world.arena.spawn.y, 5);
      expect(world.getDrive()).toEqual({ l: 0, r: 0 });
      expect(link.state).toBe("connected");
      expect(link.behaviorRunning).toBe(false);

      // Telemetry re-anchors at t=0 (the reason reset bounces the link).
      const frames: Telemetry[] = [];
      link.on("telemetry", (frame) => frames.push(frame));
      world.step(450);
      expect(frames.length).toBeGreaterThanOrEqual(2);

      // And the same program can run again from spawn.
      expect(runInSim(link, TINY_BSJ).ok).toBe(true);
      world.step(300);
      expect(world.getDrive()).toEqual({ l: 60, r: 60 });
    } finally {
      world.dispose();
    }
  });
});
