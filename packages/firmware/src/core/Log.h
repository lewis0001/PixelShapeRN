/**
 * botforge firmware — logging: 128-line ring buffer + Serial mirror + sink.
 *
 * Structure:
 *   - RingLog (this header): pure, fixed-size ring buffer. No Arduino
 *     includes; native-tested in test/native/test_core (wraparound etc.).
 *   - Log.cpp (target glue): the global logger() instance, printf-style
 *     logf(), millis() time source and the Serial mirror.
 *
 * Consumers:
 *   - GET /api/logs dumps the ring (HttpApi).
 *   - The WS server subscribes via setSink() to forward `log` messages.
 */
#pragma once

#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

namespace botforge {

enum LogLevel : uint8_t {
  LOG_DEBUG = 0,
  LOG_INFO = 1,
  LOG_WARN = 2,
  LOG_ERROR = 3,
};

class RingLog {
 public:
  static constexpr size_t kLines = 128;    // §5.4 / Phase 2.5: 128-line ring
  static constexpr size_t kLineLen = 120;  // per-line text budget incl. NUL

  using Sink = void (*)(void* ctx, LogLevel level, uint32_t ms,
                        const char* msg);

  RingLog() { clear(); }

  void clear() {
    head_ = 0;
    count_ = 0;
    totalAdded_ = 0;
  }

  void add(LogLevel level, uint32_t ms, const char* msg) {
    Line& line = lines_[head_];
    line.ms = ms;
    line.level = level;
    if (msg == nullptr) msg = "";
    strncpy(line.text, msg, kLineLen - 1);
    line.text[kLineLen - 1] = '\0';
    head_ = (head_ + 1) % kLines;
    if (count_ < kLines) ++count_;
    ++totalAdded_;
    if (sink_ != nullptr) sink_(sinkCtx_, level, ms, line.text);
  }

  void addf(LogLevel level, uint32_t ms, const char* fmt, ...) {
    char buf[kLineLen];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    add(level, ms, buf);
  }

  /// Lines currently held (<= kLines).
  size_t size() const { return count_; }

  /// Lines ever added (monotonic; size() saturates, this does not).
  uint64_t totalAdded() const { return totalAdded_; }

  /// i = 0 is the OLDEST retained line, i = size()-1 the newest.
  const char* text(size_t i) const { return lineAt(i).text; }
  LogLevel level(size_t i) const { return lineAt(i).level; }
  uint32_t timeMs(size_t i) const { return lineAt(i).ms; }

  /// Optional live subscriber (e.g. the WS server's `log` broadcast).
  void setSink(Sink sink, void* ctx) {
    sink_ = sink;
    sinkCtx_ = ctx;
  }

  static const char* levelName(LogLevel level) {
    switch (level) {
      case LOG_DEBUG:
        return "debug";
      case LOG_INFO:
        return "info";
      case LOG_WARN:
        return "warn";
      case LOG_ERROR:
        return "error";
    }
    return "info";
  }

 private:
  struct Line {
    uint32_t ms = 0;
    LogLevel level = LOG_INFO;
    char text[kLineLen] = {0};
  };

  const Line& lineAt(size_t i) const {
    // Oldest line sits at head_ - count_ (mod kLines).
    size_t start = (head_ + kLines - count_) % kLines;
    return lines_[(start + i) % kLines];
  }

  Line lines_[kLines];
  size_t head_ = 0;
  size_t count_ = 0;
  uint64_t totalAdded_ = 0;
  Sink sink_ = nullptr;
  void* sinkCtx_ = nullptr;
};

// ---------------------------------------------------------------------------
// Global logger glue, implemented in Log.cpp for the target build. Native
// tests instantiate their own RingLog and do not need these.
// ---------------------------------------------------------------------------

/// The one global ring buffer instance.
RingLog& logger();

/// printf-style log with the current uptime; mirrors to Serial on target.
void logf(LogLevel level, const char* fmt, ...);

}  // namespace botforge
