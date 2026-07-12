# DECISIONS.md

Running log of decisions and deviations from PLAN.md, per §0 rule 2.
Format: date · decision · reason.

---

## 2026-07-12 — Local Python 3.11, CI/Docker Python 3.12

PLAN §4.2 fixes Python 3.12. The development sandbox cannot download a 3.12
interpreter (proxy blocks the python-build-standalone GitHub release assets),
so `packages/engine` declares `requires-python = ">=3.11"` and is developed
against 3.11 locally. CI (`setup-uv`/`setup-python`) and the engine Docker
image (`python:3.12-slim-bookworm`) both use 3.12, which remains the canonical
runtime. No 3.12-only syntax is used.

## 2026-07-12 — pnpm 10 instead of pnpm 9

PLAN §4.2 says pnpm 9. The environment ships pnpm 10.33 (a strict superset for
our purposes); pinning back to 9 would require corepack downloads that the
proxy may block. `packageManager` is pinned to `pnpm@10.33.0`. No pnpm-9-only
behavior is relied on.

## 2026-07-12 — pioarduino platform fork for arduino-esp32 core 3.x

PLAN §4.2 requires arduino-esp32 core 3.x on ESP32-S3. The official PlatformIO
`espressif32` platform stopped at core 2.x; the community-maintained
`pioarduino/platform-espressif32` fork is the standard way to get core 3.x
under PlatformIO. `packages/firmware/platformio.ini` pins a released zip of
that fork.

## 2026-07-12 — PrusaSlicer from Debian repo (2.5.x) in the engine image

PLAN §4.2/Phase 0.4 say "PrusaSlicer CLI (AppImage extracted)". Upstream
AppImage asset names embed build timestamps (not stably pinnable) and need
FUSE workarounds in containers. Debian bookworm ships `prusa-slicer` 2.5.x
whose CLI emits the same `; filament used [g]` / estimated-time gcode comments
the print-plan generator parses. The engine image installs it via apt. If a
2.7+ feature is ever needed, revisit with a pinned AppImage mirror.

## 2026-07-12 — ESLint: flat v9 at root, legacy v8 inside apps/web

`next lint` on Next.js 14 requires eslint 8 + eslint-config-next. Rest of the
workspace uses the root prettier + per-package `tsc --noEmit` for linting in
Phase 0. Revisit if/when the web app moves to Next 15.
