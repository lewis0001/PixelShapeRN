# Phase 1 report — The Engine + Rover generated end-to-end

Date: 2026-07-12
Status: complete up to the 🧍 human checkpoint (Lewis reviews step renders + STLs;
poses marked TUNE in `robots/rover-v1/assembly.yaml` may then be adjusted — data-only).

## What was built

`uv run --project packages/engine botforge build robots/rover-v1` produces the complete
PLAN §5.6 output in ~7 s locally (well under the 10-minute CI budget):

- **Models & validation** (`botforge_engine/models`, `validate.py`): pydantic v2 models
  mirroring §5.1/§5.2; validator rules for unknown refs, endpoint existence, required
  pins, GPIO double-booking (I2C bus exception), ADC1-only analog pins, reserved pins,
  pin-type compatibility, 2000 mA power budget (warning), behavior/autostart integrity,
  assembly cross-references. Human-friendly `path: message` errors.
- **Registry data**: all 12 launch modules + fasteners (`registry/`), rover-v1 manifest
  (verbatim from PLAN) + assembly poses + 3 behaviors, `_test-min` fixture robot.
- **Generators** (each timed in the build summary table):
  - `cad` — cadlib helpers (FIT 0.20, WALL_MIN 1.6, support-free rules in
    `packages/engine/CAD_GUIDE.md`), 5 rover part scripts, STL/STEP/3MF export,
    trimesh QC (all parts watertight, worst overhang 1.63 %), `qc_report.json`.
  - `print_plan` — PrusaSlicer CLI wrapper with pure gcode-stats parser; degrades to
    nulls + warning when the slicer is absent (CI container has it).
  - `wiring` — WireViz harness.yaml (10 cables / 28 labelled wires for rover),
    wiring.svg/png, deterministic wire_bom.csv.
  - `bom` — bom.json/csv/md; cheapest-vendor primary + alternates; affiliate URLs
    `{SITE}/out/{key}/{ref}` (SITE from `BOTFORGE_SITE`, default placeholder).
  - `assembly` — steps.json + per-step 1600×1200 EGL renders honoring the §5.2 contract
    (ghost-grey priors, hero-color adds offset along explode vectors, arrows).
  - `urdf` — robot.urdf (17 links / 2 continuous wheel joints for rover) + meshes.
  - `fw_config` — firmware/config.json per §5.5, asserted byte-exact in tests.
  - `docs` — 10-page MDX bundle (index/safety/source-parts/print-guide/wiring/assemble/
    flash/first-run/play/troubleshooting) with images; `scripts/sync_docs.py` copies it
    into `apps/docs/src/content/docs/robots/<id>/` (rover + _test-min synced and the
    Astro site builds them — 13 pages).
  - `catalog` — catalog.json card data.
- **Behaviors** ship verbatim into `dist/<id>/behaviors/` (CLI build step).
- **Golden tests** (`tests/test_goldens.py`): full-text goldens for `_test-min`,
  sha256 snapshot for rover, §5.6 inventory completeness gates for both, deterministic
  fake slicer committed as a fixture, `--update-goldens` flag. Real-slicer 60–180 g
  rover sanity check auto-runs where PrusaSlicer exists (CI).

## Test state

`uv run pytest -q`: **82 passed, 1 skipped** (the skip is the CI-only real-slicer
check). Ruff clean. JS workspace: `pnpm build` + `pnpm test` green.

## Acceptance checklist

- [x] `botforge validate` catches: bad ref, missing required pin, double-booked GPIO,
      ADC misuse (4 negative tests, plus reserved-pin/power-budget/autostart cases)
- [x] Full rover build < 10 min in CI (≈7 s locally) producing every §5.6 file
      (inventory-gated in tests)
- [x] Goldens green (compare mode)
- [x] All rover parts watertight + support-free report clean (worst 1.63 % < 2 %)
- [~] Rover print estimate 60–180 g — enforced by a CI-only test; the local sandbox
      cannot install PrusaSlicer (see DECISIONS: goldens use a fake slicer)
- [x] `apps/docs` renders the rover guide locally with images (13 pages built)
- [ ] 🧍 **Lewis reviews step renders + STLs** — dist artifacts are reproducible with
      one command; sample renders attached to the session. Poses marked `# TUNE` in
      assembly.yaml are expected to change after the first physical print.

## Deviations (logged in docs/DECISIONS.md)

1. §5.1 pin-type enum extended with `motor_out`/`switch` (required by the frozen §5.2
   rover manifest).
2. Core GPIO capability map lives in the core module's `firmware.params`.
3. §5.5 example's `l`/`r` pin shorthand → real registry pin names `out_l`/`out_r`;
   module order = manifest order.
4. Golden strategy: full text for text artifacts, existence/QC for binaries
   (timestamps/rasterizer/graphviz byte-noise).
5. CadQuery resolves to 2.8.x (declared ≥2.4).
6. `tests/test_cli.py` stub-skip assertion repurposed once fw_config became real.

## How Lewis can verify locally (<10 min)

```bash
uv sync --project packages/engine --all-extras
uv run --project packages/engine botforge validate robots/rover-v1   # ✓ + power warning
uv run --project packages/engine botforge build robots/rover-v1     # full dist/ in ~10 s
open dist/rover-v1/assembly/step-*.png                               # step renders
open dist/rover-v1/wiring/wiring.svg                                 # wiring diagram
# STLs: dist/rover-v1/cad/stl/*.stl — drop into any slicer
uv run --project packages/engine pytest -q                           # 82 passed
pnpm install && pnpm dev                                             # docs at /robots/rover-v1
```
