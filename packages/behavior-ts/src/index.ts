/**
 * @botforge/behavior-ts — Behavior Script JSON (BSJ) types, zod schema, and
 * reference interpreter (PLAN.md §5.3). The C++ firmware VM
 * (packages/firmware/src/vm) implements identical semantics — see
 * SEMANTICS.md and the shared golden-trace fixtures in ./fixtures.
 */

export {
  BSJ_VERSION,
  BSJ_LIMITS,
  LOG_LEVEL,
  type BsjProgram,
  type BsjHandler,
  type BsjEvent,
  type BsjVar,
  type Stmt,
  type Expr,
  type CmpOperator,
  type MathOperator,
  type LogicOperator,
  type CallName,
} from "./types.js";

export { bsjProgramSchema, exprSchema, stmtSchema, parseBsj, countStatements } from "./schema.js";

export { BsjInterpreter, type RobotAdapter } from "./interpreter.js";
