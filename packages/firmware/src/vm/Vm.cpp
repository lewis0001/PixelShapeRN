/**
 * botforge firmware — BSJ v1 behavior VM implementation.
 *
 * Parse: ArduinoJson 7 document (heap only for the duration of load()) walked
 * once into the fixed pools declared in Bsj.h. Run: per-handler stack
 * machines with stored deadlines, stepped from tick()/onButton().
 *
 * Must stay trace-identical to packages/behavior-ts/src/interpreter.ts —
 * see packages/behavior-ts/SEMANTICS.md for the normative semantics and
 * packages/behavior-ts/fixtures/ for the shared golden traces.
 */
#include "Vm.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

#include <ArduinoJson.h>

using namespace bsj;

namespace {

/** floor(x + 0.5) in float32 — identical to the TS reference's roundInt. */
long roundInt(float x) { return (long)floorf(x + 0.5f); }

long clampL(long v, long lo, long hi) { return v < lo ? lo : (v > hi ? hi : v); }

bool truthy(float v) { return v != 0.0f; }

JsonVariantConst asVariant(const void* p) {
  return *static_cast<const JsonVariantConst*>(p);
}

} // namespace

// ---------------------------------------------------------------------------
// Load / parse
// ---------------------------------------------------------------------------

bool Vm::loadFail(const char* msg) {
  snprintf(error_, sizeof(error_), "%s", msg);
  loaded_ = false;
  return false;
}

int Vm::findVar(const char* name) const {
  for (int i = 0; i < varCount_; i++) {
    if (strcmp(str(varName_[i]), name) == 0) return i;
  }
  return -1;
}

int32_t Vm::addString(const char* s) {
  if (s == nullptr) return -1;
  size_t len = strlen(s) + 1;
  if (arenaUsed_ + len > kStrArena) return -1;
  memcpy(&arena_[arenaUsed_], s, len);
  int32_t off = (int32_t)arenaUsed_;
  arenaUsed_ += len;
  return off;
}

int16_t Vm::parseExpr(const void* variantPtr, int depth) {
  JsonVariantConst v = asVariant(variantPtr);
  if (depth > kMaxExprDepth) {
    loadFail("expression too deep");
    return kNone;
  }
  if (exprCount_ >= kMaxExprs) {
    loadFail("too many expressions");
    return kNone;
  }
  int16_t idx = (int16_t)exprCount_++;
  Expr& e = exprs_[idx];
  e = Expr{ExprKind::Num, 0, kNone, kNone, 0.0f, kNoStr};

  if (v.is<float>()) { // true for any JSON number
    e.kind = ExprKind::Num;
    e.num = v.as<float>();
    return idx;
  }
  JsonObjectConst o = v.as<JsonObjectConst>();
  if (o.isNull()) {
    loadFail("invalid expression");
    return kNone;
  }

  if (!o["sensor"].isNull()) {
    const char* name = o["sensor"].as<const char*>();
    int32_t off = addString(name);
    if (off < 0) {
      loadFail("invalid sensor name");
      return kNone;
    }
    e.kind = ExprKind::Sensor;
    e.str = (uint16_t)off;
    return idx;
  }
  if (!o["var"].isNull()) {
    const char* name = o["var"].as<const char*>();
    int slot = name ? findVar(name) : -1;
    if (slot < 0) {
      loadFail("undeclared variable");
      return kNone;
    }
    e.kind = ExprKind::Var;
    e.a = (int16_t)slot;
    return idx;
  }
  if (!o["rand"].isNull()) {
    JsonArrayConst arr = o["rand"].as<JsonArrayConst>();
    if (arr.isNull() || arr.size() != 2) {
      loadFail("rand needs [min,max]");
      return kNone;
    }
    JsonVariantConst a0 = arr[0], a1 = arr[1];
    int16_t a = parseExpr(&a0, depth + 1);
    if (a == kNone) return kNone;
    int16_t b = parseExpr(&a1, depth + 1);
    if (b == kNone) return kNone;
    Expr& self = exprs_[idx]; // exprs_ is a fixed array: idx stays valid
    self.kind = ExprKind::Rand;
    self.a = a;
    self.b = b;
    return idx;
  }
  if (!o["cmp"].isNull() || !o["math"].isNull()) {
    bool isCmp = !o["cmp"].isNull();
    JsonArrayConst arr = (isCmp ? o["cmp"] : o["math"]).as<JsonArrayConst>();
    if (arr.isNull() || arr.size() != 3) {
      loadFail(isCmp ? "cmp needs [a,op,b]" : "math needs [a,op,b]");
      return kNone;
    }
    const char* op = arr[1].as<const char*>();
    uint8_t sub = 0xFF;
    if (isCmp) {
      if (op == nullptr) sub = 0xFF;
      else if (strcmp(op, "<") == 0) sub = (uint8_t)CmpOp::Lt;
      else if (strcmp(op, "<=") == 0) sub = (uint8_t)CmpOp::Le;
      else if (strcmp(op, ">") == 0) sub = (uint8_t)CmpOp::Gt;
      else if (strcmp(op, ">=") == 0) sub = (uint8_t)CmpOp::Ge;
      else if (strcmp(op, "==") == 0) sub = (uint8_t)CmpOp::Eq;
      else if (strcmp(op, "!=") == 0) sub = (uint8_t)CmpOp::Ne;
    } else {
      if (op == nullptr) sub = 0xFF;
      else if (strcmp(op, "+") == 0) sub = (uint8_t)MathOp::Add;
      else if (strcmp(op, "-") == 0) sub = (uint8_t)MathOp::Sub;
      else if (strcmp(op, "*") == 0) sub = (uint8_t)MathOp::Mul;
      else if (strcmp(op, "/") == 0) sub = (uint8_t)MathOp::Div;
      else if (strcmp(op, "min") == 0) sub = (uint8_t)MathOp::Min;
      else if (strcmp(op, "max") == 0) sub = (uint8_t)MathOp::Max;
    }
    if (sub == 0xFF) {
      loadFail(isCmp ? "unknown cmp op" : "unknown math op");
      return kNone;
    }
    JsonVariantConst a0 = arr[0], a2 = arr[2];
    int16_t a = parseExpr(&a0, depth + 1);
    if (a == kNone) return kNone;
    int16_t b = parseExpr(&a2, depth + 1);
    if (b == kNone) return kNone;
    Expr& self = exprs_[idx];
    self.kind = isCmp ? ExprKind::Cmp : ExprKind::Math;
    self.sub = sub;
    self.a = a;
    self.b = b;
    return idx;
  }
  if (!o["logic"].isNull()) {
    JsonArrayConst arr = o["logic"].as<JsonArrayConst>();
    if (arr.isNull() || arr.size() != 3) {
      loadFail("logic needs [op,a,b]");
      return kNone;
    }
    const char* op = arr[0].as<const char*>();
    uint8_t sub;
    if (op != nullptr && strcmp(op, "and") == 0) sub = (uint8_t)LogicOp::And;
    else if (op != nullptr && strcmp(op, "or") == 0) sub = (uint8_t)LogicOp::Or;
    else {
      loadFail("unknown logic op");
      return kNone;
    }
    JsonVariantConst a1 = arr[1], a2 = arr[2];
    int16_t a = parseExpr(&a1, depth + 1);
    if (a == kNone) return kNone;
    int16_t b = parseExpr(&a2, depth + 1);
    if (b == kNone) return kNone;
    Expr& self = exprs_[idx];
    self.kind = ExprKind::Logic;
    self.sub = sub;
    self.a = a;
    self.b = b;
    return idx;
  }
  if (!o["not"].isNull()) {
    JsonVariantConst child = o["not"];
    int16_t a = parseExpr(&child, depth + 1);
    if (a == kNone) return kNone;
    Expr& self = exprs_[idx];
    self.kind = ExprKind::Not;
    self.a = a;
    return idx;
  }
  if (!o["call"].isNull()) {
    const char* fn = o["call"].as<const char*>();
    if (fn != nullptr && strcmp(fn, "battery_pct") == 0) e.sub = (uint8_t)CallFn::BatteryPct;
    else if (fn != nullptr && strcmp(fn, "elapsed_ms") == 0) e.sub = (uint8_t)CallFn::ElapsedMs;
    else {
      loadFail("unknown call");
      return kNone;
    }
    e.kind = ExprKind::Call;
    return idx;
  }
  loadFail("unknown expression");
  return kNone;
}

int16_t Vm::requireExpr(const void* objPtr, const char* key, int16_t /*stmtIdx*/) {
  JsonObjectConst o = asVariant(objPtr).as<JsonObjectConst>();
  JsonVariantConst v = o[key];
  if (v.isNull() && !v.is<float>()) {
    // Missing param (explicit JSON null is also rejected).
    loadFail("missing statement param");
    return kNone;
  }
  return parseExpr(&v, 1);
}

// Returns list head (kNone for empty) or -2 on error.
int16_t Vm::parseStmtList(const void* variantPtr) {
  JsonVariantConst v = asVariant(variantPtr);
  if (v.isNull()) return kNone; // absent body/else = empty list
  JsonArrayConst arr = v.as<JsonArrayConst>();
  if (arr.isNull()) {
    loadFail("body must be an array");
    return -2;
  }
  int16_t head = kNone;
  int16_t prev = kNone;
  for (JsonVariantConst item : arr) {
    int16_t idx = parseStmt(&item);
    if (idx == kNone) return -2;
    if (prev == kNone) head = idx;
    else stmts_[prev].next = idx;
    prev = idx;
  }
  return head;
}

int16_t Vm::parseStmt(const void* variantPtr) {
  JsonObjectConst o = asVariant(variantPtr).as<JsonObjectConst>();
  const char* op = o["op"].as<const char*>();
  if (o.isNull() || op == nullptr) {
    loadFail("statement needs an op");
    return kNone;
  }
  if (stmtCount_ >= kMaxStmts) {
    loadFail("too many statements");
    return kNone;
  }
  int16_t idx = (int16_t)stmtCount_++;
  stmts_[idx] = Stmt{Op::Stop, kNone, kNone, kNone, {kNone, kNone, kNone, kNone}, kNoStr, -1};
  JsonVariantConst self = asVariant(variantPtr);

  if (strcmp(op, "drive") == 0 || strcmp(op, "drive_time") == 0) {
    bool timed = op[5] != '\0';
    stmts_[idx].op = timed ? Op::DriveTime : Op::Drive;
    if ((stmts_[idx].e[0] = requireExpr(&self, "l", idx)) == kNone) return kNone;
    if ((stmts_[idx].e[1] = requireExpr(&self, "r", idx)) == kNone) return kNone;
    if (timed && (stmts_[idx].e[2] = requireExpr(&self, "ms", idx)) == kNone) return kNone;
    return idx;
  }
  if (strcmp(op, "stop") == 0) {
    stmts_[idx].op = Op::Stop;
    return idx;
  }
  if (strcmp(op, "servo") == 0 || strcmp(op, "servo_sweep") == 0) {
    bool sweep = op[5] != '\0';
    stmts_[idx].op = sweep ? Op::ServoSweep : Op::Servo;
    int32_t off = addString(o["id"].as<const char*>());
    if (off < 0) {
      loadFail("servo needs an id");
      return kNone;
    }
    stmts_[idx].str = (uint16_t)off;
    if (sweep) {
      if ((stmts_[idx].e[0] = requireExpr(&self, "from", idx)) == kNone) return kNone;
      if ((stmts_[idx].e[1] = requireExpr(&self, "to", idx)) == kNone) return kNone;
      if ((stmts_[idx].e[2] = requireExpr(&self, "ms", idx)) == kNone) return kNone;
    } else {
      if ((stmts_[idx].e[0] = requireExpr(&self, "deg", idx)) == kNone) return kNone;
    }
    return idx;
  }
  if (strcmp(op, "led") == 0) {
    stmts_[idx].op = Op::Led;
    if ((stmts_[idx].e[0] = requireExpr(&self, "r", idx)) == kNone) return kNone;
    if ((stmts_[idx].e[1] = requireExpr(&self, "g", idx)) == kNone) return kNone;
    if ((stmts_[idx].e[2] = requireExpr(&self, "b", idx)) == kNone) return kNone;
    if (!o["id"].isNull() &&
        (stmts_[idx].e[3] = requireExpr(&self, "id", idx)) == kNone)
      return kNone;
    return idx;
  }
  if (strcmp(op, "led_off") == 0) {
    stmts_[idx].op = Op::LedOff;
    if (!o["id"].isNull() &&
        (stmts_[idx].e[0] = requireExpr(&self, "id", idx)) == kNone)
      return kNone;
    return idx;
  }
  if (strcmp(op, "tone") == 0) {
    stmts_[idx].op = Op::Tone;
    if ((stmts_[idx].e[0] = requireExpr(&self, "hz", idx)) == kNone) return kNone;
    if ((stmts_[idx].e[1] = requireExpr(&self, "ms", idx)) == kNone) return kNone;
    return idx;
  }
  if (strcmp(op, "wait") == 0) {
    stmts_[idx].op = Op::Wait;
    if ((stmts_[idx].e[0] = requireExpr(&self, "ms", idx)) == kNone) return kNone;
    return idx;
  }
  if (strcmp(op, "set_var") == 0 || strcmp(op, "change_var") == 0) {
    stmts_[idx].op = op[0] == 's' ? Op::SetVar : Op::ChangeVar;
    const char* name = o["name"].as<const char*>();
    int slot = name ? findVar(name) : -1;
    if (slot < 0) {
      loadFail("undeclared variable");
      return kNone;
    }
    stmts_[idx].var = (int8_t)slot;
    if ((stmts_[idx].e[0] = requireExpr(&self, "value", idx)) == kNone) return kNone;
    return idx;
  }
  if (strcmp(op, "if") == 0) {
    stmts_[idx].op = Op::If;
    if ((stmts_[idx].e[0] = requireExpr(&self, "cond", idx)) == kNone) return kNone;
    JsonVariantConst body = o["body"];
    int16_t bh = parseStmtList(&body);
    if (bh == -2) return kNone;
    stmts_[idx].body = bh;
    JsonVariantConst els = o["else"];
    int16_t eh = parseStmtList(&els);
    if (eh == -2) return kNone;
    stmts_[idx].els = eh;
    return idx;
  }
  if (strcmp(op, "repeat") == 0 || strcmp(op, "while") == 0 ||
      strcmp(op, "forever") == 0) {
    if (op[0] == 'r') {
      stmts_[idx].op = Op::Repeat;
      if ((stmts_[idx].e[0] = requireExpr(&self, "n", idx)) == kNone) return kNone;
    } else if (op[0] == 'w') {
      stmts_[idx].op = Op::While;
      if ((stmts_[idx].e[0] = requireExpr(&self, "cond", idx)) == kNone) return kNone;
    } else {
      stmts_[idx].op = Op::Forever;
    }
    JsonVariantConst body = o["body"];
    int16_t bh = parseStmtList(&body);
    if (bh == -2) return kNone;
    stmts_[idx].body = bh;
    return idx;
  }
  if (strcmp(op, "break") == 0) {
    stmts_[idx].op = Op::Break;
    return idx;
  }
  if (strcmp(op, "log") == 0) {
    stmts_[idx].op = Op::Log;
    int32_t off = addString(o["msg"].as<const char*>());
    if (off < 0) {
      loadFail("log needs a msg");
      return kNone;
    }
    stmts_[idx].str = (uint16_t)off;
    return idx;
  }
  loadFail("unknown op");
  return kNone;
}

bool Vm::load(const char* json, size_t len, VmHal* hal) {
  if (running_ && hal_ != nullptr) hal_->drive(0, 0); // replacing a live program
  running_ = false;
  loaded_ = false;
  error_[0] = '\0';
  hal_ = hal;
  stmtCount_ = exprCount_ = varCount_ = handlerCount_ = 0;
  arenaUsed_ = 0;
  clearActivations();
  if (json == nullptr || hal == nullptr) return loadFail("null program or hal");
  if (len > kMaxFileBytes) return loadFail("file exceeds 16KB");

  JsonDocument doc; // heap only for the duration of load()
  // Statement trees nest deeply (each if/loop level = 2 JSON levels), so the
  // default nesting limit of 10 is too strict; 64 covers any ≤128-stmt tree
  // we accept while still bounding parser recursion on-device.
  DeserializationError derr =
      deserializeJson(doc, json, len, DeserializationOption::NestingLimit(64));
  if (derr) return loadFail("invalid JSON");
  if (doc["bsj"].as<long>() != 1) return loadFail("unsupported bsj version");

  JsonVariantConst varsV = doc["vars"];
  if (!varsV.isNull()) {
    JsonArrayConst vars = varsV.as<JsonArrayConst>();
    if (vars.isNull()) return loadFail("vars must be an array");
    if ((int)vars.size() > kMaxVars) return loadFail("too many vars");
    for (JsonObjectConst v : vars) {
      const char* name = v["name"].as<const char*>();
      if (name == nullptr || !v["init"].is<float>())
        return loadFail("var needs name and numeric init");
      if (findVar(name) >= 0) return loadFail("duplicate variable");
      int32_t off = addString(name);
      if (off < 0) return loadFail("string arena exhausted");
      varName_[varCount_] = (uint16_t)off;
      varInit_[varCount_] = v["init"].as<float>();
      vars_[varCount_] = varInit_[varCount_];
      varCount_++;
    }
  }

  JsonArrayConst handlers = doc["handlers"].as<JsonArrayConst>();
  if (handlers.isNull() || handlers.size() == 0)
    return loadFail("handlers must be a non-empty array");
  if ((int)handlers.size() > kMaxHandlers) return loadFail("too many handlers");
  for (JsonObjectConst h : handlers) {
    Handler& out = handlers_[handlerCount_];
    out = Handler{EventType::OnStart, 0, kNone, 0};
    const char* type = h["event"]["type"].as<const char*>();
    if (type == nullptr) return loadFail("handler needs event.type");
    if (strcmp(type, "on_start") == 0) {
      out.event = EventType::OnStart;
    } else if (strcmp(type, "on_tick") == 0) {
      out.event = EventType::OnTick;
      double ms = h["event"]["ms"].as<double>();
      if (!(ms >= 1.0)) return loadFail("on_tick ms must be >= 1");
      out.ms = (uint32_t)ms;
    } else if (strcmp(type, "on_button") == 0) {
      out.event = EventType::OnButton;
    } else {
      return loadFail("unknown event type");
    }
    JsonVariantConst body = h["body"];
    int16_t head = parseStmtList(&body);
    if (head == -2) return false;
    out.body = head;
    handlerCount_++;
  }

  loaded_ = true;
  return true;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

bool Vm::running() const { return running_; }

const char* Vm::error() const { return error_; }

void Vm::clearActivations() {
  for (int i = 0; i < kMaxActivations; i++) acts_[i].active = false;
  for (int i = 0; i < kMaxHandlers; i++) handlerAct_[i] = -1;
}

void Vm::fail(const char* msg) {
  snprintf(error_, sizeof(error_), "%s", msg);
  running_ = false;
  clearActivations();
  hal_->drive(0, 0);
  hal_->log(3, msg);
}

int8_t Vm::spawn(int handlerIndex) {
  for (int8_t s = 0; s < kMaxActivations; s++) {
    if (acts_[s].active) continue;
    Activation& act = acts_[s];
    act.active = true;
    act.handler = (int8_t)handlerIndex;
    act.top = 0;
    act.frames[0] =
        Frame{handlers_[handlerIndex].body, kNone, Phase::Run, 0, 0, 0.0f, 0.0f, 0};
    handlerAct_[handlerIndex] = s;
    return s;
  }
  return -1; // ≥ 4 concurrent activations: this firing is skipped
}

bool Vm::pushFrame(Activation& act, int16_t bodyHead, int16_t ownerStmt) {
  if (act.top + 1 >= kMaxFrames) {
    fail("frame overflow");
    return false;
  }
  act.top++;
  act.frames[act.top] = Frame{bodyHead, ownerStmt, Phase::Run, 0, 0, 0.0f, 0.0f, 0};
  return true;
}

void Vm::advance(Frame& frame) {
  frame.stmt = stmts_[frame.stmt].next;
  frame.phase = Phase::Run;
}

void Vm::emitServo(const char* id, float deg) {
  hal_->servo(id, (int)clampL(roundInt(deg), 0, 180));
}

void Vm::start(uint32_t now) {
  if (!loaded_) return;
  running_ = true;
  error_[0] = '\0';
  tStart_ = now;
  for (int i = 0; i < varCount_; i++) vars_[i] = varInit_[i];
  clearActivations();
  for (int i = 0; i < handlerCount_; i++) {
    if (handlers_[i].event == EventType::OnTick)
      handlers_[i].nextDue = now + handlers_[i].ms;
  }
  for (int i = 0; i < handlerCount_; i++) {
    if (!running_) return;
    if (handlers_[i].event != EventType::OnStart) continue;
    int8_t s = spawn(i);
    if (s >= 0) stepActivation(acts_[s], now);
  }
}

void Vm::tick(uint32_t now) {
  if (!running_) return;
  for (int i = 0; i < handlerCount_; i++) {
    if (!running_) return;
    Handler& h = handlers_[i];
    if (h.event == EventType::OnTick) {
      bool due = false;
      while (h.nextDue <= now) { // catch-up: missed periods are skipped
        due = true;
        h.nextDue += h.ms;
      }
      if (due && handlerAct_[i] < 0) spawn(i);
    }
    if (handlerAct_[i] >= 0) stepActivation(acts_[handlerAct_[i]], now);
  }
}

void Vm::onButton(uint32_t now) {
  if (!running_) return;
  for (int i = 0; i < handlerCount_; i++) {
    if (!running_) return;
    if (handlers_[i].event != EventType::OnButton) continue;
    if (handlerAct_[i] >= 0) continue; // still running: this press is skipped
    int8_t s = spawn(i);
    if (s >= 0) stepActivation(acts_[s], now);
  }
}

void Vm::stop() {
  if (!running_) return;
  running_ = false;
  clearActivations();
  hal_->drive(0, 0);
}

void Vm::stepActivation(Activation& act, uint32_t now) {
  int ops = 0;
  for (;;) {
    if (!running_) return;
    Frame& frame = act.frames[act.top];

    if (frame.stmt == kNone) {
      // Frame complete.
      if (act.top == 0) { // root: activation ends (no op cost)
        handlerAct_[act.handler] = -1;
        act.active = false;
        return;
      }
      if (ops == kMaxOpsPerTick) {
        fail("op budget exceeded");
        return;
      }
      ops++;
      int16_t ownerIdx = frame.owner;
      act.top--;
      Frame& parent = act.frames[act.top];
      Stmt& owner = stmts_[ownerIdx];
      switch (owner.op) {
        case Op::If:
          advance(parent);
          break;
        case Op::Repeat:
          parent.count--;
          if (parent.count > 0) {
            if (!pushFrame(act, owner.body, ownerIdx)) return;
          } else {
            advance(parent);
          }
          break;
        case Op::While: {
          float c = eval(owner.e[0], now);
          if (!running_) return;
          if (truthy(c)) {
            if (!pushFrame(act, owner.body, ownerIdx)) return;
          } else {
            advance(parent);
          }
          break;
        }
        case Op::Forever:
          if (!pushFrame(act, owner.body, ownerIdx)) return;
          break;
        default: // unreachable: only containers own frames
          fail("frame overflow");
          return;
      }
      continue;
    }

    Stmt& cur = stmts_[frame.stmt];

    if (frame.phase == Phase::Wait) {
      if (now < frame.deadline) return; // still blocked, no op cost
      if (ops == kMaxOpsPerTick) {
        fail("op budget exceeded");
        return;
      }
      ops++;
      if (cur.op == Op::DriveTime) hal_->drive(0, 0);
      advance(frame);
      continue;
    }

    if (frame.phase == Phase::Sweep) {
      if (ops == kMaxOpsPerTick) {
        fail("op budget exceeded");
        return;
      }
      ops++;
      if (now >= frame.deadline) {
        emitServo(str(cur.str), frame.sweepTo);
        advance(frame);
        continue;
      }
      float elapsed = (float)(now - frame.sweepStart);
      float dur = (float)(frame.deadline - frame.sweepStart);
      float q = elapsed / dur;
      float delta = frame.sweepTo - frame.sweepFrom;
      float part = delta * q;
      float deg = frame.sweepFrom + part;
      emitServo(str(cur.str), deg);
      return; // stays blocked until the deadline tick
    }

    // Fresh statement.
    if (ops == kMaxOpsPerTick) {
      fail("op budget exceeded");
      return;
    }
    ops++;
    bool blocked = execute(act, frame, now);
    if (!running_) return;
    if (blocked) return;
  }
}

bool Vm::execute(Activation& act, Frame& frame, uint32_t now) {
  Stmt& cur = stmts_[frame.stmt];
  switch (cur.op) {
    case Op::Drive: {
      float l = eval(cur.e[0], now);
      if (!running_) return false;
      float r = eval(cur.e[1], now);
      if (!running_) return false;
      hal_->drive((int)clampL(roundInt(l), -100, 100),
                  (int)clampL(roundInt(r), -100, 100));
      advance(frame);
      return false;
    }
    case Op::DriveTime: {
      float l = eval(cur.e[0], now);
      if (!running_) return false;
      float r = eval(cur.e[1], now);
      if (!running_) return false;
      float msf = eval(cur.e[2], now);
      if (!running_) return false;
      long ms = roundInt(msf);
      if (ms < 0) ms = 0;
      hal_->drive((int)clampL(roundInt(l), -100, 100),
                  (int)clampL(roundInt(r), -100, 100));
      frame.deadline = now + (uint32_t)ms;
      frame.phase = Phase::Wait; // ms == 0 completes on the next loop pass
      return false;
    }
    case Op::Stop:
      hal_->drive(0, 0);
      advance(frame);
      return false;
    case Op::Servo: {
      float deg = eval(cur.e[0], now);
      if (!running_) return false;
      emitServo(str(cur.str), deg);
      advance(frame);
      return false;
    }
    case Op::ServoSweep: {
      float from = eval(cur.e[0], now);
      if (!running_) return false;
      float to = eval(cur.e[1], now);
      if (!running_) return false;
      float msf = eval(cur.e[2], now);
      if (!running_) return false;
      long ms = roundInt(msf);
      if (ms < 0) ms = 0;
      if (ms == 0) {
        emitServo(str(cur.str), to);
        advance(frame);
        return false;
      }
      frame.sweepFrom = from;
      frame.sweepTo = to;
      frame.sweepStart = now;
      frame.deadline = now + (uint32_t)ms;
      frame.phase = Phase::Sweep;
      emitServo(str(cur.str), from);
      return true; // interpolation resumes on the next tick
    }
    case Op::Led: {
      float r = eval(cur.e[0], now);
      if (!running_) return false;
      float g = eval(cur.e[1], now);
      if (!running_) return false;
      float b = eval(cur.e[2], now);
      if (!running_) return false;
      long id = -1;
      if (cur.e[3] != kNone) {
        float idf = eval(cur.e[3], now);
        if (!running_) return false;
        id = roundInt(idf);
      }
      hal_->led((int)clampL(roundInt(r), 0, 255), (int)clampL(roundInt(g), 0, 255),
                (int)clampL(roundInt(b), 0, 255), (int)id);
      advance(frame);
      return false;
    }
    case Op::LedOff: {
      long id = -1;
      if (cur.e[0] != kNone) {
        float idf = eval(cur.e[0], now);
        if (!running_) return false;
        id = roundInt(idf);
      }
      hal_->ledOff((int)id);
      advance(frame);
      return false;
    }
    case Op::Tone: {
      float hz = eval(cur.e[0], now);
      if (!running_) return false;
      float ms = eval(cur.e[1], now);
      if (!running_) return false;
      hal_->tone((int)roundInt(hz), (int)roundInt(ms));
      advance(frame);
      return false;
    }
    case Op::Wait: {
      float msf = eval(cur.e[0], now);
      if (!running_) return false;
      long ms = roundInt(msf);
      if (ms < 0) ms = 0;
      frame.deadline = now + (uint32_t)ms;
      frame.phase = Phase::Wait; // ms == 0 completes on the next loop pass
      return false;
    }
    case Op::SetVar: {
      float v = eval(cur.e[0], now);
      if (!running_) return false;
      vars_[cur.var] = v;
      advance(frame);
      return false;
    }
    case Op::ChangeVar: {
      float v = eval(cur.e[0], now);
      if (!running_) return false;
      vars_[cur.var] = vars_[cur.var] + v;
      advance(frame);
      return false;
    }
    case Op::If: {
      float c = eval(cur.e[0], now);
      if (!running_) return false;
      int16_t branch = truthy(c) ? cur.body : cur.els;
      if (branch != kNone) pushFrame(act, branch, frame.stmt);
      else advance(frame);
      return false;
    }
    case Op::Repeat: {
      float nf = eval(cur.e[0], now);
      if (!running_) return false;
      long n = roundInt(nf);
      if (n <= 0) {
        advance(frame);
      } else {
        frame.count = (uint32_t)n;
        pushFrame(act, cur.body, frame.stmt); // loops always push, even empty
      }
      return false;
    }
    case Op::While: {
      float c = eval(cur.e[0], now);
      if (!running_) return false;
      if (truthy(c)) pushFrame(act, cur.body, frame.stmt);
      else advance(frame);
      return false;
    }
    case Op::Forever:
      pushFrame(act, cur.body, frame.stmt);
      return false;
    case Op::Break: {
      while (act.top > 0) {
        int16_t ownerIdx = act.frames[act.top].owner;
        act.top--;
        Op oop = stmts_[ownerIdx].op;
        if (oop == Op::Repeat || oop == Op::While || oop == Op::Forever) {
          advance(act.frames[act.top]); // past the loop statement
          return false;
        }
      }
      fail("break outside loop");
      return false;
    }
    case Op::Log:
      hal_->log(1, str(cur.str));
      advance(frame);
      return false;
  }
  return false; // unreachable
}

float Vm::eval(int16_t exprIndex, uint32_t now) {
  if (!running_) return 0.0f;
  const Expr& e = exprs_[exprIndex];
  switch (e.kind) {
    case ExprKind::Num:
      return e.num;
    case ExprKind::Sensor:
      return hal_->readSensor(str(e.str));
    case ExprKind::Var:
      return vars_[e.a];
    case ExprKind::Rand: {
      float lof = eval(e.a, now);
      if (!running_) return 0.0f;
      float hif = eval(e.b, now);
      if (!running_) return 0.0f;
      long lo = roundInt(lof);
      long hi = roundInt(hif);
      if (lo > hi) {
        fail("rand range invalid");
        return 0.0f;
      }
      return (float)hal_->random(lo, hi); // inclusive [lo, hi]
    }
    case ExprKind::Cmp: {
      float a = eval(e.a, now);
      if (!running_) return 0.0f;
      float b = eval(e.b, now);
      if (!running_) return 0.0f;
      bool r = false;
      switch ((CmpOp)e.sub) {
        case CmpOp::Lt: r = a < b; break;
        case CmpOp::Le: r = a <= b; break;
        case CmpOp::Gt: r = a > b; break;
        case CmpOp::Ge: r = a >= b; break;
        case CmpOp::Eq: r = a == b; break;
        case CmpOp::Ne: r = a != b; break;
      }
      return r ? 1.0f : 0.0f;
    }
    case ExprKind::Math: {
      float a = eval(e.a, now);
      if (!running_) return 0.0f;
      float b = eval(e.b, now);
      if (!running_) return 0.0f;
      switch ((MathOp)e.sub) {
        case MathOp::Add: return a + b;
        case MathOp::Sub: return a - b;
        case MathOp::Mul: return a * b;
        case MathOp::Div:
          if (b == 0.0f) {
            fail("division by zero");
            return 0.0f;
          }
          return a / b;
        case MathOp::Min: return a < b ? a : b;
        case MathOp::Max: return a > b ? a : b;
      }
      return 0.0f;
    }
    case ExprKind::Logic: {
      float a = eval(e.a, now); // no short-circuit (SEMANTICS.md §2)
      if (!running_) return 0.0f;
      float b = eval(e.b, now);
      if (!running_) return 0.0f;
      if ((LogicOp)e.sub == LogicOp::And) return (truthy(a) && truthy(b)) ? 1.0f : 0.0f;
      return (truthy(a) || truthy(b)) ? 1.0f : 0.0f;
    }
    case ExprKind::Not: {
      float a = eval(e.a, now);
      if (!running_) return 0.0f;
      return a == 0.0f ? 1.0f : 0.0f;
    }
    case ExprKind::Call:
      if ((CallFn)e.sub == CallFn::ElapsedMs) return (float)(uint32_t)(now - tStart_);
      return hal_->readSensor("battery.pct");
  }
  return 0.0f; // unreachable
}
