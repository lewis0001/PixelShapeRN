/**
 * botforge firmware — version constants + tiny semver compare.
 *
 * Pure logic: no Arduino includes, compiles under both the esp32s3 and
 * native environments (native-tested in test/native/test_core).
 */
#pragma once

#include <stddef.h>

/// Firmware version reported in /api/info, hello.ack and used by the
/// check-on-boot OTA comparison against the GitHub Release latest.json.
#define BOTFORGE_FW_VERSION "0.2.0"

namespace botforge {

/// Parse up to 3 dot-separated numeric fields from a version string.
/// Non-numeric suffixes (e.g. "-rc1") terminate parsing of that field.
inline void parseVersion(const char* s, long out[3]) {
  out[0] = out[1] = out[2] = 0;
  if (s == nullptr) return;
  for (int field = 0; field < 3; ++field) {
    long v = 0;
    bool any = false;
    while (*s >= '0' && *s <= '9') {
      v = v * 10 + (*s - '0');
      any = true;
      ++s;
    }
    out[field] = any ? v : 0;
    if (*s != '.') break;
    ++s;
  }
}

/// True when version `a` is strictly older than version `b` ("x.y.z" style).
inline bool versionLess(const char* a, const char* b) {
  long va[3];
  long vb[3];
  parseVersion(a, va);
  parseVersion(b, vb);
  for (int i = 0; i < 3; ++i) {
    if (va[i] < vb[i]) return true;
    if (va[i] > vb[i]) return false;
  }
  return false;
}

}  // namespace botforge
