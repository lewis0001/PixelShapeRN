/**
 * RobotLink protocol interface + §5.4 message types — a VERBATIM COPY of
 * `apps/web/lib/robotlink/{types.ts, RobotLink.ts}` (minus the HTTP config
 * types the sim does not need).
 *
 * Why a copy: packages must not import from `apps/web` (workspace layering —
 * apps depend on packages, never the reverse). The shape is kept IDENTICAL
 * so that `SimLink` structurally satisfies the app's `RobotLink` interface
 * with zero adaptation. If PLAN.md §5.4 or the app-side module changes,
 * change both files together.
 */

export type RobotMode = "manual" | "behavior";

export type LogLevel = "debug" | "info" | "warn" | "error";

/* ------------------------------------------------------------------ */
/* App → robot                                                         */
/* ------------------------------------------------------------------ */

/** First message after the socket opens. */
export interface HelloMsg {
  t: "hello";
}

/** Keepalive, sent every 500 ms by the app (feeds the 800 ms deadman). */
export interface PingMsg {
  t: "ping";
}

/** Switch between manual driving and the on-device behavior. */
export interface ModeMsg {
  t: "mode";
  mode: RobotMode;
}

/** Wheel power, −100..100 per side. */
export interface CmdDriveMsg {
  t: "cmd.drive";
  l: number;
  r: number;
}

/** Servo position; `id` is the module instance id from config.json. */
export interface CmdServoMsg {
  t: "cmd.servo";
  id: string;
  deg: number;
}

/** LED color — params as the BSJ `led` op: r/g/b 0–255, id omitted = all pixels. */
export interface CmdLedMsg {
  t: "cmd.led";
  r: number;
  g: number;
  b: number;
  id?: number;
}

/** Buzzer tone — params as the BSJ `tone` op. */
export interface CmdToneMsg {
  t: "cmd.tone";
  hz: number;
  ms: number;
}

export type AppToRobotMsg =
  HelloMsg | PingMsg | ModeMsg | CmdDriveMsg | CmdServoMsg | CmdLedMsg | CmdToneMsg;

/* ------------------------------------------------------------------ */
/* Robot → app                                                         */
/* ------------------------------------------------------------------ */

/** Identity payload of `hello.ack`. */
export interface RobotInfo {
  fw: string;
  robot_id: string;
  name: string;
  cfg_hash: string;
}

export interface HelloAckMsg extends RobotInfo {
  t: "hello.ack";
}

/** Live sensor readings keyed by module instance id. */
export interface TelemetrySensors {
  range?: { mm: number };
  line?: { l: number; r: number };
  [instance: string]: Record<string, number> | undefined;
}

/** Telemetry payload, emitted by the robot at 5 Hz. */
export interface Telemetry {
  batt_mv: number;
  rssi: number;
  mode: RobotMode;
  behavior_running: boolean;
  sensors: TelemetrySensors;
}

export interface TelemetryMsg extends Telemetry {
  t: "telemetry";
}

export interface LogEntry {
  level: LogLevel;
  msg: string;
}

export interface LogMsg extends LogEntry {
  t: "log";
}

export type RobotToAppMsg = HelloAckMsg | TelemetryMsg | LogMsg;

export type RobotMsg = AppToRobotMsg | RobotToAppMsg;

/* ------------------------------------------------------------------ */
/* RobotLink interface (apps/web/lib/robotlink/RobotLink.ts)           */
/* ------------------------------------------------------------------ */

export type LinkState = "disconnected" | "connecting" | "connected";

/** Events a RobotLink can emit, with their callback payloads. */
export interface RobotLinkEvents {
  /** Transport is open (for WsLink: socket opened, hello sent). */
  open: void;
  /** Transport closed — intentionally or not. */
  close: void;
  /** Robot answered our hello with its identity. */
  "hello.ack": RobotInfo;
  /** 5 Hz telemetry frame. */
  telemetry: Telemetry;
  /** Robot log line. */
  log: LogEntry;
}

export type RobotLinkEventName = keyof RobotLinkEvents;

export interface RobotLink {
  /** Resolves once the transport is open (hello sent). Rejects on failure. */
  connect(): Promise<void>;
  /** Tear down the transport; no auto-reconnect afterwards. */
  disconnect(): void;
  /** Fire-and-forget send; silently dropped while not connected. */
  send(msg: AppToRobotMsg): void;
  /** Subscribe to a link event. Returns an unsubscribe function. */
  on<E extends RobotLinkEventName>(event: E, cb: (payload: RobotLinkEvents[E]) => void): () => void;
  readonly state: LinkState;
}

/**
 * Minimal typed event emitter for RobotLink implementations (WsLink,
 * SimLink). Listener errors are swallowed so one bad subscriber can't
 * break the transport.
 */
export class RobotLinkEmitter {
  private listeners = new Map<RobotLinkEventName, Set<(payload: never) => void>>();

  on<E extends RobotLinkEventName>(
    event: E,
    cb: (payload: RobotLinkEvents[E]) => void
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb as (payload: never) => void);
    return () => {
      set.delete(cb as (payload: never) => void);
    };
  }

  protected emit<E extends RobotLinkEventName>(event: E, payload: RobotLinkEvents[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        (cb as (p: RobotLinkEvents[E]) => void)(payload);
      } catch {
        // A subscriber threw — never let that take down the link.
      }
    }
  }
}
