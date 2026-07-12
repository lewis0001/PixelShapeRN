# BSJ v1 — Execution Semantics (normative)

This document pins down every deterministic detail of the Behavior Script JSON
(BSJ) v1 interpreter, beyond what PLAN.md §5.3 specifies. **Both** interpreters
— the TypeScript reference (`packages/behavior-ts/src/interpreter.ts`) and the
C++ firmware VM (`packages/firmware/src/vm/`) — implement exactly this, and the
shared golden-trace fixtures (`packages/behavior-ts/fixtures/`) prove it.

## 1. Numbers

- All expression values are IEEE-754 **binary32** (C++ `float`). The TS
  interpreter applies `Math.fround` after every arithmetic operation, sensor
  read, `call`, and variable store, so both implementations compute identical
  bit patterns.
- **Truthiness**: a value is truthy iff it is `!= 0.0`. `cmp`, `logic`, and
  `not` produce exactly `1.0` or `0.0`.
- **Rounding to int** (at the HAL boundary and for `ms` / `repeat n` / `rand`
  bounds): `roundInt(x) = floor(x + 0.5)`, computed in float32
  (C++ `(long)floorf(x + 0.5f)`, TS `Math.floor(fround(fround(x) + 0.5))`).
- **Clamping** after rounding: `drive` / `drive_time` l,r → [-100, 100];
  `led` r,g,b → [0, 255]; `servo` / `servo_sweep` deg → [0, 180]. Other int
  params (`tone` hz/ms, led `id`) are rounded but not clamped. `wait` /
  `drive_time` / `servo_sweep` `ms` values < 0 are treated as 0.

## 2. Expressions

- `{"sensor": name}` → `fround(hal.readSensor(name))`, read fresh on every
  evaluation.
- `{"var": name}` → current value. Variable names in `var` / `set_var` /
  `change_var` must be declared in `vars`; an unknown name is a **load error**.
- `{"rand": [lo, hi]}` → both bounds are Exprs, evaluated (lo first), rounded
  with `roundInt`. `lo > hi` is a runtime error (`"rand range invalid"`).
  Otherwise `fround(hal.random(lo, hi))` — HAL returns an integer in the
  **inclusive** range [lo, hi].
- `{"cmp": [a, op, b]}` → evaluate `a` then `b`, compare as float32.
  `==` / `!=` are exact float equality.
- `{"math": [a, op, b]}` → evaluate `a` then `b`; `+ - * / min max` in
  float32. Division by **exactly** 0.0 (including -0.0) is a runtime error
  (`"division by zero"`), checked before dividing.
- `{"logic": [op, a, b]}` → **no short-circuit**: both operands are always
  evaluated (a first), then combined.
- `{"not": a}` → `1.0` if `a == 0.0` else `0.0`.
- `{"call": "elapsed_ms"}` → `fround(now - t_start)` where `now` is the
  timestamp passed to the current `start`/`tick`/`onButton` call.
- `{"call": "battery_pct"}` → `fround(hal.readSensor("battery.pct"))`.
- Expression nesting deeper than **32** levels is a load error.
- Statement params are evaluated in the order listed in the §5.3 op table
  (e.g. `drive_time`: `l`, then `r`, then `ms`), all before the op's action
  (HAL call / deadline arming) executes.

## 3. Program lifecycle

- `load(json)`: validates version (`bsj == 1`), limits (≤ 128 statements
  counted recursively over all bodies, ≤ 8 vars, ≤ 8 handlers, file ≤ 16384
  bytes), op/event/expr shapes, and var references. `on_tick` requires integer
  `ms >= 1` (load error otherwise). Loading stops any running program.
  Load _acceptance_ is identical for well-formed programs; only rejection
  detail differs: the TS zod schema is stricter about extraneous keys, and the
  C++ parser additionally bounds JSON nesting (64 levels) and string storage
  (4 KB arena). Runtime behavior of anything both sides load is identical.
- `start(now)`: records `t_start = now`, resets every var to its `init`,
  clears activations, sets `nextDue = now + ms` for each `on_tick` handler,
  then — in declaration order — spawns and immediately steps an activation for
  each `on_start` handler.
- `stop()`: if running, issues `drive(0, 0)` and halts (clears activations).
  No other HAL calls.
- Runtime error: issue `drive(0, 0)`, then `log(3, msg)`, then halt.
  `running()` becomes false, `error()` returns the message. Exact messages:
  `"op budget exceeded"`, `"division by zero"`, `"break outside loop"`,
  `"frame overflow"`, `"rand range invalid"`.
- Log levels: 0 = debug, 1 = info, 2 = warn, 3 = error. The `log` op emits
  level **1**; the runtime-error path emits level **3**.

## 4. Scheduler

- The host calls `tick(now)` at 50 Hz (every 20 ms). All time comparisons use
  the `now` passed in; the VM never samples a clock itself.
- `tick(now)` visits handlers in **declaration order**. For each handler:
  1. If it is `on_tick`: it is _due_ if `nextDue <= now`. Advance
     `nextDue += ms` repeatedly until `nextDue > now` (missed periods are
     skipped, never queued — the schedule stays anchored to `t_start`).
     If due: spawn a new activation **unless** the handler already has a
     running activation (that firing is skipped entirely) or 4 activations
     are already running (skipped).
  2. If the handler has an activation (new or resumed), **step** it (see §5).
     So all of handler 0's work for a tick happens before handler 1's.
- `on_tick` first fires at the first `tick` with `now >= t_start + ms`.
- `onButton(now)`: in declaration order, for each `on_button` handler: if it
  already has a running activation, the press is skipped for that handler;
  if 4 activations are running, skipped; otherwise spawn and immediately step
  the new activation. Handlers not of type `on_button` are untouched (their
  activations resume at the next `tick`).
- At most **4** activations run concurrently; each handler has at most **one**.

## 5. Activation stepping (the stack machine)

An activation is a stack of ≤ **16** frames. A frame is
`{stmts, index, owner, state}` — a statement list, the index of the current
statement, the container statement that pushed it (`if`/`repeat`/`while`/
`forever`; none for the root frame), and per-statement state (wait deadline /
sweep params / remaining repeat count). Pushing a 17th frame is a runtime
error (`"frame overflow"`).

`step(activation, now)` runs a loop with an op budget of **200** per
activation per tick:

- Before executing each op, if 200 ops have already run in this step call →
  runtime error `"op budget exceeded"`.
- Each of the following costs exactly **1 op**:
  - executing a statement (including containers: evaluating an `if`/`while`
    condition and pushing its body, `repeat` count evaluation, `forever`
    push, `break` unwinding);
  - completing a non-root frame (popping it and running the container
    continuation: `if`/`else` → advance; `repeat` → decrement remaining, re-push
    body if > 0 else advance; `while` → re-evaluate cond, re-push body if
    truthy else advance; `forever` → re-push);
  - completing a blocking statement when its deadline arrives (`wait` ends,
    `drive_time` issues `drive(0,0)`, `servo_sweep` issues the final
    `servo(id, to)`);
  - a `servo_sweep` per-tick interpolation update.
- Completing the **root** frame ends the activation and costs no op.
- A blocked activation (deadline still in the future) stops stepping without
  error; checking a pending deadline costs no op.

## 6. Blocking ops

- `wait ms`: store `deadline = now + max(0, roundInt(ms))`. The activation
  resumes at the first `tick`/`onButton` step with `now >= deadline`
  (so with a 20 ms tick, `wait 150` started at t=0 resumes at t=160).
  `wait 0` completes in the same tick (costing 1 extra op).
- `drive_time l r ms`: call `drive(l, r)` immediately, then behave like
  `wait ms`, then call `drive(0, 0)` on completion. It is **not** cancelled
  by other handlers driving in between (last write wins), and its final
  `drive(0, 0)` is always issued.
- `servo_sweep id from to ms`: let `f = fround(eval from)`,
  `t = fround(eval to)`, `d = max(0, roundInt(ms))`. If `d == 0`: single
  `servo(id, clamp(roundInt(t)))`, done. Otherwise: on the starting op call
  `servo(id, clamp(roundInt(f)))`, then on **every** subsequent tick while
  `now < deadline` emit `servo(id, clamp(roundInt(deg)))` where
  `deg = f + (t - f) * ((now - start) / d)` (each operation in float32); at
  the first tick with `now >= deadline` emit `servo(id, clamp(roundInt(t)))`
  and complete. Repeated equal values are still emitted.
- `stop` is non-blocking: `drive(0, 0)`.
- `tone hz ms` is fire-and-forget (the HAL owns the tone duration).

## 7. Control flow details

- `if`: evaluate `cond`; push `body` if truthy, else push `else` if present,
  else advance. An empty (or absent) chosen branch pushes nothing and advances
  (no frame-completion op).
- Loops (`repeat`/`while`/`forever`) **always** push their body frame, even an
  empty one — each iteration then costs at least the frame-completion op, so
  an empty `forever` trips the runaway guard instead of hanging.
- `repeat n`: `n` is evaluated **once**, `count = roundInt(n)`; `count <= 0`
  skips the body entirely.
- `while`: condition evaluated before every iteration (including the first).
- `break`: pops frames until it has popped a frame owned by a loop
  (`repeat`/`while`/`forever`), then advances the parent past that loop.
  Executing `break` with no enclosing loop in the activation is a runtime
  error (`"break outside loop"`).
- `led` with no `id` param → HAL id **-1** (all pixels); same for `led_off`.

## 8. HAL / adapter mapping

`stop` and the error/`stop()` paths map to `drive(0, 0)` — there is no
separate HAL stop. `battery_pct` maps to `readSensor("battery.pct")`. Unknown
sensor behavior is HAL-defined (the golden-trace mocks return 0).
