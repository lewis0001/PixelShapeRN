# BSJ golden-trace fixtures

Shared conformance fixtures for the **two** BSJ interpreters:

- TypeScript reference: `packages/behavior-ts/src/interpreter.ts`
  (run by `packages/behavior-ts/test/fixtures.test.ts`)
- C++ firmware VM: `packages/firmware/src/vm/`
  (run by `packages/firmware/test/native/test_vm/test_main.cpp`,
  `pio test -d packages/firmware -e native`)

Both harnesses execute every fixture listed in `index.json` and require the
**exact** ordered HAL-call trace. The semantics being tested are pinned in
`../SEMANTICS.md`.

## Fixture file format

```jsonc
{
  "name": "01_blink_sequence",
  "desc": "what this fixture proves",
  "tick_ms": 20, // scheduler period (50 Hz = 20)
  "run_ms": 600, // last tick timestamp (inclusive)
  "sensors": {
    "range.mm": [
      [0, 500],
      [300, 100],
    ],
  }, // step profiles
  "random": [0, 1], // scripted HAL random() results, in call order
  "buttons": [100, 340], // onButton() times (multiples of tick_ms, > 0)
  "program": {/* the BSJ program */},
  "expected": ["0 led 0 80 0 -1", "..."], // exact ordered trace
  "expect_error": "op budget exceeded", // optional: required error() after run
}
```

## Harness procedure (identical in TS and C++)

1. `load(program)` — must succeed.
2. `start(0)`.
3. For `t = tick_ms, 2·tick_ms, … , run_ms` (inclusive):
   set the mock clock to `t`; call `onButton(t)` once per entry in `buttons`
   equal to `t` (button presses are delivered **before** the tick); then
   `tick(t)`.
4. Compare the recorded trace to `expected`, element for element.
5. If `expect_error` is set: `running()` must be false and `error()` must
   equal it. Otherwise `error()` must be empty/null.

## Mock HAL

- Records one line per actuator/log call, prefixed with the current mock
  time: `drive <l> <r>` · `servo <id> <deg>` · `led <r> <g> <b> <id>` ·
  `led_off <id>` · `tone <hz> <ms>` · `log <level> <msg>`. An omitted
  `led`/`led_off` id records as `-1`. `readSensor`/`random`/`now` calls are
  **not** traced.
- `readSensor(name)`: the `sensors` map gives `[t, value]` step profiles
  (sorted by `t`); the value is the last entry with `t <= now`, or `0` when
  there is none (or the sensor is unlisted).
- `random(lo, hi)`: returns the next value from `random`, cycling back to the
  start when exhausted; returns `lo` if the list is empty/absent.

## Fixtures

| file                       | proves                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| 01_blink_sequence.json     | sequential ops + `wait` deadlines resume at the first tick ≥ deadline; `on_tick` first fire |
| 02_drive_time_overlap.json | `drive_time` drive→wait→stop; a second handler interleaves while the first is blocked       |
| 03_if_else_sensor.json     | `if`/`else` branching on a scripted sensor profile                                          |
| 04_while_break.json        | `while` loop, `break` unwinding through nested `if`s, `change_var`                          |
| 05_repeat_nested.json      | `repeat` (incl. nested repeat) iteration counts                                             |
| 06_vars_math.json          | `set_var`/`change_var`, `math` (+ − × ÷ min max), `cmp`, `logic`, `not`, `rand`, `call`s    |
| 07_tick_skip.json          | `on_tick` firings are skipped while the previous activation still runs; anchored schedule   |
| 08_runaway_guard.json      | >200 ops in one tick → runtime error: `drive 0 0` + `log 3` + halt                          |
| 09_on_button.json          | `on_button` fires immediately; a press while the handler runs is skipped                    |
| 10_avoid_obstacles.json    | the real shipped `avoid_obstacles` behavior against a scripted range profile + random seq   |
| 11_servo_sweep.json        | `servo_sweep` non-blocking interpolation: per-tick updates, exact endpoint emission         |
| 12_div_zero.json           | division by zero → runtime error trace and `error()` message                                |

## Regenerating `expected`

`BSJ_FIXTURES_UPDATE=1 pnpm --filter @botforge/behavior-ts test` rewrites each
fixture's `expected` (and nothing else) from the TypeScript reference
interpreter. Only do this after a deliberate, documented semantics change —
the C++ VM must then be re-verified against the new goldens.
