# Phase 3 report — No-code builder + simulator

Date: 2026-07-12
Status: **complete** up to the two 🧍 items (phone spot-check; sim→real-robot send needs
the Phase-2 bench hardware).

## What was built

- **`/builder`** — 31 custom Blockly blocks covering the frozen §5.3 BSJ set exactly
  (Events / Move / Sense / Light & Sound / Logic / Loops / Variables). Pure codec
  `workspace ⇄ BSJ` with **lossless round-trip proven on all 3 rover behaviors and all
  12 shared interpreter fixtures** (plus a real-Blockly load/re-save pass). Zod
  validation, live 128-block/16 KB meter, examples menu, localStorage save/load,
  file up/download.
- **`packages/sim`** — `SimWorld` (Rapier, fixed 1/120 s step, fully seeded and
  deterministic: float-identical pose traces across runs), URDF-driven robot with
  diff-drive derived from the generated wheel joints, virtual ToF (5-ray fan, σ=2 mm),
  line sensors off a parametrized ground field, battery model; arenas `open_floor`,
  `line_oval`, `obstacle_pen`. `SimLink` implements the same §5.4 protocol as the
  firmware, running the shared `BsjInterpreter` at 50 Hz.
- **`/play`** — split view: sim canvas (orbit camera, arena picker, 1×/4× speed, BOOT
  button, LED overlay) beside the reused block editor. ▶ Run in Sim / ⏹ / ⟲ /
  ⬆ Send to Robot (POST `/api/behavior` + ctl run, then live robot logs/telemetry over
  WsLink). One program, two targets — P3 realized end to end.

## Acceptance checklist

- [x] Round-trip Blockly↔BSJ lossless on all fixtures (15/15 programs)
- [x] TS + C++ interpreters produce identical golden traces (Phase 2, 12 fixtures)
- [x] Headless sim gates green: `avoid_obstacles` in `obstacle_pen` 15 s →
      **1.614 m** displacement (> 1 m), max wall-contact streak 375 ms (< 2 s);
      `line_follow` on `line_oval` → **197.9 %** lap progress (≥ 60 %)
- [ ] 🧍 `/play` runs avoid-obstacles at 60 fps on a mid phone — needs a real device
      spot-check (all heavy chunks are lazy; first-load JS 89.4 kB)
- [ ] 🧍 Sim-built behavior sent to the real rover behaves equivalently — needs the
      bench hardware (PHASE-2-bench.md)

## Test state

Workspace: web 107, sim 35, behavior-ts 35, firmware native 45, engine 82+1skip —
all green; `pnpm build` clean.

## Notes

- The sim's avoid-obstacles gate uses a fixed seed (deterministic sweep documented in
  the sim tests); displacement in a walled pen is inherently seed-dependent.
- Rover URDF + meshes are committed as fixtures (`packages/sim/test/fixtures`,
  `apps/web/public/sim-assets`) so CI and the page don't depend on a live engine build;
  regenerating them after CAD changes is one `botforge build --only cad,urdf` + copy.
