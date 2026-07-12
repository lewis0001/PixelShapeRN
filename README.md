# BOTFORGE

> Codename `botforge` — rename with one global find/replace when the brand is chosen.

An open, modular robotics platform — "LEGO for real robots." A single manifest
file per robot (`robots/<id>/robot.yaml`) is compiled by the engine into every
artifact: CAD files, wiring diagrams, assembly instructions, BOM, docs,
firmware config, simulator model, and store page.

**`PLAN.md` is the source of truth.** Deviations are logged in
`docs/DECISIONS.md`; phase completion reports live in `docs/reports/`.

## Repository layout

| Path                   | What                                                         |
| ---------------------- | ------------------------------------------------------------ |
| `apps/web`             | Next.js 14 site (catalog, builder, sim, drive, flash, store) |
| `apps/docs`            | Astro Starlight docs (per-robot guides, engine-generated)    |
| `packages/engine`      | Python compiler: manifest → all artifacts. CLI `botforge`    |
| `packages/firmware`    | Universal ESP32-S3 firmware (PlatformIO)                     |
| `packages/behavior-ts` | Behavior Script JSON types + reference interpreter           |
| `packages/sim`         | three.js + Rapier browser simulator                          |
| `packages/shared`      | Shared TS types                                              |
| `registry/`            | Electronic module + fastener catalog (YAML)                  |
| `robots/`              | Per-robot data definitions (the only place robots live)      |
| `infra/`               | Engine Docker image, slicer profiles                         |

## Prerequisites

- Node 20+ and pnpm 10 (`corepack enable` or `npm i -g pnpm`)
- Python 3.11+ and [uv](https://docs.astral.sh/uv/)
- Optional: PlatformIO (`pip install platformio`) for firmware
- Optional: Docker (for the full engine environment with CadQuery/PrusaSlicer)

## Commands

| Command                                                              | Does                           |
| -------------------------------------------------------------------- | ------------------------------ |
| `pnpm install`                                                       | Install all JS workspace deps  |
| `pnpm dev`                                                           | Web + docs dev servers (turbo) |
| `pnpm build`                                                         | Build all JS apps/packages     |
| `pnpm test`                                                          | All JS tests                   |
| `uv sync --project packages/engine`                                  | Install engine deps            |
| `uv run --project packages/engine botforge validate robots/rover-v1` | Schema + registry validation   |
| `uv run --project packages/engine botforge build robots/rover-v1`    | Full artifact build → `dist/`  |
| `pnpm fw:build`                                                      | Firmware build (`pio run`)     |
| `pnpm fw:test`                                                       | Behavior VM native tests       |
| `pnpm e2e`                                                           | Playwright suite (Phase 4)     |

## Licensing

Mixed-license monorepo — see `docs/DECISIONS.md` and PLAN.md §D:

- Platform code (`apps/*`, `packages/engine`, `packages/shared`): proprietary — `LICENSE-CODE.md`
- `packages/firmware`, `packages/behavior-ts`, `packages/sim`: GPL-3.0
- `robots/`, `registry/`, generated docs/CAD: CC BY-NC-SA 4.0
