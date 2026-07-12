# @botforge/sim

Browser + headless robot simulator (PLAN.md Phase 3): Rapier physics at a
fixed 120 Hz (`SIM_FIXED_STEP_HZ`), three.js visuals, virtual sensors, and a
§5.4-protocol `SimLink` so `/play` and `/drive` talk to the simulated robot
through the same `RobotLink` interface as real hardware. Licensed under
GPL-3.0.

- **`SimWorld`** — loads an engine-generated URDF (+ STL meshes) into a
  seeded, deterministic physics world. Differential drive (v_max 0.45 m/s,
  wheel radius/track derived from the URDF continuous joints), servo joints
  as position motors, per-link bbox colliders. `collidersOnly: true` skips
  the three.js scene for Node/CI use.
- **`VirtualSensors`** — ToF raycast fan (2000 mm max, σ = 2 mm seeded
  noise), line sensors sampling the arena ground field (0–4095, dark =
  high), linear battery discharge (4.1 → 3.5 V over 20 min of driving).
- **`ARENAS`** — `open_floor`, `line_oval` (procedural stadium track with a
  lap-progress parametrization), `obstacle_pen` (walled 1.5 × 1.5 m box with
  seeded random blocks).
- **`SimLink`** — implements the §5.4 message set (`hello`/`hello.ack`,
  `mode`, `cmd.*`, 5 Hz `telemetry`, `log`) and runs BSJ behaviors through
  `@botforge/behavior-ts` at 50 Hz sim time. `loadBehavior()` + `ctl()`
  mirror `POST /api/behavior[/ctl]`.
- **`loadRobotUrdf`** — browser-only urdf-loader helper for articulated
  visual meshes.

The headless gate tests in `test/gates.test.ts` double as regression gates
for the engine's URDF output. Fixtures in `test/fixtures/rover-v1/` are a
copy of `dist/rover-v1/urdf/` (regenerate with
`uv run --project packages/engine botforge build robots/rover-v1 --only cad,urdf`).
