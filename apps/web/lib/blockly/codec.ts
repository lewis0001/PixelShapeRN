/**
 * BSJ ↔ Blockly codec — pure data transforms on Blockly's JSON workspace
 * serialization (`Blockly.serialization.workspaces.save/load` format).
 *
 * No Blockly import: both directions operate on plain serialized state, so
 * the round-trip (`bsjToWorkspace` → `workspaceToBsj` === identity) is
 * testable in Node without a DOM.
 *
 * Mapping decisions (PLAN.md §5.3):
 * - Handlers are hat blocks (`bsj_on_*`); the handler body is the statement
 *   chain hanging off the hat's `next` connection. Handler order = top-block
 *   array order.
 * - `if` maps to TWO fixed blocks for a lossless optional else: `bsj_if`
 *   (no `else` key) and `bsj_if_else` (`else` always present, possibly `[]`).
 *   No mutator needed.
 * - `led`/`led_off` optional `id`: an ID value input that may be left empty.
 *   Empty socket ⇒ the `id` key is omitted (= all pixels).
 * - Program `vars` are standalone `bsj_var_decl` blocks (name + init fields).
 *   `workspaceToBsj` always emits a `vars` array (matching the house style of
 *   the shipped behaviors, which write `"vars": []` explicitly).
 * - Plain-number exprs become `bsj_number` SHADOW blocks on required inputs
 *   (toolbox-style editable defaults) and real blocks on optional inputs.
 *   Reading back prefers `block` over `shadow`, so both are equivalent.
 * - The program `name` lives in the page header, not on the canvas:
 *   `workspaceToBsj` takes it as an optional second argument and omits the
 *   key when it is undefined.
 * - An EMPTY required value socket exports as the literal `0` so the live
 *   meter can measure half-built programs; zod validation still gates export.
 * - Loose blocks on the canvas that are not hats or `bsj_var_decl` (e.g. a
 *   statement dragged off to the side) are ignored by `workspaceToBsj`.
 */

import {
  BSJ_LIMITS,
  countStatements,
  type BsjEvent,
  type BsjHandler,
  type BsjProgram,
  type BsjVar,
  type CallName,
  type CmpOperator,
  type Expr,
  type LogicOperator,
  type MathOperator,
  type Stmt,
} from "@botforge/behavior-ts";

/* ------------------------------------------------------------------ */
/* Blockly serialized-state shapes (subset we produce/consume)         */
/* ------------------------------------------------------------------ */

export interface ConnectionState {
  block?: BlockState;
  shadow?: BlockState;
}

export interface BlockState {
  type: string;
  id?: string;
  x?: number;
  y?: number;
  fields?: Record<string, string | number | boolean>;
  inputs?: Record<string, ConnectionState>;
  next?: ConnectionState;
  extraState?: unknown;
  [key: string]: unknown;
}

export interface WorkspaceState {
  blocks?: {
    languageVersion: number;
    blocks: BlockState[];
  };
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Block type / field / input names (must match lib/blockly/blocks.ts) */
/* ------------------------------------------------------------------ */

export const BSJ_EVENT_BLOCKS = {
  on_start: "bsj_on_start",
  on_tick: "bsj_on_tick",
  on_button: "bsj_on_button",
} as const;

export const VAR_DECL_BLOCK = "bsj_var_decl";

class CodecError extends Error {}

/* ------------------------------------------------------------------ */
/* Field helpers                                                       */
/* ------------------------------------------------------------------ */

function textField(block: BlockState, name: string): string {
  const v = block.fields?.[name];
  return v === undefined ? "" : String(v);
}

function numField(block: BlockState, name: string): number {
  const v = block.fields?.[name];
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function attached(conn: ConnectionState | undefined): BlockState | undefined {
  // A real block plugged over a shadow wins; otherwise the shadow counts.
  return conn?.block ?? conn?.shadow;
}

/* ------------------------------------------------------------------ */
/* workspace → BSJ                                                     */
/* ------------------------------------------------------------------ */

function exprFromBlock(block: BlockState): Expr {
  switch (block.type) {
    case "bsj_number":
      return numField(block, "NUM");
    case "bsj_sensor":
      return { sensor: textField(block, "SENSOR") };
    case "bsj_var_get":
      return { var: textField(block, "NAME") };
    case "bsj_rand":
      return { rand: [exprAt(block, "MIN"), exprAt(block, "MAX")] };
    case "bsj_cmp":
      return {
        cmp: [exprAt(block, "A"), textField(block, "OP") as CmpOperator, exprAt(block, "B")],
      };
    case "bsj_math":
      return {
        math: [exprAt(block, "A"), textField(block, "OP") as MathOperator, exprAt(block, "B")],
      };
    case "bsj_logic":
      return {
        logic: [textField(block, "OP") as LogicOperator, exprAt(block, "A"), exprAt(block, "B")],
      };
    case "bsj_not":
      return { not: exprAt(block, "A") };
    case "bsj_call":
      return { call: textField(block, "FN") as CallName };
    default:
      throw new CodecError(`unknown expression block type "${block.type}"`);
  }
}

/** Expr at a required input; an empty socket reads as the literal 0. */
function exprAt(block: BlockState, input: string): Expr {
  const child = attached(block.inputs?.[input]);
  return child ? exprFromBlock(child) : 0;
}

/** Expr at an optional input; an empty socket reads as "omitted". */
function optionalExprAt(block: BlockState, input: string): Expr | undefined {
  const child = attached(block.inputs?.[input]);
  return child ? exprFromBlock(child) : undefined;
}

/** Statement chain hanging off a `next`/statement-input connection. */
function stmtChain(conn: ConnectionState | undefined): Stmt[] {
  const out: Stmt[] = [];
  let block = attached(conn);
  while (block) {
    out.push(stmtFromBlock(block));
    block = attached(block.next);
  }
  return out;
}

function stmtFromBlock(block: BlockState): Stmt {
  switch (block.type) {
    case "bsj_drive":
      return { op: "drive", l: exprAt(block, "L"), r: exprAt(block, "R") };
    case "bsj_drive_time":
      return {
        op: "drive_time",
        l: exprAt(block, "L"),
        r: exprAt(block, "R"),
        ms: exprAt(block, "MS"),
      };
    case "bsj_stop":
      return { op: "stop" };
    case "bsj_servo":
      return { op: "servo", id: textField(block, "ID"), deg: exprAt(block, "DEG") };
    case "bsj_servo_sweep":
      return {
        op: "servo_sweep",
        id: textField(block, "ID"),
        from: exprAt(block, "FROM"),
        to: exprAt(block, "TO"),
        ms: exprAt(block, "MS"),
      };
    case "bsj_led": {
      const id = optionalExprAt(block, "ID");
      const stmt: Stmt = {
        op: "led",
        r: exprAt(block, "R"),
        g: exprAt(block, "G"),
        b: exprAt(block, "B"),
      };
      return id === undefined ? stmt : { ...stmt, id };
    }
    case "bsj_led_off": {
      const id = optionalExprAt(block, "ID");
      return id === undefined ? { op: "led_off" } : { op: "led_off", id };
    }
    case "bsj_tone":
      return { op: "tone", hz: exprAt(block, "HZ"), ms: exprAt(block, "MS") };
    case "bsj_wait":
      return { op: "wait", ms: exprAt(block, "MS") };
    case "bsj_set_var":
      return { op: "set_var", name: textField(block, "NAME"), value: exprAt(block, "VALUE") };
    case "bsj_change_var":
      return { op: "change_var", name: textField(block, "NAME"), value: exprAt(block, "VALUE") };
    case "bsj_if":
      return { op: "if", cond: exprAt(block, "COND"), body: stmtChain(block.inputs?.BODY) };
    case "bsj_if_else":
      return {
        op: "if",
        cond: exprAt(block, "COND"),
        body: stmtChain(block.inputs?.BODY),
        else: stmtChain(block.inputs?.ELSE),
      };
    case "bsj_repeat":
      return { op: "repeat", n: exprAt(block, "N"), body: stmtChain(block.inputs?.BODY) };
    case "bsj_while":
      return { op: "while", cond: exprAt(block, "COND"), body: stmtChain(block.inputs?.BODY) };
    case "bsj_forever":
      return { op: "forever", body: stmtChain(block.inputs?.BODY) };
    case "bsj_break":
      return { op: "break" };
    case "bsj_log":
      return { op: "log", msg: textField(block, "MSG") };
    default:
      throw new CodecError(`unknown statement block type "${block.type}"`);
  }
}

/**
 * Convert a serialized Blockly workspace to a BSJ program.
 *
 * Structural only — run the result through `parseBsj`/`bsjProgramSchema` to
 * enforce §5.3 limits before shipping it anywhere.
 */
export function workspaceToBsj(state: WorkspaceState, name?: string): BsjProgram {
  const tops = state.blocks?.blocks ?? [];
  const vars: BsjVar[] = [];
  const handlers: BsjHandler[] = [];

  for (const block of tops) {
    switch (block.type) {
      case VAR_DECL_BLOCK:
        vars.push({ name: textField(block, "NAME"), init: numField(block, "INIT") });
        break;
      case BSJ_EVENT_BLOCKS.on_start:
        handlers.push({ event: { type: "on_start" }, body: stmtChain(block.next) });
        break;
      case BSJ_EVENT_BLOCKS.on_tick:
        handlers.push({
          event: { type: "on_tick", ms: numField(block, "MS") },
          body: stmtChain(block.next),
        });
        break;
      case BSJ_EVENT_BLOCKS.on_button:
        handlers.push({ event: { type: "on_button" }, body: stmtChain(block.next) });
        break;
      default:
        // Loose fragment parked on the canvas — not part of the program.
        break;
    }
  }

  const program: BsjProgram = { bsj: 1, vars, handlers };
  if (name !== undefined) program.name = name;
  return program;
}

/* ------------------------------------------------------------------ */
/* BSJ → workspace                                                     */
/* ------------------------------------------------------------------ */

function numberBlock(n: number): BlockState {
  return { type: "bsj_number", fields: { NUM: n } };
}

function exprToBlock(e: Expr): BlockState {
  if (typeof e === "number") return numberBlock(e);
  if ("sensor" in e) return { type: "bsj_sensor", fields: { SENSOR: e.sensor } };
  if ("var" in e) return { type: "bsj_var_get", fields: { NAME: e.var } };
  if ("rand" in e) {
    return {
      type: "bsj_rand",
      inputs: { MIN: exprConn(e.rand[0]), MAX: exprConn(e.rand[1]) },
    };
  }
  if ("cmp" in e) {
    return {
      type: "bsj_cmp",
      fields: { OP: e.cmp[1] },
      inputs: { A: exprConn(e.cmp[0]), B: exprConn(e.cmp[2]) },
    };
  }
  if ("math" in e) {
    return {
      type: "bsj_math",
      fields: { OP: e.math[1] },
      inputs: { A: exprConn(e.math[0]), B: exprConn(e.math[2]) },
    };
  }
  if ("logic" in e) {
    return {
      type: "bsj_logic",
      fields: { OP: e.logic[0] },
      inputs: { A: exprConn(e.logic[1]), B: exprConn(e.logic[2]) },
    };
  }
  if ("not" in e) return { type: "bsj_not", inputs: { A: exprConn(e.not) } };
  if ("call" in e) return { type: "bsj_call", fields: { FN: e.call } };
  throw new CodecError(`unknown expression ${JSON.stringify(e)}`);
}

/** Required input: plain numbers become editable shadow blocks. */
function exprConn(e: Expr): ConnectionState {
  return typeof e === "number" ? { shadow: numberBlock(e) } : { block: exprToBlock(e) };
}

/** Optional input (led/led_off id): always a real, deletable block. */
function optionalExprConn(e: Expr): ConnectionState {
  return { block: exprToBlock(e) };
}

function chainConn(stmts: readonly Stmt[]): ConnectionState | undefined {
  let head: ConnectionState | undefined;
  let tail: BlockState | undefined;
  for (const s of stmts) {
    const block = stmtToBlock(s);
    if (tail) tail.next = { block };
    else head = { block };
    tail = block;
  }
  return head;
}

function bodyInput(stmts: readonly Stmt[]): Record<string, ConnectionState> {
  const conn = chainConn(stmts);
  return conn ? { BODY: conn } : {};
}

function stmtToBlock(s: Stmt): BlockState {
  switch (s.op) {
    case "drive":
      return { type: "bsj_drive", inputs: { L: exprConn(s.l), R: exprConn(s.r) } };
    case "drive_time":
      return {
        type: "bsj_drive_time",
        inputs: { L: exprConn(s.l), R: exprConn(s.r), MS: exprConn(s.ms) },
      };
    case "stop":
      return { type: "bsj_stop" };
    case "servo":
      return { type: "bsj_servo", fields: { ID: s.id }, inputs: { DEG: exprConn(s.deg) } };
    case "servo_sweep":
      return {
        type: "bsj_servo_sweep",
        fields: { ID: s.id },
        inputs: { FROM: exprConn(s.from), TO: exprConn(s.to), MS: exprConn(s.ms) },
      };
    case "led": {
      const inputs: Record<string, ConnectionState> = {
        R: exprConn(s.r),
        G: exprConn(s.g),
        B: exprConn(s.b),
      };
      if (s.id !== undefined) inputs.ID = optionalExprConn(s.id);
      return { type: "bsj_led", inputs };
    }
    case "led_off":
      return s.id === undefined
        ? { type: "bsj_led_off" }
        : { type: "bsj_led_off", inputs: { ID: optionalExprConn(s.id) } };
    case "tone":
      return { type: "bsj_tone", inputs: { HZ: exprConn(s.hz), MS: exprConn(s.ms) } };
    case "wait":
      return { type: "bsj_wait", inputs: { MS: exprConn(s.ms) } };
    case "set_var":
      return {
        type: "bsj_set_var",
        fields: { NAME: s.name },
        inputs: { VALUE: exprConn(s.value) },
      };
    case "change_var":
      return {
        type: "bsj_change_var",
        fields: { NAME: s.name },
        inputs: { VALUE: exprConn(s.value) },
      };
    case "if": {
      const inputs: Record<string, ConnectionState> = {
        COND: exprConn(s.cond),
        ...bodyInput(s.body),
      };
      if (s.else === undefined) return { type: "bsj_if", inputs };
      const elseConn = chainConn(s.else);
      if (elseConn) inputs.ELSE = elseConn;
      return { type: "bsj_if_else", inputs };
    }
    case "repeat":
      return { type: "bsj_repeat", inputs: { N: exprConn(s.n), ...bodyInput(s.body) } };
    case "while":
      return { type: "bsj_while", inputs: { COND: exprConn(s.cond), ...bodyInput(s.body) } };
    case "forever":
      return { type: "bsj_forever", inputs: { ...bodyInput(s.body) } };
    case "break":
      return { type: "bsj_break" };
    case "log":
      return { type: "bsj_log", fields: { MSG: s.msg } };
    default:
      throw new CodecError(`unknown op ${JSON.stringify((s as { op?: unknown }).op)}`);
  }
}

function eventBlock(event: BsjEvent): BlockState {
  switch (event.type) {
    case "on_start":
      return { type: BSJ_EVENT_BLOCKS.on_start };
    case "on_tick":
      return { type: BSJ_EVENT_BLOCKS.on_tick, fields: { MS: event.ms } };
    case "on_button":
      return { type: BSJ_EVENT_BLOCKS.on_button };
    default:
      throw new CodecError(`unknown event ${JSON.stringify(event)}`);
  }
}

/**
 * Convert a BSJ program to serialized Blockly workspace state: one
 * `bsj_var_decl` block per var, then one hat block (with its body chained
 * off `next`) per handler, laid out top-to-bottom.
 */
export function bsjToWorkspace(program: BsjProgram): WorkspaceState {
  const tops: BlockState[] = [];
  const x = 24;
  let y = 24;

  for (const v of program.vars ?? []) {
    tops.push({ type: VAR_DECL_BLOCK, x, y, fields: { NAME: v.name, INIT: v.init } });
    y += 56;
  }
  if (tops.length > 0) y += 24;

  for (const handler of program.handlers) {
    const hat = eventBlock(handler.event);
    hat.x = x;
    hat.y = y;
    const body = chainConn(handler.body);
    if (body) hat.next = body;
    tops.push(hat);
    // Rough vertical clearance: hat + one row per (possibly nested) statement.
    y += 88 + 44 * countStatements(handler.body);
  }

  return { blocks: { languageVersion: 0, blocks: tops } };
}

/* ------------------------------------------------------------------ */
/* Limits meter                                                        */
/* ------------------------------------------------------------------ */

export interface BsjMeter {
  /** Statements across all handlers, counted recursively (§5.3 "blocks"). */
  statements: number;
  maxStatements: number;
  /** Serialized UTF-8 byte size of the program JSON. */
  bytes: number;
  maxBytes: number;
  overStatements: boolean;
  overBytes: boolean;
  /** True when any §5.3 limit is exceeded. */
  over: boolean;
}

/** Compute the live "N/128 blocks · X.X/16 KB" meter for a program. */
export function measureBsj(program: BsjProgram): BsjMeter {
  const statements = program.handlers.reduce((n, h) => n + countStatements(h.body), 0);
  const bytes = new TextEncoder().encode(JSON.stringify(program)).length;
  const overStatements = statements > BSJ_LIMITS.maxStatements;
  const overBytes = bytes > BSJ_LIMITS.maxFileBytes;
  return {
    statements,
    maxStatements: BSJ_LIMITS.maxStatements,
    bytes,
    maxBytes: BSJ_LIMITS.maxFileBytes,
    overStatements,
    overBytes,
    over: overStatements || overBytes,
  };
}

/** Format a byte count as the meter's "X.X" KB figure. */
export function formatKb(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}
