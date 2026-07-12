/**
 * BSJ v1 zod schema — structural validation plus the §5.3 hard limits
 * (≤ 128 statements, ≤ 8 vars, ≤ 8 handlers, expression depth ≤ 32,
 * var references must be declared, on_tick ms ≥ 1).
 *
 * File-size (≤ 16 KB) is a property of the serialized text, so it is checked
 * by `parseBsj` when given a string (and by re-serializing when given an
 * object), not by the schema itself.
 */
import { z } from "zod";

import { BSJ_LIMITS, type BsjProgram, type Expr, type Stmt } from "./types.js";

const varNameSchema = z
  .string()
  .min(1)
  .max(15)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "invalid variable name");

const finiteNumber = z.number().finite();

export const exprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    finiteNumber,
    z.object({ sensor: z.string().min(1).max(31) }).strict(),
    z.object({ var: varNameSchema }).strict(),
    z.object({ rand: z.tuple([exprSchema, exprSchema]) }).strict(),
    z
      .object({
        cmp: z.tuple([exprSchema, z.enum(["<", "<=", ">", ">=", "==", "!="]), exprSchema]),
      })
      .strict(),
    z
      .object({
        math: z.tuple([exprSchema, z.enum(["+", "-", "*", "/", "min", "max"]), exprSchema]),
      })
      .strict(),
    z.object({ logic: z.tuple([z.enum(["and", "or"]), exprSchema, exprSchema]) }).strict(),
    z.object({ not: exprSchema }).strict(),
    z.object({ call: z.enum(["battery_pct", "elapsed_ms"]) }).strict(),
  ])
);

export const stmtSchema: z.ZodType<Stmt> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("drive"), l: exprSchema, r: exprSchema }).strict(),
    z
      .object({
        op: z.literal("drive_time"),
        l: exprSchema,
        r: exprSchema,
        ms: exprSchema,
      })
      .strict(),
    z.object({ op: z.literal("stop") }).strict(),
    z.object({ op: z.literal("servo"), id: z.string().min(1).max(31), deg: exprSchema }).strict(),
    z
      .object({
        op: z.literal("servo_sweep"),
        id: z.string().min(1).max(31),
        from: exprSchema,
        to: exprSchema,
        ms: exprSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal("led"),
        r: exprSchema,
        g: exprSchema,
        b: exprSchema,
        id: exprSchema.optional(),
      })
      .strict(),
    z.object({ op: z.literal("led_off"), id: exprSchema.optional() }).strict(),
    z.object({ op: z.literal("tone"), hz: exprSchema, ms: exprSchema }).strict(),
    z.object({ op: z.literal("wait"), ms: exprSchema }).strict(),
    z.object({ op: z.literal("set_var"), name: varNameSchema, value: exprSchema }).strict(),
    z.object({ op: z.literal("change_var"), name: varNameSchema, value: exprSchema }).strict(),
    z
      .object({
        op: z.literal("if"),
        cond: exprSchema,
        body: z.array(stmtSchema),
        else: z.array(stmtSchema).optional(),
      })
      .strict(),
    z.object({ op: z.literal("repeat"), n: exprSchema, body: z.array(stmtSchema) }).strict(),
    z.object({ op: z.literal("while"), cond: exprSchema, body: z.array(stmtSchema) }).strict(),
    z.object({ op: z.literal("forever"), body: z.array(stmtSchema) }).strict(),
    z.object({ op: z.literal("break") }).strict(),
    z.object({ op: z.literal("log"), msg: z.string().max(255) }).strict(),
  ])
);

const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("on_start") }).strict(),
  z.object({ type: z.literal("on_tick"), ms: z.number().int().min(1) }).strict(),
  z.object({ type: z.literal("on_button") }).strict(),
]);

const handlerSchema = z.object({ event: eventSchema, body: z.array(stmtSchema) }).strict();

/** Count statements recursively (each container counts itself + its bodies). */
export function countStatements(stmts: readonly Stmt[]): number {
  let n = 0;
  for (const s of stmts) {
    n += 1;
    if ("body" in s) n += countStatements(s.body);
    if ("else" in s && s.else) n += countStatements(s.else);
  }
  return n;
}

function exprDepth(e: Expr): number {
  if (typeof e === "number") return 1;
  if ("sensor" in e || "var" in e || "call" in e) return 1;
  if ("not" in e) return 1 + exprDepth(e.not);
  if ("rand" in e) return 1 + Math.max(exprDepth(e.rand[0]), exprDepth(e.rand[1]));
  if ("cmp" in e) return 1 + Math.max(exprDepth(e.cmp[0]), exprDepth(e.cmp[2]));
  if ("math" in e) return 1 + Math.max(exprDepth(e.math[0]), exprDepth(e.math[2]));
  return 1 + Math.max(exprDepth(e.logic[1]), exprDepth(e.logic[2]));
}

function collectExprs(s: Stmt): Expr[] {
  switch (s.op) {
    case "drive":
      return [s.l, s.r];
    case "drive_time":
      return [s.l, s.r, s.ms];
    case "servo":
      return [s.deg];
    case "servo_sweep":
      return [s.from, s.to, s.ms];
    case "led":
      return s.id === undefined ? [s.r, s.g, s.b] : [s.r, s.g, s.b, s.id];
    case "led_off":
      return s.id === undefined ? [] : [s.id];
    case "tone":
      return [s.hz, s.ms];
    case "wait":
      return [s.ms];
    case "set_var":
    case "change_var":
      return [s.value];
    case "if":
      return [s.cond];
    case "repeat":
      return [s.n];
    case "while":
      return [s.cond];
    default:
      return [];
  }
}

function checkStmts(stmts: readonly Stmt[], vars: ReadonlySet<string>, ctx: z.RefinementCtx): void {
  for (const s of stmts) {
    if ((s.op === "set_var" || s.op === "change_var") && !vars.has(s.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `undeclared variable "${s.name}"`,
      });
    }
    for (const e of collectExprs(s)) {
      if (exprDepth(e) > BSJ_LIMITS.maxExprDepth) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `expression deeper than ${BSJ_LIMITS.maxExprDepth} levels`,
        });
      }
      checkExprVars(e, vars, ctx);
    }
    if ("body" in s) checkStmts(s.body, vars, ctx);
    if ("else" in s && s.else) checkStmts(s.else, vars, ctx);
  }
}

function checkExprVars(e: Expr, vars: ReadonlySet<string>, ctx: z.RefinementCtx): void {
  if (typeof e === "number") return;
  if ("var" in e) {
    if (!vars.has(e.var)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `undeclared variable "${e.var}"`,
      });
    }
    return;
  }
  if ("not" in e) return checkExprVars(e.not, vars, ctx);
  if ("rand" in e) {
    checkExprVars(e.rand[0], vars, ctx);
    checkExprVars(e.rand[1], vars, ctx);
  } else if ("cmp" in e) {
    checkExprVars(e.cmp[0], vars, ctx);
    checkExprVars(e.cmp[2], vars, ctx);
  } else if ("math" in e) {
    checkExprVars(e.math[0], vars, ctx);
    checkExprVars(e.math[2], vars, ctx);
  } else if ("logic" in e) {
    checkExprVars(e.logic[1], vars, ctx);
    checkExprVars(e.logic[2], vars, ctx);
  }
}

export const bsjProgramSchema: z.ZodType<BsjProgram> = z
  .object({
    bsj: z.literal(1),
    name: z.string().max(63).optional(),
    vars: z
      .array(z.object({ name: varNameSchema, init: finiteNumber }).strict())
      .max(BSJ_LIMITS.maxVars)
      .optional(),
    handlers: z.array(handlerSchema).min(1).max(BSJ_LIMITS.maxHandlers),
  })
  .strict()
  .superRefine((program, ctx) => {
    const varNames = new Set<string>();
    for (const v of program.vars ?? []) {
      if (varNames.has(v.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate variable "${v.name}"`,
        });
      }
      varNames.add(v.name);
    }
    let total = 0;
    for (const h of program.handlers) total += countStatements(h.body);
    if (total > BSJ_LIMITS.maxStatements) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `program has ${total} statements (max ${BSJ_LIMITS.maxStatements})`,
      });
    }
    for (const h of program.handlers) checkStmts(h.body, varNames, ctx);
  });

/**
 * Parse + validate a BSJ program from a JSON string or a plain object.
 * Enforces the 16 KB file limit (on the given string, or on the
 * re-serialized object). Throws `Error` with a readable message on failure.
 */
export function parseBsj(input: string | unknown): BsjProgram {
  let data: unknown;
  let bytes: number;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input).length;
    if (bytes > BSJ_LIMITS.maxFileBytes) {
      throw new Error(`BSJ file is ${bytes} bytes (max ${BSJ_LIMITS.maxFileBytes})`);
    }
    try {
      data = JSON.parse(input);
    } catch {
      throw new Error("BSJ file is not valid JSON");
    }
  } else {
    data = input;
    bytes = new TextEncoder().encode(JSON.stringify(input)).length;
    if (bytes > BSJ_LIMITS.maxFileBytes) {
      throw new Error(`BSJ program serializes to ${bytes} bytes (max ${BSJ_LIMITS.maxFileBytes})`);
    }
  }
  const result = bsjProgramSchema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first.path.length > 0 ? ` at ${first.path.join(".")}` : "";
    throw new Error(`invalid BSJ: ${first.message}${path}`);
  }
  return result.data;
}
