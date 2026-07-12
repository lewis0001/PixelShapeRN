/**
 * botforge firmware — BSJ v1 data model (PLAN.md §5.3).
 *
 * Fixed-pool representation of a parsed Behavior Script JSON program: the
 * ArduinoJson document only lives during Vm::load(); afterwards everything
 * sits in the flat arrays below (zero heap after load).
 *
 * Execution semantics are pinned in packages/behavior-ts/SEMANTICS.md and
 * verified against the TypeScript reference interpreter by the shared golden
 * traces in packages/behavior-ts/fixtures/.
 */
#pragma once

#include <stdint.h>

namespace bsj {

// Limits (§5.3) — mirrored by BSJ_LIMITS in @botforge/behavior-ts.
constexpr int kMaxStmts = 128;
constexpr int kMaxExprs = 512; // expression pool (params + nested children)
constexpr int kMaxVars = 8;
constexpr int kMaxHandlers = 8;
constexpr int kMaxActivations = 4;
constexpr int kMaxFrames = 16;
constexpr size_t kMaxFileBytes = 16 * 1024;
constexpr int kMaxOpsPerTick = 200;
constexpr int kMaxExprDepth = 32;
constexpr size_t kStrArena = 4096; // string storage (names, log messages)

enum class Op : uint8_t {
  Drive,
  DriveTime,
  Stop,
  Servo,
  ServoSweep,
  Led,
  LedOff,
  Tone,
  Wait,
  SetVar,
  ChangeVar,
  If,
  Repeat,
  While,
  Forever,
  Break,
  Log,
};

enum class ExprKind : uint8_t { Num, Sensor, Var, Rand, Cmp, Math, Logic, Not, Call };
enum class CmpOp : uint8_t { Lt, Le, Gt, Ge, Eq, Ne };
enum class MathOp : uint8_t { Add, Sub, Mul, Div, Min, Max };
enum class LogicOp : uint8_t { And, Or };
enum class CallFn : uint8_t { BatteryPct, ElapsedMs };
enum class EventType : uint8_t { OnStart, OnTick, OnButton };

constexpr int16_t kNone = -1;    // "no statement / no expr / no child"
constexpr uint16_t kNoStr = 0xFFFF;

struct Expr {
  ExprKind kind;
  uint8_t sub;  // CmpOp / MathOp / LogicOp / CallFn discriminant
  int16_t a;    // first child expr index; Var: variable slot
  int16_t b;    // second child expr index
  float num;    // Num literal value
  uint16_t str; // arena offset (Sensor name)
};

struct Stmt {
  Op op;
  int16_t next;   // next sibling in the statement list (kNone = end)
  int16_t body;   // head of body list (kNone = empty)
  int16_t els;    // head of else list (kNone = none/empty)
  int16_t e[4];   // param exprs in §5.3 table order (kNone = absent)
  uint16_t str;   // arena offset: servo id / log msg (kNoStr = none)
  int8_t var;     // variable slot for set_var / change_var
};

struct Handler {
  EventType event;
  uint32_t ms;      // on_tick period
  int16_t body;     // head of the handler's statement list
  uint32_t nextDue; // next on_tick fire time (absolute ms)
};

enum class Phase : uint8_t { Run, Wait, Sweep };

// One level of the per-activation stack machine: a statement list position
// plus the state of the statement currently executing at that level.
struct Frame {
  int16_t stmt;       // current statement index (kNone = list exhausted)
  int16_t owner;      // container stmt that pushed this frame (kNone = root)
  Phase phase;
  uint32_t deadline;  // wait / drive_time / servo_sweep end (absolute ms)
  uint32_t count;     // remaining repeat iterations (container at `stmt`)
  float sweepFrom;
  float sweepTo;
  uint32_t sweepStart;
};

struct Activation {
  bool active;
  int8_t handler; // owning handler index
  int8_t top;     // top-of-stack frame index
  Frame frames[kMaxFrames];
};

} // namespace bsj
