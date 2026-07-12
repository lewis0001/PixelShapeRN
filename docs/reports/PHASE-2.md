# Phase 2 report — Universal firmware + browser flashing + drive app

Date: 2026-07-12
Status: **code-complete**; bench acceptance blocked on 🧍 hardware (see PHASE-2-bench.md).

## What was built

- **Firmware** (`packages/firmware/src/`): boot chain LittleFS → Config → drivers →
  Net → HTTP/WS → VM autostart, exactly the PLAN Phase-2 structure. §5.4 protocol
  implemented verbatim (HTTP API on 80, WS on 81, telemetry 5 Hz, 800 ms manual-mode
  deadman). Provisioning: STA join → 3 fails → SoftAP `Botforge-XXXX` + 6.4 KB captive
  portal → mDNS; BOOT hold 5 s wipes creds. OTA via POST + optional check-on-boot.
  Seven drivers behind a string→constructor Factory (P2), with motor slew limiting and
  staggered servo attach built in (brownout prevention).
- **Behavior VM** (`src/vm/`): §5.3 semantics on fixed pools — zero heap after load,
  4 activations × 16 frames, 200-op budget, binary32 math. Frozen `Vm`/`VmHal` API.
- **TS reference interpreter** (`packages/behavior-ts`): types + zod schema +
  `BsjInterpreter`; `SEMANTICS.md` pins every deterministic detail.
- **Shared golden traces**: 12 fixtures in `packages/behavior-ts/fixtures/` run through
  BOTH interpreters — traces are byte-identical (35 TS tests, 45 native test cases).
- **Web**: `/drive` (RobotLink/WsLink, pointer-event joystick @10 Hz, servo sliders from
  `/api/config`, telemetry bar, log console, behavior upload+run) and `/flash`
  (ESP Web Tools, disabled fallback until the first release). 29 web tests.
- **CI**: firmware job now builds app + LittleFS image, merges a single flashable
  `firmware-merged.bin` (esptool) and generates `esp-web-tools-manifest.json` with
  absolute release-asset URLs; both attach to GitHub Releases on `v*` tags.

## Deviations / notes

- ESP32-S3 compile runs in CI only (sandbox proxy blocks the xtensa toolchain); all 15
  target translation units were syntax-checked against real ArduinoJson 7 locally, and
  every pure-logic piece runs under the native test env (45/45 green).
- §5.4 gap-filling decisions (wifi.json shape, portal endpoints, PUT config reboot,
  mode semantics, autostart marker, single SHA-256 path) are logged in DECISIONS.md.

## Acceptance checklist

- [x] VM native tests green, same fixtures as TS (12 shared golden traces)
- [ ] Firmware binary ≤ 1.6 MB, free heap > 100 KB after boot — **CI/bench** (first
      tagged release will show binary size; heap needs the board)
- [ ] Flash-from-Chrome on a clean machine — 🧍 needs hardware + first release tag
- [ ] 🧍 Bench protocol (PHASE-2-bench.md) — needs hardware
- [ ] Deadman verified on hardware (logic native-tested incl. millis wrap)
- [ ] Behavior survives reboot + runs with Wi-Fi off — bench step 7

**Next actions:** Lewis orders the bench kit; tag `v0.1.0` once CI is green on main to
produce the first flashable release; then run PHASE-2-bench.md end to end.
