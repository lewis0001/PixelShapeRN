# botforge firmware

Phase-0 PlatformIO project for the universal ESP32-S3 robot firmware.
Right now it is just a scaffold: a blink on the ESP32-S3-DevKitC-1 and a
trivial native Unity test.

## Prerequisites

- [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation/index.html) (`pio`)

## Build (ESP32-S3)

```sh
pio run
```

This builds the `esp32s3` environment. Note: the project uses the
[pioarduino fork](https://github.com/pioarduino/platform-espressif32) of the
espressif32 platform because the official PlatformIO platform does not support
arduino-esp32 core 3.x (see the comment in `platformio.ini`).

## Test (native, host machine)

```sh
pio test -e native
```

Runs the Unity tests under `test/native/` on your host — no hardware needed.

## Flash

```sh
pio run -t upload
```

With `ARDUINO_USB_CDC_ON_BOOT=1` the board enumerates on its native USB port;
monitor with:

```sh
pio device monitor
```

(115200 baud, configured in `platformio.ini`.)

## Layout

- `src/main.cpp` — Phase-0 blink placeholder (compiled out for `native`)
- `lib/vmcore/` — seed of the firmware VM core (currently just `clamp100`)
- `test/native/` — host-side Unity tests
- `partitions.csv` — 8MB flash: dual ~3MB OTA app slots + 1.5MB LittleFS

## Configuration (later phases)

Pin maps and robot configuration are **not** hardcoded here. In later phases
the botforge engine generates a `config.json` that is placed on the LittleFS
data partition and read at boot; the firmware stays universal across robots.
