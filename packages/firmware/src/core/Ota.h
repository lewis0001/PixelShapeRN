/**
 * botforge firmware — OTA updates (§5.4, PLAN Phase 2.6).
 *
 * Two paths:
 *   1. POST /api/ota — raw firmware.bin upload, streamed into Update.h.
 *      HttpApi owns the route; it delegates each upload chunk here.
 *   2. Optional check-on-boot against a GitHub Releases latest.json
 *      ({"version": "x.y.z", "url": "https://.../firmware.bin"}), enabled by
 *      the optional "ota_check": true flag in config.json (plus optional
 *      "ota_url" override). The engine does not emit these yet; the firmware
 *      honours them when present.
 */
#pragma once
#ifndef NATIVE_BUILD

#include <WebServer.h>

#include "Config.h"

namespace botforge {

class Ota {
 public:
  /// Feed one WebServer upload event (UPLOAD_FILE_START/WRITE/END/ABORTED)
  /// into the flash updater. Call from the /api/ota upload handler.
  static void handleUploadChunk(WebServer& server);

  /// True when the last completed upload flashed successfully.
  static bool uploadOk();

  /// Human-readable error of the last failed upload ("" when none).
  static const char* lastError();

  /// Check latest.json and self-update when a newer version is published.
  /// No-op unless config enables it and Wi-Fi is connected. Blocking; call
  /// once at the end of setup(). Reboots on success.
  static void checkOnBoot(Config& config);
};

}  // namespace botforge

#endif  // NATIVE_BUILD
