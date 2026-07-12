/**
 * botforge firmware — global logger instance + Serial mirror.
 *
 * The RingLog class itself is pure and lives in Log.h (native-tested).
 * This file provides the global instance and the target-side glue
 * (millis() timestamps, Serial mirror). It also compiles under the native
 * environment (the Arduino-only parts are guarded) so enabling
 * test_build_src later cannot break the host build.
 */
#include "Log.h"

#ifndef NATIVE_BUILD
#include <Arduino.h>
#endif

namespace botforge {

RingLog& logger() {
  static RingLog instance;
  return instance;
}

void logf(LogLevel level, const char* fmt, ...) {
  char buf[RingLog::kLineLen];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);

#ifndef NATIVE_BUILD
  uint32_t ms = millis();
  // Serial mirror (Phase 2.5). Serial is safe to call before begin() on the
  // S3's USB-CDC (writes are dropped), so no readiness check is needed.
  Serial.printf("[%8lu] [%-5s] %s\r\n", static_cast<unsigned long>(ms),
                RingLog::levelName(level), buf);
#else
  uint32_t ms = 0;
#endif

  logger().add(level, ms, buf);
}

}  // namespace botforge
