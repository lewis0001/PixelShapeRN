import { describe, expect, it } from "vitest";
import { DRIVE_TUNING, SimLink, parseUrdf } from "../src/index.js";
import { createRoverWorld, roverBehavior, roverUrdf } from "./helpers.js";

describe("URDF parsing", () => {
  it("parses the generated rover URDF", () => {
    const model = parseUrdf(roverUrdf());
    expect(model.name).toBe("rover-v1");
    expect(model.links).toHaveLength(17);
    expect(model.joints).toHaveLength(16);
    expect(model.rootLink).toBe("chassis");
    const continuous = model.joints.filter((j) => j.type === "continuous");
    expect(continuous.map((j) => j.child).sort()).toEqual(["wheel_1", "wheel_2"]);
  });
});

describe("SimWorld", () => {
  it("derives wheel radius and track from the URDF continuous joints", async () => {
    const world = await createRoverWorld();
    expect(world.driveInfo.enabled).toBe(true);
    // robot.yaml: wheel d=42 mm ⇒ r=21 mm; wheel joints at y=±44 mm.
    expect(world.driveInfo.wheelRadiusM).toBeCloseTo(0.021, 3);
    expect(world.driveInfo.trackM).toBeCloseTo(0.088, 3);
    world.dispose();
  });

  it("reaches v_max = 0.45 m/s at power 100", async () => {
    const world = await createRoverWorld({ arena: "open_floor" });
    world.setDrive(100, 100);
    world.step(2000);
    const p1 = world.getRobotPose();
    world.step(1000);
    const p2 = world.getRobotPose();
    const speed = Math.hypot(p2.x - p1.x, p2.y - p1.y) / 1;
    expect(speed).toBeCloseTo(DRIVE_TUNING.vMaxMps, 2);
    expect(p2.yaw).toBeCloseTo(0, 2);
    world.dispose();
  });

  it("turns in place on opposite wheel powers", async () => {
    const world = await createRoverWorld({ arena: "open_floor" });
    world.setDrive(-50, 50);
    world.step(500);
    const p = world.getRobotPose();
    expect(p.yaw).toBeGreaterThan(1.5); // CCW (right wheel forward = left turn)
    expect(Math.hypot(p.x, p.y)).toBeLessThan(0.05);
    world.dispose();
  });

  it("is blocked by walls (contact detected)", async () => {
    const world = await createRoverWorld({ arena: "open_floor" });
    // Wall face at x = 0.7; driving flat out would cover ~1.7 m in 4 s.
    world.addStaticBox({ cx: 0.75, cy: 0, cz: 0.25, hx: 0.05, hy: 1, hz: 0.25, yaw: 0 });
    world.setDrive(100, 100);
    world.step(4000);
    const p = world.getRobotPose();
    expect(p.x).toBeLessThan(0.71);
    expect(p.x).toBeGreaterThan(0.55); // nose pressed against the wall
    expect(world.contactStats().inContact).toBe(true);
    expect(world.contactStats().maxStreakMs).toBeGreaterThan(1000);
    world.dispose();
  });

  it("is deterministic: same seed ⇒ identical pose trace (behavior + noise)", async () => {
    const run = async (): Promise<[number, number, number][]> => {
      const world = await createRoverWorld({ arena: "obstacle_pen", seed: 42 });
      const link = new SimLink(world);
      await link.connect();
      link.loadBehavior(roverBehavior("avoid_obstacles"));
      link.ctl("run");
      const pts: [number, number, number][] = [];
      for (let i = 0; i < 200; i++) {
        world.step(50);
        const p = world.getRobotPose();
        pts.push([p.x, p.y, p.yaw]);
      }
      world.dispose();
      return pts;
    };
    const a = await run();
    const b = await run();
    expect(a).toEqual(b); // exact float equality
  }, 30000);

  it("different seeds produce different obstacle layouts", async () => {
    const w1 = await createRoverWorld({ arena: "obstacle_pen", seed: 1 });
    const w2 = await createRoverWorld({ arena: "obstacle_pen", seed: 2 });
    expect(w1.obstacles.length).toBeGreaterThan(4); // walls + blocks
    expect(w1.obstacles).not.toEqual(w2.obstacles);
    w1.dispose();
    w2.dispose();
  });

  it("reset() restores spawn pose, time, and battery", async () => {
    const world = await createRoverWorld({ arena: "obstacle_pen", seed: 5 });
    const spawn = world.getRobotPose();
    world.setDrive(80, 40);
    world.step(3000);
    expect(world.timeMs).toBeCloseTo(3000, 3);
    expect(world.getRobotPose()).not.toEqual(spawn);
    world.reset();
    expect(world.timeMs).toBe(0);
    const p = world.getRobotPose();
    expect(p.x).toBeCloseTo(spawn.x, 6);
    expect(p.y).toBeCloseTo(spawn.y, 6);
    expect(p.yaw).toBeCloseTo(spawn.yaw, 6);
    expect(world.getDrive()).toEqual({ l: 0, r: 0 });
    expect(world.sensors.batteryMv()).toBe(4100);
    world.dispose();
  });

  it("builds a three.js scene headless when collidersOnly is off", async () => {
    const world = await createRoverWorld({ arena: "line_oval", collidersOnly: false });
    expect(world.scene).toBeDefined();
    const robot = world.scene!.children.find((c) => c.name === "robot");
    expect(robot).toBeDefined();
    expect(robot!.children.length).toBe(17); // one Object3D per link
    world.setDrive(50, 50);
    world.step(500);
    world.syncVisuals();
    expect(robot!.position.x).toBeGreaterThan(0.01);
    world.dispose();
  });

  it("runs servo joints as position motors (generic URDF support)", async () => {
    // The rover has no servos; use a synthetic URDF with a revolute joint.
    const urdf = `<?xml version="1.0"?>
      <robot name="servo-bot">
        <link name="base">
          <inertial><mass value="0.1"/><inertia ixx="1e-5" iyy="1e-5" izz="1e-5" ixy="0" ixz="0" iyz="0"/></inertial>
          <collision><geometry><box size="0.08 0.08 0.02"/></geometry></collision>
        </link>
        <link name="head">
          <inertial><mass value="0.01"/><inertia ixx="1e-6" iyy="1e-6" izz="1e-6" ixy="0" ixz="0" iyz="0"/></inertial>
          <collision><geometry><box size="0.02 0.02 0.02"/></geometry></collision>
        </link>
        <joint name="neck" type="revolute">
          <parent link="base"/><child link="head"/>
          <origin xyz="0.04 0 0.03" rpy="0 0 0"/>
          <axis xyz="0 0 1"/>
          <limit lower="-1.5708" upper="1.5708" effort="1" velocity="7"/>
        </joint>
      </robot>`;
    const { SimWorld } = await import("../src/index.js");
    const world = await SimWorld.create({ urdf, collidersOnly: true });
    expect(world.getServoDeg("neck")).toBeCloseTo(90, 1); // centered at 0 rad
    world.setServo("neck", 180);
    world.step(1000); // plenty of slew time
    expect(world.getServoDeg("neck")).toBeCloseTo(180, 1);
    const frame = world.getLinkWorldTransform("head");
    expect(frame).not.toBeNull();
    world.dispose();
  });
});
