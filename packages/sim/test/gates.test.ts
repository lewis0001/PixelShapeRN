import { describe, expect, it } from "vitest";
import { SimLink } from "../src/index.js";
import { createRoverWorld, roverBehavior } from "./helpers.js";

/**
 * PLAN.md Phase 3.6 acceptance gates. These are regression gates for the
 * engine's URDF output too: if the generated rover geometry changes in a
 * way that breaks driving or sensing, these fail.
 */
describe("Phase 3 sim gates", () => {
  it("avoid_obstacles in obstacle_pen: >1 m net displacement, no contact >2 s (15 sim-seconds)", async () => {
    // Seed picks the block layout + the behavior's random turn directions;
    // 12 is a representative run with healthy margins (≈1.6 m displacement,
    // ≈0.4 s worst contact). The run is fully deterministic per seed.
    const world = await createRoverWorld({ arena: "obstacle_pen", seed: 12 });
    const link = new SimLink(world);
    await link.connect();
    link.loadBehavior(roverBehavior("avoid_obstacles"));
    link.ctl("run");
    const start = world.getRobotPose();
    world.step(15_000);
    const end = world.getRobotPose();
    const displacement = Math.hypot(end.x - start.x, end.y - start.y);
    const contact = world.contactStats();
    expect(link.behaviorRunning).toBe(true); // no VM runtime error
    expect(displacement).toBeGreaterThan(1);
    expect(contact.maxStreakMs).toBeLessThan(2000);
    world.dispose();
  }, 60_000);

  it("line_follow on line_oval: ≥60% lap progress", async () => {
    const world = await createRoverWorld({ arena: "line_oval", seed: 3 });
    const track = world.arena.track!;
    const link = new SimLink(world);
    await link.connect();
    link.loadBehavior(roverBehavior("line_follow"));
    link.ctl("run");
    let pose = world.getRobotPose();
    let prev = track.progressM(pose.x, pose.y);
    let travelled = 0;
    for (let t = 0; t < 45_000; t += 100) {
      world.step(100);
      pose = world.getRobotPose();
      const s = track.progressM(pose.x, pose.y);
      let d = s - prev;
      if (d > track.lengthM / 2) d -= track.lengthM;
      if (d < -track.lengthM / 2) d += track.lengthM;
      travelled += d;
      prev = s;
    }
    expect(link.behaviorRunning).toBe(true);
    const lapProgress = travelled / track.lengthM;
    expect(lapProgress).toBeGreaterThanOrEqual(0.6);
    world.dispose();
  }, 60_000);
});
