# @botforge/behavior-ts

Behavior Script JSON (BSJ) v1 — types, zod schema, and the **reference
interpreter** for botforge robot behaviors (plan §5.3). Licensed under
GPL-3.0.

- `src/types.ts` — BSJ types + `BSJ_VERSION` + `BSJ_LIMITS`
- `src/schema.ts` — zod schema, limits enforcement, `parseBsj()`
- `src/interpreter.ts` — `BsjInterpreter` with an injectable `RobotAdapter`
  (`load` / `start` / `tick` / `stop` / `onButton`, 50 Hz stored-deadline
  stack machine)
- `SEMANTICS.md` — the normative execution semantics, shared with the C++
  firmware VM (`packages/firmware/src/vm/`)
- `fixtures/` — golden-trace fixtures run by **both** interpreters
  (`pnpm --filter @botforge/behavior-ts test` and
  `pio test -d packages/firmware -e native`); see `fixtures/README.md`
