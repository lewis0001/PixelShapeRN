/**
 * BOTFORGE robot protocol types — PLAN.md §5.4, verbatim.
 *
 * WebSocket (port 81, path `/ws`), JSON messages. Every message carries a
 * `t` discriminator. App→robot: hello, ping, mode, cmd.drive, cmd.servo,
 * cmd.led, cmd.tone. Robot→app: hello.ack, telemetry (5 Hz), log.
 *
 * These types are shared by every transport (`WsLink` today, the Phase-3
 * in-page `SimLink`) — keep this module dependency-free.
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
/* HTTP API (port 80) — PLAN.md §5.4 / §5.5                            */
/* ------------------------------------------------------------------ */

/** One module entry of `GET /api/config` (firmware config.json, §5.5). */
export interface RobotConfigModule {
  id: string;
  driver: string;
  pins: Record<string, number | null>;
  params: Record<string, unknown>;
}

/** `GET /api/config` response shape. */
export interface RobotConfig {
  cfg: number;
  robot_id: string;
  name_default: string;
  autostart?: string;
  modules: RobotConfigModule[];
}
