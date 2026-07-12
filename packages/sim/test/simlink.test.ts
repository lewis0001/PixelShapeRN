import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SimLink, type LogEntry, type RobotInfo, type Telemetry } from "../src/index.js";
import { createRoverWorld } from "./helpers.js";

/**
 * §5.4 message-set round-trip against the SimWorld, driven by fake timers
 * (SimLink.startClock pumps sim time from setInterval).
 */
describe("SimLink (§5.4 protocol)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers hello with hello.ack identity", async () => {
    const world = await createRoverWorld({ arena: "open_floor" });
    const link = new SimLink(world, { robotId: "rover-v1", name: "Rover" });
    const acks: RobotInfo[] = [];
    link.on("hello.ack", (info) => acks.push(info));
    expect(link.state).toBe("disconnected");
    link.send({ t: "hello" }); // dropped while disconnected
    expect(acks).toHaveLength(0);
    await link.connect();
    expect(link.state).toBe("connected");
    link.send({ t: "hello" });
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({ fw: "sim-0.1.0", robot_id: "rover-v1", name: "Rover" });
    expect(acks[0].cfg_hash).toMatch(/^[0-9a-f]{8}$/);
    world.dispose();
  });

  it("manual mode: cmd.drive moves the robot; telemetry flows at 5 Hz sim time", async () => {
    const world = await createRoverWorld({ arena: "open_floor" });
    const link = new SimLink(world);
    const frames: Telemetry[] = [];
    link.on("telemetry", (t) => frames.push(t));
    await link.connect();
    link.send({ t: "mode", mode: "manual" });
    link.send({ t: "cmd.drive", l: 60, r: 60 });
    link.startClock(1, 16);
    vi.advanceTimersByTime(500); // ≈496 ms sim time
    expect(frames.length).toBe(2); // t=200, t=400
    expect(frames[0]).toMatchObject({ mode: "manual", behavior_running: false });
    expect(frames[0].batt_mv).toBeGreaterThan(4000);
    expect(frames[0].sensors.range?.mm).toBe(2000);
    expect(frames[0].sensors.line).toEqual({ l: 0, r: 0 });
    expect(world.getRobotPose().x).toBeGreaterThan(0.05);
    world.dispose();
  });

  it("manual deadman: motors stop after 800 ms without cmd/ping", async () => {
    const world = await createRoverWorld({ arena: "open_floor" });
    const link = new SimLink(world);
    await link.connect();
    link.send({ t: "cmd.drive", l: 80, r: 80 });
    link.startClock(1, 16);
    vi.advanceTimersByTime(600);
    expect(world.getDrive()).toEqual({ l: 80, r: 80 });
    link.send({ t: "ping" }); // keepalive resets the deadman
    vi.advanceTimersByTime(600);
    expect(world.getDrive()).toEqual({ l: 80, r: 80 });
    vi.advanceTimersByTime(600); // >800 ms since the ping
    expect(world.getDrive()).toEqual({ l: 0, r: 0 });
    world.dispose();
  });

  it("cmd.led / cmd.tone / cmd.servo act on the world", async () => {
    const world = await createRoverWorld({ arena: "open_floor" });
    const link = new SimLink(world);
    await link.connect();
    link.send({ t: "cmd.led", r: 10, g: 20, b: 30 });
    expect(world.getLeds()).toEqual([
      { r: 10, g: 20, b: 30 },
      { r: 10, g: 20, b: 30 },
    ]);
    link.send({ t: "cmd.led", r: 0, g: 0, b: 0, id: 1 });
    expect(world.getLeds()[1]).toEqual({ r: 0, g: 0, b: 0 });
    link.send({ t: "cmd.tone", hz: 880, ms: 100 });
    expect(world.getActiveTone()).toMatchObject({ hz: 880 });
    expect(() => link.send({ t: "cmd.servo", id: "nope", deg: 90 })).not.toThrow();
    world.dispose();
  });

  it("behavior mode: loadBehavior + ctl run ticks the VM at 50 Hz sim time", async () => {
    const world = await createRoverWorld({ arena: "open_floor" });
    const link = new SimLink(world);
    const frames: Telemetry[] = [];
    const logs: LogEntry[] = [];
    link.on("telemetry", (t) => frames.push(t));
    link.on("log", (l) => logs.push(l));
    await link.connect();
    link.loadBehavior(
      JSON.stringify({
        bsj: 1,
        name: "test",
        handlers: [
          {
            event: { type: "on_start" },
            body: [
              { op: "log", msg: "hello from vm" },
              { op: "drive", l: 50, r: 50 },
            ],
          },
          {
            event: { type: "on_tick", ms: 100 },
            body: [{ op: "led", r: 1, g: 2, b: 3 }],
          },
        ],
      })
    );
    link.ctl("run");
    expect(link.mode).toBe("behavior");
    expect(logs).toEqual([{ level: "info", msg: "hello from vm" }]);
    link.startClock(1, 16);
    vi.advanceTimersByTime(1000);
    expect(frames.at(-1)).toMatchObject({ mode: "behavior", behavior_running: true });
    expect(world.getRobotPose().x).toBeGreaterThan(0.1); // VM drove the robot
    expect(world.getLeds()[0]).toEqual({ r: 1, g: 2, b: 3 }); // on_tick ran
    // behavior mode ignores manual drive but has NO deadman (§5.4 safety).
    expect(world.getDrive()).toEqual({ l: 50, r: 50 });
    link.send({ t: "cmd.drive", l: -100, r: -100 });
    expect(world.getDrive()).toEqual({ l: 50, r: 50 });
    // switch to manual: VM halts, motors stop.
    link.send({ t: "mode", mode: "manual" });
    expect(link.behaviorRunning).toBe(false);
    expect(world.getDrive()).toEqual({ l: 0, r: 0 });
    // back to behavior: autostart re-runs the stored behavior.
    link.send({ t: "mode", mode: "behavior" });
    expect(link.behaviorRunning).toBe(true);
    world.dispose();
  });

  it("ctl stop halts the VM; invalid BSJ rejects like a 400", async () => {
    const world = await createRoverWorld({ arena: "open_floor" });
    const link = new SimLink(world);
    await link.connect();
    expect(() => link.loadBehavior("{ not json")).toThrow();
    expect(() => link.ctl("run")).toThrow(/no behavior loaded/);
    link.loadBehavior({
      bsj: 1,
      name: "spin",
      handlers: [{ event: { type: "on_start" }, body: [{ op: "drive", l: -40, r: 40 }] }],
    });
    link.ctl("run");
    expect(link.behaviorRunning).toBe(true);
    link.ctl("stop");
    expect(link.behaviorRunning).toBe(false);
    expect(world.getDrive()).toEqual({ l: 0, r: 0 }); // VM stop() stops motors
    world.dispose();
  });

  it("disconnect closes the link and stops telemetry", async () => {
    const world = await createRoverWorld({ arena: "open_floor" });
    const link = new SimLink(world);
    let closed = 0;
    const frames: Telemetry[] = [];
    link.on("close", () => closed++);
    link.on("telemetry", (t) => frames.push(t));
    await link.connect();
    link.startClock(1, 16);
    vi.advanceTimersByTime(300);
    const n = frames.length;
    link.disconnect();
    expect(closed).toBe(1);
    expect(link.state).toBe("disconnected");
    world.step(1000);
    expect(frames.length).toBe(n);
    world.dispose();
  });
});
