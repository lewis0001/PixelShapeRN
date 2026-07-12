/**
 * BSJ v1 reference interpreter.
 *
 * Mirrors the C++ firmware VM (packages/firmware/src/vm/Vm.cpp) exactly —
 * both implement SEMANTICS.md and must produce identical golden traces for
 * the fixtures in ./fixtures. All arithmetic is IEEE-754 binary32
 * (Math.fround) so the two implementations agree bit-for-bit.
 */
import { parseBsj } from "./schema.js";
import { BSJ_LIMITS, LOG_LEVEL, type BsjProgram, type Expr, type Stmt } from "./types.js";

/** Host interface the interpreter drives (the "HAL" of the simulator). */
export interface RobotAdapter {
  drive(l: number, r: number): void;
  servo(id: string, deg: number): void;
  led(r: number, g: number, b: number, id?: number): void;
  ledOff(id?: number): void;
  tone(hz: number, ms: number): void;
  readSensor(name: string): number;
  log(level: number, msg: string): void;
  /** Current time in ms (used when start/tick/onButton get no timestamp). */
  now(): number;
  /** Uniform random integer in the inclusive range [lo, hi]. */
  random(lo: number, hi: number): number;
}

const fr = Math.fround;

/** floor(x + 0.5) computed in float32 — identical to the C++ VM's rounding. */
function roundInt(x: number): number {
  return Math.floor(fr(fr(x) + 0.5));
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function truthy(v: number): boolean {
  return v !== 0;
}

/** Internal unwind signal for runtime errors (never escapes the class). */
class VmHalt extends Error {}

type Phase = "run" | "wait" | "sweep";

interface Frame {
  stmts: readonly Stmt[];
  index: number;
  /** Container statement that pushed this frame (null for the root frame). */
  owner: Stmt | null;
  phase: Phase;
  /** wait / drive_time / servo_sweep end time (absolute ms). */
  deadline: number;
  /** Remaining `repeat` iterations for the container at `index`. */
  count: number;
  sweepFrom: number;
  sweepTo: number;
  sweepStart: number;
  sweepId: string;
}

interface Activation {
  handler: number;
  frames: Frame[];
}

/**
 * Reference BSJ interpreter. Method-for-method mirror of the C++ `Vm`
 * (load / start / tick / stop / onButton / running / error).
 */
export class BsjInterpreter {
  private readonly adapter: RobotAdapter;
  private program: BsjProgram | null = null;
  private vars = new Map<string, number>();
  private activations: (Activation | null)[] = [];
  private nextDue: number[] = [];
  private tStart = 0;
  private isRunning = false;
  private errorMsg: string | null = null;

  constructor(adapter: RobotAdapter) {
    this.adapter = adapter;
  }

  /**
   * Validate and load a program (JSON string or plain object).
   * Throws on invalid input. Stops any running program first.
   */
  load(input: string | unknown): void {
    if (this.isRunning) this.stop();
    this.program = parseBsj(input);
    this.errorMsg = null;
    this.activations = this.program.handlers.map(() => null);
    this.nextDue = this.program.handlers.map(() => 0);
    this.vars.clear();
  }

  /** True while the behavior is running (start() called, not halted). */
  running(): boolean {
    return this.isRunning;
  }

  /** Runtime error message after a halt, or null. */
  error(): string | null {
    return this.errorMsg;
  }

  /** Start the behavior: reset vars, arm on_tick timers, run on_start. */
  start(nowMs?: number): void {
    if (!this.program) throw new Error("no program loaded");
    const now = nowMs ?? this.adapter.now();
    this.isRunning = true;
    this.errorMsg = null;
    this.tStart = now;
    this.vars.clear();
    for (const v of this.program.vars ?? []) this.vars.set(v.name, fr(v.init));
    this.activations = this.program.handlers.map(() => null);
    this.nextDue = this.program.handlers.map((h) =>
      h.event.type === "on_tick" ? now + h.event.ms : 0
    );
    for (let i = 0; i < this.program.handlers.length; i++) {
      if (!this.isRunning) return;
      if (this.program.handlers[i].event.type !== "on_start") continue;
      const act = this.spawn(i);
      if (act) this.runStep(act, now);
    }
  }

  /** Scheduler tick (host calls this at 50 Hz). */
  tick(nowMs?: number): void {
    if (!this.isRunning || !this.program) return;
    const now = nowMs ?? this.adapter.now();
    for (let i = 0; i < this.program.handlers.length; i++) {
      if (!this.isRunning) return;
      const h = this.program.handlers[i];
      if (h.event.type === "on_tick") {
        let due = false;
        while (this.nextDue[i] <= now) {
          due = true;
          this.nextDue[i] += h.event.ms;
        }
        if (due && this.activations[i] === null) this.spawn(i);
      }
      const act = this.activations[i];
      if (act) this.runStep(act, now);
    }
  }

  /** BOOT button pressed: fire idle on_button handlers immediately. */
  onButton(nowMs?: number): void {
    if (!this.isRunning || !this.program) return;
    const now = nowMs ?? this.adapter.now();
    for (let i = 0; i < this.program.handlers.length; i++) {
      if (!this.isRunning) return;
      if (this.program.handlers[i].event.type !== "on_button") continue;
      if (this.activations[i] !== null) continue; // still running: skipped
      const act = this.spawn(i);
      if (act) this.runStep(act, now);
    }
  }

  /** Halt the behavior and stop the motors. */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.activations = this.activations.map(() => null);
    this.adapter.drive(0, 0);
  }

  // ---------------------------------------------------------------- private

  private activeCount(): number {
    let n = 0;
    for (const a of this.activations) if (a !== null) n++;
    return n;
  }

  private spawn(handlerIndex: number): Activation | null {
    if (this.activeCount() >= BSJ_LIMITS.maxActivations) return null;
    const body = this.program!.handlers[handlerIndex].body;
    const act: Activation = {
      handler: handlerIndex,
      frames: [this.newFrame(body, null)],
    };
    this.activations[handlerIndex] = act;
    return act;
  }

  private newFrame(stmts: readonly Stmt[], owner: Stmt | null): Frame {
    return {
      stmts,
      index: 0,
      owner,
      phase: "run",
      deadline: 0,
      count: 0,
      sweepFrom: 0,
      sweepTo: 0,
      sweepStart: 0,
      sweepId: "",
    };
  }

  /** Runtime error: stop motors, log, halt. Unwinds via VmHalt. */
  private fail(msg: string): never {
    this.errorMsg = msg;
    this.isRunning = false;
    this.activations = this.activations.map(() => null);
    this.adapter.drive(0, 0);
    this.adapter.log(LOG_LEVEL.error, msg);
    throw new VmHalt(msg);
  }

  private runStep(act: Activation, now: number): void {
    try {
      this.stepActivation(act, now);
    } catch (e) {
      if (!(e instanceof VmHalt)) throw e;
    }
  }

  private pushFrame(act: Activation, stmts: readonly Stmt[], owner: Stmt): void {
    if (act.frames.length >= BSJ_LIMITS.maxFrames) this.fail("frame overflow");
    act.frames.push(this.newFrame(stmts, owner));
  }

  private advance(frame: Frame): void {
    frame.index += 1;
    frame.phase = "run";
  }

  private emitServo(id: string, deg: number): void {
    this.adapter.servo(id, clampInt(roundInt(deg), 0, 180));
  }

  private stepActivation(act: Activation, now: number): void {
    const budget = BSJ_LIMITS.maxOpsPerTick;
    let ops = 0;
    for (;;) {
      const frame = act.frames[act.frames.length - 1];
      if (frame.index >= frame.stmts.length) {
        // Frame complete.
        if (act.frames.length === 1) {
          this.activations[act.handler] = null; // root done: activation ends
          return;
        }
        if (ops === budget) this.fail("op budget exceeded");
        ops++;
        act.frames.pop();
        const parent = act.frames[act.frames.length - 1];
        const owner = frame.owner as Stmt;
        switch (owner.op) {
          case "if":
            this.advance(parent);
            break;
          case "repeat":
            parent.count -= 1;
            if (parent.count > 0) this.pushFrame(act, owner.body, owner);
            else this.advance(parent);
            break;
          case "while":
            if (truthy(this.eval(owner.cond, now))) this.pushFrame(act, owner.body, owner);
            else this.advance(parent);
            break;
          case "forever":
            this.pushFrame(act, owner.body, owner);
            break;
          default:
            this.fail("frame overflow"); // unreachable
        }
        continue;
      }

      const cur = frame.stmts[frame.index];

      if (frame.phase === "wait") {
        if (now < frame.deadline) return; // still blocked, no op cost
        if (ops === budget) this.fail("op budget exceeded");
        ops++;
        if (cur.op === "drive_time") this.adapter.drive(0, 0);
        this.advance(frame);
        continue;
      }

      if (frame.phase === "sweep") {
        if (ops === budget) this.fail("op budget exceeded");
        ops++;
        if (now >= frame.deadline) {
          this.emitServo(frame.sweepId, frame.sweepTo);
          this.advance(frame);
          continue;
        }
        const elapsed = fr(now - frame.sweepStart);
        const dur = fr(frame.deadline - frame.sweepStart);
        const q = fr(elapsed / dur);
        const delta = fr(frame.sweepTo - frame.sweepFrom);
        const deg = fr(frame.sweepFrom + fr(delta * q));
        this.emitServo(frame.sweepId, deg);
        return; // stays blocked until deadline
      }

      // Fresh statement.
      if (ops === budget) this.fail("op budget exceeded");
      ops++;
      if (this.execute(act, frame, cur, now)) return; // op blocked (sweep start)
    }
  }

  /** Execute one fresh statement. Returns true if the activation blocks. */
  private execute(act: Activation, frame: Frame, cur: Stmt, now: number): boolean {
    switch (cur.op) {
      case "drive": {
        const l = clampInt(roundInt(this.eval(cur.l, now)), -100, 100);
        const r = clampInt(roundInt(this.eval(cur.r, now)), -100, 100);
        this.adapter.drive(l, r);
        this.advance(frame);
        return false;
      }
      case "drive_time": {
        const l = clampInt(roundInt(this.eval(cur.l, now)), -100, 100);
        const r = clampInt(roundInt(this.eval(cur.r, now)), -100, 100);
        const ms = Math.max(0, roundInt(this.eval(cur.ms, now)));
        this.adapter.drive(l, r);
        frame.deadline = now + ms;
        frame.phase = "wait";
        return false; // loop re-checks: ms=0 completes this tick
      }
      case "stop":
        this.adapter.drive(0, 0);
        this.advance(frame);
        return false;
      case "servo":
        this.emitServo(cur.id, this.eval(cur.deg, now));
        this.advance(frame);
        return false;
      case "servo_sweep": {
        const from = this.eval(cur.from, now);
        const to = this.eval(cur.to, now);
        const ms = Math.max(0, roundInt(this.eval(cur.ms, now)));
        if (ms === 0) {
          this.emitServo(cur.id, to);
          this.advance(frame);
          return false;
        }
        frame.sweepFrom = from;
        frame.sweepTo = to;
        frame.sweepStart = now;
        frame.deadline = now + ms;
        frame.sweepId = cur.id;
        frame.phase = "sweep";
        this.emitServo(cur.id, from);
        return true; // interpolation resumes on the next tick
      }
      case "led": {
        const r = clampInt(roundInt(this.eval(cur.r, now)), 0, 255);
        const g = clampInt(roundInt(this.eval(cur.g, now)), 0, 255);
        const b = clampInt(roundInt(this.eval(cur.b, now)), 0, 255);
        const id = cur.id === undefined ? undefined : roundInt(this.eval(cur.id, now));
        this.adapter.led(r, g, b, id);
        this.advance(frame);
        return false;
      }
      case "led_off": {
        const id = cur.id === undefined ? undefined : roundInt(this.eval(cur.id, now));
        this.adapter.ledOff(id);
        this.advance(frame);
        return false;
      }
      case "tone": {
        const hz = roundInt(this.eval(cur.hz, now));
        const ms = roundInt(this.eval(cur.ms, now));
        this.adapter.tone(hz, ms);
        this.advance(frame);
        return false;
      }
      case "wait": {
        const ms = Math.max(0, roundInt(this.eval(cur.ms, now)));
        frame.deadline = now + ms;
        frame.phase = "wait";
        return false; // loop re-checks: ms=0 completes this tick
      }
      case "set_var":
        this.vars.set(cur.name, fr(this.eval(cur.value, now)));
        this.advance(frame);
        return false;
      case "change_var": {
        const v = this.vars.get(cur.name) ?? 0;
        this.vars.set(cur.name, fr(v + this.eval(cur.value, now)));
        this.advance(frame);
        return false;
      }
      case "if": {
        const branch = truthy(this.eval(cur.cond, now)) ? cur.body : cur.else;
        if (branch !== undefined && branch.length > 0) this.pushFrame(act, branch, cur);
        else this.advance(frame);
        return false;
      }
      case "repeat": {
        const n = roundInt(this.eval(cur.n, now));
        if (n <= 0) {
          this.advance(frame);
        } else {
          frame.count = n;
          this.pushFrame(act, cur.body, cur);
        }
        return false;
      }
      case "while":
        if (truthy(this.eval(cur.cond, now))) this.pushFrame(act, cur.body, cur);
        else this.advance(frame);
        return false;
      case "forever":
        this.pushFrame(act, cur.body, cur);
        return false;
      case "break": {
        while (act.frames.length > 1) {
          const popped = act.frames.pop() as Frame;
          const owner = popped.owner as Stmt;
          if (owner.op === "repeat" || owner.op === "while" || owner.op === "forever") {
            this.advance(act.frames[act.frames.length - 1]);
            return false;
          }
        }
        this.fail("break outside loop");
        return false; // unreachable
      }
      case "log":
        this.adapter.log(LOG_LEVEL.info, cur.msg);
        this.advance(frame);
        return false;
    }
  }

  private eval(e: Expr, now: number): number {
    if (typeof e === "number") return fr(e);
    if ("sensor" in e) return fr(this.adapter.readSensor(e.sensor));
    if ("var" in e) return this.vars.get(e.var) ?? 0;
    if ("rand" in e) {
      const lo = roundInt(this.eval(e.rand[0], now));
      const hi = roundInt(this.eval(e.rand[1], now));
      if (lo > hi) this.fail("rand range invalid");
      return fr(this.adapter.random(lo, hi));
    }
    if ("cmp" in e) {
      const a = this.eval(e.cmp[0], now);
      const b = this.eval(e.cmp[2], now);
      switch (e.cmp[1]) {
        case "<":
          return a < b ? 1 : 0;
        case "<=":
          return a <= b ? 1 : 0;
        case ">":
          return a > b ? 1 : 0;
        case ">=":
          return a >= b ? 1 : 0;
        case "==":
          return a === b ? 1 : 0;
        case "!=":
          return a !== b ? 1 : 0;
      }
    }
    if ("math" in e) {
      const a = this.eval(e.math[0], now);
      const b = this.eval(e.math[2], now);
      switch (e.math[1]) {
        case "+":
          return fr(a + b);
        case "-":
          return fr(a - b);
        case "*":
          return fr(a * b);
        case "/":
          if (b === 0) this.fail("division by zero");
          return fr(a / b);
        case "min":
          return a < b ? a : b;
        case "max":
          return a > b ? a : b;
      }
    }
    if ("logic" in e) {
      const a = this.eval(e.logic[1], now);
      const b = this.eval(e.logic[2], now);
      return e.logic[0] === "and"
        ? truthy(a) && truthy(b)
          ? 1
          : 0
        : truthy(a) || truthy(b)
          ? 1
          : 0;
    }
    if ("not" in e) return this.eval(e.not, now) === 0 ? 1 : 0;
    // call
    return e.call === "elapsed_ms"
      ? fr(now - this.tStart)
      : fr(this.adapter.readSensor("battery.pct"));
  }
}
