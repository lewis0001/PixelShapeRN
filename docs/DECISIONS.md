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

## 2026-07-12 — §5.1 pin-type enum extended with `motor_out` and `switch`

PLAN §5.1 fixes pin types to `gpio, pwm, adc, i2c_sda, i2c_scl, 5v, 3v3, gnd,
vbat`, but the frozen §5.2 rover manifest wires endpoints that none of those
types can describe: `mdrv.aout1..bout2 → motor_left/right.m1/m2` (H-bridge
outputs to motor terminals) and `sw.a/b → pwr.out_switch_a/b` (mechanical
switch inline on the boost rail). Two types are added: `motor_out` (driver
output / motor terminal, legal only against another `motor_out`) and `switch`
(switch terminal / switched-rail terminal, legal only against another
`switch`). Migration note: no existing data predates this — the enum ships
extended from the first registry commit. This is the minimal change that
makes the frozen rover manifest validate.

## 2026-07-12 — Core GPIO capability map lives in `firmware.params`

§5.1's launch-module table says the core module "exposes gpio map" without
specifying where. Rather than extend the frozen module schema, the core
module's free-form `firmware.params` dict carries `available_gpios`,
`adc1_gpios`, and `reserved_gpios`. The validator (required pins, ADC-only
rule, double-booking, reserved pins) and the firmware-config generator read it
from there. Core `pins:` lists only the power pins (5v/3v3/gnd); `gpioN`
endpoint names are validated against `available_gpios`.

## 2026-07-12 — CadQuery ≥2.4 resolves to 2.8.x

PLAN §4.2 names CadQuery 2.4; the current release line (2.8.x, same API for
everything cadlib uses) installs cleanly on Python 3.11/3.12 with prebuilt OCP
wheels. The engine declares `cadquery>=2.4` in the optional `cad` extra and CI
uses the resolved 2.8.x. No 2.4-only pinning reason exists.

## 2026-07-12 — §5.5 config.json: real pin names and manifest ordering

The frozen §5.5 example shows `line` pins as `"l"/"r"` and lists `pwr` last.
The registry defines the line-sensor pins as `out_l`/`out_r`, and §5.5's own
rule ("derived entirely from robot.yaml connections") means pin keys come from
the registry pin names — the example's `l`/`r` shorthand loses information, so
the real names win. Module order follows manifest order (deterministic,
derivable), which places `pwr` first rather than last. Everything else in the
example is reproduced byte-exactly and frozen in a test.

## 2026-07-12 — Golden tests: full text for text artifacts, existence/QC for binaries

Phase 1.15 asks for "hashes for binary files". STEP files embed export
timestamps, PNG bytes depend on the GL rasterizer build, and SVG layout varies
across graphviz releases — hashing any of them would make goldens fail on
byte-noise, not regressions. Instead: every TEXT artifact (json/yaml/csv/
md/mdx/urdf) is committed in full for `_test-min` and hash-snapshotted for
`rover-v1`; binaries are checked for presence + non-zero size, with geometry
regressions caught by the (text) `cad/qc_report.json` volumes/bboxes and the
URDF masses. Print estimates in goldens use a committed deterministic fake
slicer; the real-slicer 60–180 g sanity check runs where PrusaSlicer exists
(the CI engine container).

## 2026-07-12 — companion-v1 added to the roadmap (owner request)

Lewis requested a more complex flagship robot: rolls, follows its user, has AI
chat, user-customisable abilities. Choices made: rolling form factor (not
biped), app-first chat with onboard voice as a configurator upgrade, camera
person-tracking for follow-me. Spec: docs/proposals/COMPANION-V1.md. It slots
into Phase 6 as robot #3 (arm-v1 → BACKLOG) with the AI-chat platform work in
Phase 7. Phase order and §5 contracts unchanged; new capability arrives as
registry modules + firmware drivers, per the plan's own extension rules.

## 2026-07-12 — ESLint: flat v9 at root, legacy v8 inside apps/web

`next lint` on Next.js 14 requires eslint 8 + eslint-config-next. Rest of the
workspace uses the root prettier + per-package `tsc --noEmit` for linting in
Phase 0. Revisit if/when the web app moves to Next 15.

## 2026-07-12 — Phase 2 firmware core: §5.4/§5.5 interpretation calls

Decisions made while implementing packages/firmware/src/{main.cpp,core,drivers}
(none change a frozen contract; they fill gaps the PLAN leaves open):

- **WS/HTTP stack:** bundled synchronous `WebServer.h` (port 80) +
  `links2004/WebSockets` (port 81). Boring, huge training/data coverage; async
  buys nothing at 5 Hz telemetry. `WebSocketsServer` does not filter request
  paths — clients use `ws://host:81/ws` per §5.4 and any path is accepted.
- **cfg_hash:** one tiny self-contained SHA-256 (`core/Sha256.h`) on BOTH
  target and native instead of mbedtls-on-target, so the reported hash and the
  native-test hash share one code path. Vectors tested in test_core.
- **/wifi.json shape (unspecified):** `{"ssid","pass","name"}`; `name` is the
  user-chosen robot name from the portal, falling back to `name_default`.
- **Portal provisioning endpoints (unspecified):** `GET /provision/scan` and
  `POST /provision` on port 80, deliberately outside the frozen `/api` set.
  QR on the success screen: text-fallback (big tappable URL) instead of an
  inline QR generator — allowed by Phase 2.4, keeps the page at 6.4 KB.
- **Autostart flag storage:** `/autostart_off` marker file on LittleFS
  (absent = autostart on). `behavior/ctl run` with no uploaded behavior loads
  `/behavior.json`.
- **PUT /api/config reboots** (after replying `{ok,cfg_hash,rebooting:true}`):
  drivers re-init from config only at boot; a reboot is the simplest correct
  apply.
- **mode messages:** `manual` stops the VM, hard-stops motors and arms the
  800 ms deadman; `behavior` disarms the deadman and (re)starts the loaded
  behavior. Deadman trip = hard stop (bypasses motor slew).
- **Line_TCRT pin names:** engine emits registry names `out_l`/`out_r`; the
  §5.5 example shows `l`/`r`. The driver accepts both spellings.
- **telemetry sources:** `batt_mv` from whichever module answers read("mv")
  (PowerMon; 0 = unknown since the rover shield has no divider, vbat_adc null);
  `sensors` built from a `telemetryFields()` additive extension on IModule
  (default "" keeps the PLAN interface contract).
- **OTA check-on-boot:** optional top-level config keys `ota_check` (+
  `ota_url` override) — additive, engine does not emit them yet. GitHub TLS
  via setInsecure(): opt-in channel, LAN POST /api/ota stays primary.
- **BSJ rand inclusivity:** VmHal `random(lo,hi)` treats both ends inclusive
  (Appendix B uses `rand [0,1]` as a coin flip); Arduino `random()` upper
  bound is exclusive, so the bridge passes `hi+1`.
- **ArduinoJson in the native env lib_deps:** header-only and platform-free;
  required by native tests that parse the real rover config.json (and by the
  VM's BSJ tests). Device-only libs remain esp32s3-only.
