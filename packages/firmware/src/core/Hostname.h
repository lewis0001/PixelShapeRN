/**
 * botforge firmware — device naming helpers (§5.4 provisioning).
 *
 *   - SoftAP SSID:      "Botforge-XXXX"  (XXXX = last two MAC bytes, upper hex)
 *   - default hostname: "botforge-xxxx"  (mDNS: botforge-xxxx.local)
 *   - user-chosen name: sanitized to a legal mDNS hostname label.
 *
 * Pure logic, header-only: no Arduino includes; native-tested in
 * test/native/test_core.
 */
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace botforge {

/// Max hostname label we produce (mDNS labels allow 63; keep it short).
constexpr size_t kHostnameMax = 32;  // incl. NUL

inline char hexUpper(uint8_t nibble) {
  return nibble < 10 ? static_cast<char>('0' + nibble)
                     : static_cast<char>('A' + nibble - 10);
}

inline char hexLower(uint8_t nibble) {
  return nibble < 10 ? static_cast<char>('0' + nibble)
                     : static_cast<char>('a' + nibble - 10);
}

/// "Botforge-XXXX" from the last two MAC bytes. `out` >= 14 bytes.
inline void defaultApSsid(uint8_t mac4, uint8_t mac5, char* out) {
  const char prefix[] = "Botforge-";
  size_t i = 0;
  for (; prefix[i] != '\0'; ++i) out[i] = prefix[i];
  out[i++] = hexUpper(mac4 >> 4);
  out[i++] = hexUpper(mac4 & 0x0f);
  out[i++] = hexUpper(mac5 >> 4);
  out[i++] = hexUpper(mac5 & 0x0f);
  out[i] = '\0';
}

/// "botforge-xxxx" from the last two MAC bytes. `out` >= 14 bytes.
inline void defaultHostname(uint8_t mac4, uint8_t mac5, char* out) {
  const char prefix[] = "botforge-";
  size_t i = 0;
  for (; prefix[i] != '\0'; ++i) out[i] = prefix[i];
  out[i++] = hexLower(mac4 >> 4);
  out[i++] = hexLower(mac4 & 0x0f);
  out[i++] = hexLower(mac5 >> 4);
  out[i++] = hexLower(mac5 & 0x0f);
  out[i] = '\0';
}

/// Sanitize a user-chosen robot name into an mDNS hostname label:
/// lowercase [a-z0-9-], runs of other characters collapse to a single '-',
/// no leading/trailing '-', truncated to outLen-1. Empty result -> "botforge".
inline void sanitizeHostname(const char* name, char* out, size_t outLen) {
  if (outLen == 0) return;
  size_t o = 0;
  bool pendingDash = false;
  if (name != nullptr) {
    for (const char* p = name; *p != '\0' && o + 1 < outLen; ++p) {
      char c = *p;
      if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
      bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
      if (ok) {
        if (pendingDash && o > 0 && o + 2 < outLen) out[o++] = '-';
        pendingDash = false;
        out[o++] = c;
      } else {
        pendingDash = true;  // collapse runs; drop if leading/trailing
      }
    }
  }
  out[o] = '\0';
  if (o == 0) {
    const char fallback[] = "botforge";
    size_t i = 0;
    for (; fallback[i] != '\0' && i + 1 < outLen; ++i) out[i] = fallback[i];
    out[i] = '\0';
  }
}

}  // namespace botforge
