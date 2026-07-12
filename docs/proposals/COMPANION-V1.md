# companion-v1 — AI companion robot (owner-approved scope addition)

Approved by Lewis 2026-07-12 (form factor / chat / follow-me chosen via review session).
This robot is DATA plus allowed registry+driver additions — zero engine changes (P1/P5).

## Product

A palm-plus-sized rolling companion with an expressive servo head, camera person-tracking
("follows you"), and AI chat. Phone/app chat at launch; onboard voice (mic + speaker) as a
configurator upgrade. Abilities are user-customisable three ways: block builder behaviors
(BSJ), configurator hardware options, and an AI personality + permitted-tools panel (Pro).

## New registry modules (+ firmware drivers, additions allowed per PLAN Phase 6.2 precedent)

| id                         | driver        | purpose                                                                                                         | ~USD  |
| -------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------- | ----- |
| `core-esp32s3-cam-n16r8`   | `CoreS3Cam`   | Freenove-style ESP32-S3 WROOM board with OV2640 DVP connector, 16MB flash / 8MB PSRAM (audio + vision headroom) | 12.00 |
| `cam-ov2640`               | `Cam_OV2640`  | person detection (esp-who) at QVGA; publishes `person.{seen,cx,area}` sensor fields                             | 6.00  |
| `mic-inmp441`              | `Mic_I2S`     | voice upgrade option — I2S MEMS mic                                                                             | 2.00  |
| `amp-max98357a` + speaker  | `Speaker_I2S` | voice upgrade option — I2S amp + 28mm speaker                                                                   | 3.50  |
| `servo-sg90` ×2 (existing) | `Servo_Std`   | head pan + tilt (expression + camera aiming)                                                                    | —     |

Existing modules reused: pwr-1s-boost, drv-8833, 2× motor-n20, sens-vl53l0x (cliff/obstacle),
led-ws2812-2 (or -8 ring variant later), buzzer-passive, sw-slide.

## Behaviors (BSJ, shipped)

`follow_me` (camera cx/area → differential steering + head tracking), `pet_mode+`,
`patrol`, `dance`. New sensor fields (`person.*`) fit the existing BSJ `{"sensor": ...}`
expression — no format change. `on_person` event NOT added; polling via on_tick suffices (§5.3 op freeze).

## AI chat & customisation (platform, Phase 7 alongside support agent)

- App chat: web app mic/keyboard → Edge Function → Anthropic API with robot tool-use:
  the model can call `drive`, `servo`, `led`, `tone`, `say`, `run_behavior` — mapped 1:1
  onto the §5.4 WebSocket cmd set to the connected robot. Personality prompt + tool
  allowlist stored per robot; editable at `/account` (Pro gate per PLAN §1.2).
- Voice upgrade: wake word on-device, audio streamed via the same Edge Function; TTS back
  to `Speaker_I2S`. P8 preserved: robot fully functional offline; chat is additive.

## Sequencing (phase order unchanged — rule 1)

- Phase 2/3 as planned (firmware, VM, sim, builder are prerequisites).
- Phase 6: companion-v1 replaces arm-v1 as robot #3 (arm-v1 → backlog); `Cam_OV2640`
  driver + esp-who integration lands as the phase's registry+driver addition.
- Phase 7: AI chat gateway + personality panel built together with the support agent
  (same Anthropic API plumbing).
- 🧍 hardware to add to the Phase 2 dev order: 1× Freenove ESP32-S3 WROOM (CAM) N16R8,
  1× OV2640, 1× INMP441, 1× MAX98357A + 28mm speaker (~£18 extra).
