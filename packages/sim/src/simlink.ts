/**
 * SimLink — the in-page RobotLink implementation (PLAN.md Phase 3.4).
 *
 * Implements the exact §5.4 message set against a `SimWorld`, so /drive and
 * /play talk to the simulated robot through the same `RobotLink` interface
 * they use for real hardware (`WsLink`):
 *
 * - `hello` → `hello.ack` with the sim's identity.
 * - `mode` manual|behavior; manual has the 800 ms deadman (§5.4 safety),
 *   entering behavior mode (re)starts the loaded behavior, like the
 *   firmware's autostart.
 * - `cmd.drive` / `cmd.servo` act in manual mode; `cmd.led` / `cmd.tone`
 *   always act (they're cosmetic and never fight the behavior VM's motors).
 * - `telemetry` at 5 Hz of *sim time*, `log` passthrough from the VM.
 *
 * Behavior execution: a `BsjInterpreter` (from @botforge/behavior-ts — the
 * reference interpreter, not a copy) ticked at 50 Hz of sim time against a
 * `RobotAdapter` bound to the SimWorld. `loadBehavior()` + `ctl("run"|
 * "stop")` are the in-page equivalents of `POST /api/behavior` and
 * `POST /api/behavior/ctl`.
 */

import { BsjInterpreter, LOG_LEVEL, type RobotAdapter } from "@botforge/behavior-ts";
import {
  RobotLinkEmitter,
  type AppToRobotMsg,
  type LinkState,
  type LogLevel,
  type RobotInfo,
  type RobotLink,
  type RobotMode,
  type Telemetry,
} from "./robotlink.js";
import type { SimWorld } from "./world.js";

/** Behavior scheduler rate (§5.3: 50 Hz) in sim-time ms. */
const BEHAVIOR_TICK_MS = 20;
/** Telemetry rate (§5.4: 5 Hz) in sim-time ms. */
const TELEMETRY_MS = 200;
/** Manual-mode deadman (§5.4 safety), sim-time ms. */
const DEADMAN_MS = 800;

export interface SimLinkOptions {
  robotId?: string;
  name?: string;
  fw?: string;
}

/** FNV-1a 32-bit hex — a stable stand-in for the firmware's cfg_hash. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const LEVEL_NAMES: Record<number, LogLevel> = {
  [LOG_LEVEL.debug]: "debug",
  [LOG_LEVEL.info]: "info",
  [LOG_LEVEL.warn]: "warn",
  [LOG_LEVEL.error]: "error",
};

export type BehaviorCtlAction = "run" | "stop" | "autostart_on" | "autostart_off";

export class SimLink extends RobotLinkEmitter implements RobotLink {
  readonly world: SimWorld;
  private readonly info: RobotInfo;
  private linkState: LinkState = "disconnected";
  private unsubStep: (() => void) | null = null;

  private robotMode: RobotMode = "manual";
  private lastKeepaliveMs = 0;
  private nextTelemetryMs = 0;
  private nextBehaviorTickMs = 0;

  private readonly interp: BsjInterpreter;
  private behaviorLoaded = false;
  private autostart = true;

  private clockHandle: ReturnType<typeof setInterval> | null = null;

  constructor(world: SimWorld, opts: SimLinkOptions = {}) {
    super();
    this.world = world;
    const robotId = opts.robotId ?? world.model.name;
    this.info = {
      fw: opts.fw ?? "sim-0.1.0",
      robot_id: robotId,
      name: opts.name ?? `Sim ${robotId}`,
      cfg_hash: fnv1a(`sim:${robotId}`),
    };
    this.interp = new BsjInterpreter(this.makeAdapter());
  }

  /* -------------------------------------------------- RobotLink surface */

  get state(): LinkState {
    return this.linkState;
  }

  connect(): Promise<void> {
    if (this.linkState !== "connected") {
      this.linkState = "connected";
      this.lastKeepaliveMs = this.world.timeMs;
      this.nextTelemetryMs = this.world.timeMs + TELEMETRY_MS;
      this.unsubStep = this.world.onStep((timeMs) => this.onWorldStep(timeMs));
      this.emit("open", undefined);
    }
    return Promise.resolve();
  }

  disconnect(): void {
    if (this.linkState === "disconnected") return;
    this.linkState = "disconnected";
    this.stopClock();
    this.unsubStep?.();
    this.unsubStep = null;
    if (this.robotMode === "manual") this.world.setDrive(0, 0);
    this.emit("close", undefined);
  }

  send(msg: AppToRobotMsg): void {
    if (this.linkState !== "connected") return; // silently dropped (§ RobotLink)
    switch (msg.t) {
      case "hello":
        this.emit("hello.ack", { ...this.info });
        break;
      case "ping":
        this.lastKeepaliveMs = this.world.timeMs;
        break;
      case "mode":
        this.lastKeepaliveMs = this.world.timeMs;
        this.setMode(msg.mode);
        break;
      case "cmd.drive":
        this.lastKeepaliveMs = this.world.timeMs;
        if (this.robotMode === "manual") this.world.setDrive(msg.l, msg.r);
        break;
      case "cmd.servo":
        this.lastKeepaliveMs = this.world.timeMs;
        if (this.robotMode === "manual") this.world.setServo(msg.id, msg.deg);
        break;
      case "cmd.led":
        this.lastKeepaliveMs = this.world.timeMs;
        this.world.setLed(msg.r, msg.g, msg.b, msg.id);
        break;
      case "cmd.tone":
        this.lastKeepaliveMs = this.world.timeMs;
        this.world.playTone(msg.hz, msg.ms);
        break;
    }
  }

  /* ------------------------------------------------- behavior (HTTP-ish) */

  /**
   * `POST /api/behavior` equivalent: validate + load a BSJ program (JSON
   * string or object). Throws on invalid programs. Stops a running one.
   */
  loadBehavior(bsj: string | unknown): void {
    this.interp.load(bsj);
    this.behaviorLoaded = true;
  }

  /** `POST /api/behavior/ctl` equivalent. */
  ctl(action: BehaviorCtlAction): void {
    switch (action) {
      case "run":
        if (!this.behaviorLoaded) throw new Error("no behavior loaded");
        this.robotMode = "behavior";
        this.startBehavior();
        break;
      case "stop":
        this.interp.stop();
        break;
      case "autostart_on":
        this.autostart = true;
        break;
      case "autostart_off":
        this.autostart = false;
        break;
    }
  }

  get mode(): RobotMode {
    return this.robotMode;
  }

  get behaviorRunning(): boolean {
    return this.interp.running();
  }

  /** Runtime error from the behavior VM after a halt, or null. */
  get behaviorError(): string | null {
    return this.interp.error();
  }

  /* ------------------------------------------------------ realtime clock */

  /**
   * Drive the SimWorld from wall-clock time (browser use): every
   * `intervalMs` the world advances `intervalMs * speed` of sim time.
   * Speed 4 = the /play 4× fast-forward.
   */
  startClock(speed = 1, intervalMs = 16): void {
    this.stopClock();
    this.clockHandle = setInterval(() => this.world.step(intervalMs * speed), intervalMs);
  }

  stopClock(): void {
    if (this.clockHandle !== null) {
      clearInterval(this.clockHandle);
      this.clockHandle = null;
    }
  }

  /* ------------------------------------------------------------ internal */

  private setMode(mode: RobotMode): void {
    if (mode === this.robotMode) return;
    this.robotMode = mode;
    if (mode === "manual") {
      // Leaving behavior mode: halt the VM (it stops the motors itself).
      this.interp.stop();
      this.world.setDrive(0, 0);
    } else if (this.behaviorLoaded && this.autostart && !this.interp.running()) {
      // Entering behavior mode: firmware autostarts the stored behavior.
      this.startBehavior();
    }
  }

  private startBehavior(): void {
    const now = this.world.timeMs;
    this.interp.start(now);
    this.nextBehaviorTickMs = now + BEHAVIOR_TICK_MS;
  }

  private onWorldStep(timeMs: number): void {
    // 50 Hz behavior scheduler on the sim-time grid.
    if (this.robotMode === "behavior" && this.interp.running()) {
      while (this.nextBehaviorTickMs <= timeMs) {
        this.interp.tick(this.nextBehaviorTickMs);
        this.nextBehaviorTickMs += BEHAVIOR_TICK_MS;
      }
    }
    // Manual-mode deadman: no cmd/ping for 800 ms ⇒ motors stop (§5.4).
    if (this.robotMode === "manual" && timeMs - this.lastKeepaliveMs > DEADMAN_MS) {
      const d = this.world.getDrive();
      if (d.l !== 0 || d.r !== 0) this.world.setDrive(0, 0);
    }
    // 5 Hz telemetry on the sim-time grid.
    while (this.nextTelemetryMs <= timeMs) {
      this.nextTelemetryMs += TELEMETRY_MS;
      this.emit("telemetry", this.buildTelemetry());
    }
  }

  private buildTelemetry(): Telemetry {
    const s = this.world.sensors;
    return {
      batt_mv: s.batteryMv(),
      rssi: -52, // the virtual robot enjoys perfect Wi-Fi
      mode: this.robotMode,
      behavior_running: this.robotMode === "behavior" && this.interp.running(),
      sensors: {
        range: { mm: s.rangeMm() },
        line: { l: s.lineL(), r: s.lineR() },
      },
    };
  }

  /** BOOT-button equivalent for on_button handlers (sim UI hook). */
  pressButton(): void {
    this.interp.onButton(this.world.timeMs);
  }

  private makeAdapter(): RobotAdapter {
    const world = this.world;
    return {
      drive: (l, r) => world.setDrive(l, r),
      servo: (id, deg) => world.setServo(id, deg),
      led: (r, g, b, id) => world.setLed(r, g, b, id),
      ledOff: (id) => world.clearLed(id),
      tone: (hz, ms) => world.playTone(hz, ms),
      readSensor: (name) => world.sensors.read(name),
      log: (level, msg) => this.emit("log", { level: LEVEL_NAMES[level] ?? "info", msg }),
      now: () => world.timeMs,
      random: (lo, hi) => world.randomInt(lo, hi),
    };
  }
}
