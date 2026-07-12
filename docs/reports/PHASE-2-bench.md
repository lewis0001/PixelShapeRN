# Phase 2 bench test protocol — 🧍 Lewis, with real hardware

Hardware (Appendix C, ~£30): ESP32-S3-DevKitC-1 N8R2, DRV8833, 2× N20 6V 150RPM,
VL53L0X, 2ch TCRT5000, WS2812 stick, passive buzzer, 1S 18650 USB-C boost shield,
18650 cell (sourced locally), jumper wires.
Optional companion-v1 extras (~£18): Freenove ESP32-S3 WROOM (CAM) N16R8, OV2640,
INMP441 mic, MAX98357A + 28 mm speaker.

Each step maps to a Phase 2 acceptance item. Tick them in order.

1. **Flash from Chrome** — tag `v0.1.0` on the branch/main so CI attaches
   `firmware-merged.bin` + manifest to a GitHub Release, then open the site's
   `/flash` page (or run ESP Web Tools against the manifest URL): plug USB-C →
   hold BOOT while clicking Install → release when it connects.
   ▢ Board flashes and reboots.
2. **Provision** — join the `Botforge-XXXX` Wi-Fi from a phone; the captive
   portal opens; pick your Wi-Fi, set name "rover"; submit.
   ▢ Portal shows `http://rover.local` (or its IP); robot joins your network.
3. **Wire the bench rover** — follow `dist/rover-v1/wiring/wiring.svg` (colors
   match). Upload the rover config: `curl -X PUT http://rover.local/api/config
   --data-binary @dist/rover-v1/firmware/config.json`. Board reboots with drivers live.
4. **Drive** — open `/drive`, connect to `rover.local`, switch mode to manual.
   ▢ Joystick moves both motors (smooth ramp, no jerk = slew limiting works).
   ▢ Telemetry bar shows battery mV, RSSI, range.mm and line.l/r changing.
5. **Deadman** — while driving, kill the browser tab.
   ▢ Motors stop within ~1 second.
6. **Behavior on-device** — on `/drive`, upload
   `dist/rover-v1/behaviors/avoid_obstacles.json` → Run.
   ▢ Startup chirp + green LEDs; wave a hand < 14 cm from the ToF: it backs
   away, turns, LEDs flash red.
7. **Standalone (P8)** — power-cycle the robot away from your Wi-Fi (or turn
   the router's 2.4 GHz off).
   ▢ Behavior auto-starts after boot with no connection at all.
8. **Factory reset** — hold BOOT 5 s.
   ▢ Wi-Fi creds wiped; `Botforge-XXXX` AP returns.
9. **Brownout check** — full-stick forward/reverse flips repeatedly on battery.
   ▢ No reboots (if it reboots: charge cell, check 5V/GND wire gauge — this is
   the exact failure the slew limiter + staggered attach exist to prevent).

Also record: free heap after boot (`GET /api/info` → serial log prints it) —
acceptance wants > 100 KB — and the merged binary size (≤ 1.6 MB app slot).
