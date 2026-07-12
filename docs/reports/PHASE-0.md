# Phase 0 report — Repo scaffold & tooling

Date: 2026-07-12
Status: complete (two acceptance items deferred to CI — see "Environment limits" below).

## What was built

- **Monorepo root**: pnpm 10 workspace + Turborepo (`package.json`, `pnpm-workspace.yaml`,
  `turbo.json`), prettier + husky + lint-staged, `.env.example`, `README.md`.
- **`apps/web`**: Next.js 14 App Router + Tailwind + TS placeholder landing page, vitest smoke
  tests, `next lint` config.
- **`apps/docs`**: Astro 4 + Starlight 0.28 docs site with a `robots/` sidebar group awaiting
  engine-generated content.
- **`packages/engine`**: uv-managed Python package `botforge_engine` with typer CLI `botforge`
  (validate/build/clean stubs exiting 2 until Phase 1), pytest + ruff green.
- **`packages/firmware`**: PlatformIO project. `esp32s3` env (pioarduino platform for
  arduino-esp32 core 3.x, 8 MB dual-OTA + LittleFS partition table, USB-CDC flags, blink
  `main.cpp`) and `native` env (Unity tests, green locally).
- **`packages/behavior-ts` / `sim` / `shared`**: empty-but-runnable TS packages, vitest green.
- **`infra/engine.Dockerfile`**: python:3.12-slim + uv + CadQuery/pyrender system deps +
  graphviz + PrusaSlicer CLI. **`infra/profiles/pla-0.20.ini`**: 0.2 mm / 3 walls / 15 % gyroid /
  no supports.
- **`.github/workflows/ci.yml`**: lint → test-js/test-py → engine-build (Docker) →
  firmware-build → web-build → release-on-tag, per PLAN §4.4.
- **Licensing** per PLAN §D: root `LICENSE-CODE.md` (proprietary), GPL-3.0 in
  `packages/firmware`, `packages/behavior-ts`, `packages/sim`; CC BY-NC-SA 4.0 notices in
  `robots/` and `registry/`.
- **Internal docs**: `docs/DECISIONS.md` (5 entries), `docs/BACKLOG.md`, `docs/reports/`.

## Deviations (all logged in docs/DECISIONS.md)

1. Python 3.11 locally / 3.12 in CI+Docker (sandbox cannot download 3.12).
2. pnpm 10 instead of pnpm 9.
3. pioarduino platform fork to get arduino-esp32 core 3.x under PlatformIO.
4. PrusaSlicer from Debian repo (2.5.x) instead of AppImage in the engine image.
5. ESLint 8 inside `apps/web` (Next 14 requirement), ESLint 9 available at root.

## Acceptance checklist

- [x] `pnpm build` green (web + docs + 3 TS packages)
- [x] `pnpm test` green (5 suites)
- [x] `uv run botforge --help` green (pytest + ruff also green)
- [x] `pio test -e native` green locally
- [ ] `pio run -e esp32s3` — **deferred to CI**: the dev sandbox's egress proxy returns 403 for
      GitHub release assets, so the ESP32 platform/toolchain cannot download here. The CI job
      `firmware-build` performs this build on GitHub runners.
- [ ] Engine Docker image build — attempted locally; validated by the CI `engine-build` job on
      GitHub runners for the same proxy reason (base-image/apt fetches).
- [x] README verified: commands above were each run on this clean clone.

## How Lewis can verify locally (<10 min)

```bash
git clone <repo> && cd <repo> && git checkout claude/plan-execution-agents-wh7su8
pnpm install && pnpm build && pnpm test          # all green, ~1 min
uv sync --project packages/engine
uv run --project packages/engine botforge --help # shows validate/build/clean
pip install platformio
pio test -d packages/firmware -e native          # 2 unity tests pass
pio run -d packages/firmware -e esp32s3          # full ESP32 build (needs normal internet)
docker build -f infra/engine.Dockerfile .        # engine environment image
```
