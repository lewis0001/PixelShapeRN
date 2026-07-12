/**
 * botforge firmware — BSJ v1 behavior VM (PLAN.md §5.3).
 *
 * Statement-tree stack machine: each handler is an independent activation
 * with its own frame stack; waits are stored deadlines, never threads. The
 * host drives it: tick() at 50 Hz, onButton() on BOOT presses. All HAL
 * side effects go through VmHal so the same core runs against real drivers
 * (firmware) and against the mocked HAL in native golden-trace tests.
 *
 * Semantics contract: packages/behavior-ts/SEMANTICS.md — must stay trace-
 * identical to the TypeScript reference interpreter (shared fixtures in
 * packages/behavior-ts/fixtures/).
 */
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "Bsj.h"

/** Hardware abstraction the VM drives. Levels: 0 debug, 1 info, 2 warn, 3 error. */
struct VmHal {
  virtual void drive(int l, int r) = 0;
  virtual void servo(const char* id, int deg) = 0;
  virtual void led(int r, int g, int b, int id) = 0;
  virtual void ledOff(int id) = 0;
  virtual void tone(int hz, int ms) = 0;
  virtual float readSensor(const char* name) = 0;
  virtual void log(int level, const char* msg) = 0;
  virtual long random(long lo, long hi) = 0;
  virtual ~VmHal() = default;
};

class Vm {
 public:
  /**
   * Parse + validate a BSJ program into the fixed pools (zero heap after
   * load; the ArduinoJson document is scoped to this call). Returns false
   * and sets error() on invalid input. Stops any running behavior first.
   */
  bool load(const char* json, size_t len, VmHal* hal);
  /** Reset vars, arm on_tick timers, run on_start handlers at now_ms. */
  void start(uint32_t now_ms);
  /** Scheduler tick — call at 50 Hz with a monotonic ms clock. */
  void tick(uint32_t now_ms);
  /** Halt the behavior and stop the motors. */
  void stop();
  /** BOOT button pressed: fire idle on_button handlers immediately. */
  void onButton(uint32_t now_ms);
  bool running() const;
  /** Last load/runtime error message ("" if none). */
  const char* error() const;

 private:
  // --- load-time (parser) ---
  bool loadFail(const char* msg);
  int16_t parseStmtList(const void* arrVariant); // returns head or -2 on error
  int16_t parseStmt(const void* objVariant);     // returns index or kNone on error
  int16_t parseExpr(const void* variant, int depth);
  int16_t requireExpr(const void* objVariant, const char* key, int16_t stmtIdx);
  int findVar(const char* name) const;
  int32_t addString(const char* s); // arena offset or -1

  // --- runtime ---
  const char* str(uint16_t off) const { return &arena_[off]; }
  void fail(const char* msg);
  void clearActivations();
  int8_t spawn(int handlerIndex);
  bool pushFrame(bsj::Activation& act, int16_t bodyHead, int16_t ownerStmt);
  void advance(bsj::Frame& frame);
  void emitServo(const char* id, float deg);
  void stepActivation(bsj::Activation& act, uint32_t now);
  bool execute(bsj::Activation& act, bsj::Frame& frame, uint32_t now); // true = blocked
  float eval(int16_t exprIndex, uint32_t now);

  // --- fixed pools (§5.3: zero heap after load) ---
  bsj::Stmt stmts_[bsj::kMaxStmts];
  bsj::Expr exprs_[bsj::kMaxExprs];
  bsj::Handler handlers_[bsj::kMaxHandlers];
  bsj::Activation acts_[bsj::kMaxActivations];
  int8_t handlerAct_[bsj::kMaxHandlers]; // handler -> activation slot (-1 idle)
  float vars_[bsj::kMaxVars];
  float varInit_[bsj::kMaxVars];
  uint16_t varName_[bsj::kMaxVars]; // arena offsets
  char arena_[bsj::kStrArena];
  char error_[96] = {0};

  int stmtCount_ = 0;
  int exprCount_ = 0;
  int varCount_ = 0;
  int handlerCount_ = 0;
  size_t arenaUsed_ = 0;
  VmHal* hal_ = nullptr;
  bool loaded_ = false;
  bool running_ = false;
  uint32_t tStart_ = 0;
};
