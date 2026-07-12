/**
 * Behavior Script JSON (BSJ) v1 — TypeScript types.
 *
 * The one program format (PLAN.md §5.3): a statement tree produced by the
 * Blockly builder, interpreted identically by this package's reference
 * interpreter and the C++ firmware VM (packages/firmware/src/vm).
 */

/** Current Behavior Script JSON (BSJ) format version. */
export const BSJ_VERSION = 1;

/** Hard limits shared by both interpreters (PLAN.md §5.3). */
export const BSJ_LIMITS = {
  /** Max statements per program, counted recursively over all bodies. */
  maxStatements: 128,
  /** Max declared variables. */
  maxVars: 8,
  /** Max event handlers. */
  maxHandlers: 8,
  /** Max serialized file size in bytes. */
  maxFileBytes: 16 * 1024,
  /** Max concurrently running handler activations. */
  maxActivations: 4,
  /** Max frame depth per activation (statement-list nesting at runtime). */
  maxFrames: 16,
  /** Op budget per handler activation per scheduler tick (runaway guard). */
  maxOpsPerTick: 200,
  /** Max expression nesting depth. */
  maxExprDepth: 32,
} as const;

export type CmpOperator = "<" | "<=" | ">" | ">=" | "==" | "!=";
export type MathOperator = "+" | "-" | "*" | "/" | "min" | "max";
export type LogicOperator = "and" | "or";
export type CallName = "battery_pct" | "elapsed_ms";

/** Expression grammar (§5.3). Plain numbers are literals. */
export type Expr =
  | number
  | { sensor: string }
  | { var: string }
  | { rand: [Expr, Expr] }
  | { cmp: [Expr, CmpOperator, Expr] }
  | { math: [Expr, MathOperator, Expr] }
  | { logic: [LogicOperator, Expr, Expr] }
  | { not: Expr }
  | { call: CallName };

/** The complete v1 op set (§5.3 — do not add ops without a DECISIONS entry). */
export type Stmt =
  | { op: "drive"; l: Expr; r: Expr }
  | { op: "drive_time"; l: Expr; r: Expr; ms: Expr }
  | { op: "stop" }
  | { op: "servo"; id: string; deg: Expr }
  | { op: "servo_sweep"; id: string; from: Expr; to: Expr; ms: Expr }
  | { op: "led"; r: Expr; g: Expr; b: Expr; id?: Expr }
  | { op: "led_off"; id?: Expr }
  | { op: "tone"; hz: Expr; ms: Expr }
  | { op: "wait"; ms: Expr }
  | { op: "set_var"; name: string; value: Expr }
  | { op: "change_var"; name: string; value: Expr }
  | { op: "if"; cond: Expr; body: Stmt[]; else?: Stmt[] }
  | { op: "repeat"; n: Expr; body: Stmt[] }
  | { op: "while"; cond: Expr; body: Stmt[] }
  | { op: "forever"; body: Stmt[] }
  | { op: "break" }
  | { op: "log"; msg: string };

export type BsjEvent =
  { type: "on_start" } | { type: "on_tick"; ms: number } | { type: "on_button" };

export interface BsjVar {
  name: string;
  init: number;
}

export interface BsjHandler {
  event: BsjEvent;
  body: Stmt[];
}

export interface BsjProgram {
  bsj: typeof BSJ_VERSION;
  name?: string;
  vars?: BsjVar[];
  handlers: BsjHandler[];
}

/** Log levels used by the `log` HAL call. */
export const LOG_LEVEL = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;
