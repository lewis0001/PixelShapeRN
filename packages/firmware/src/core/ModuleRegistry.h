/**
 * botforge firmware — registry of instantiated driver modules.
 *
 * Maps config.json instance ids ("mdrv", "range", ...) to live IModule
 * pointers and provides the two generic dispatch primitives the rest of the
 * firmware is built on (P2 — no robot-specific routing anywhere):
 *
 *   readField("range.mm")  -> route "<instance>.<field>" to read()
 *   actAll("drive", {...}) -> offer an op to every module; drivers that
 *                             don't handle it return false and are skipped.
 *
 * Header-only and Arduino-free (IModule.h only pulls in ArduinoJson).
 */
#pragma once

#include <stdint.h>
#include <string.h>

#include "../drivers/IModule.h"

namespace botforge {

class ModuleRegistry {
 public:
  static constexpr size_t kMaxModules = 16;
  static constexpr size_t kIdLen = 24;
  static constexpr size_t kDriverLen = 32;

  bool add(const char* id, const char* driver, IModule* mod) {
    if (n_ >= kMaxModules || id == nullptr || mod == nullptr) return false;
    Entry& e = entries_[n_];
    strncpy(e.id, id, kIdLen - 1);
    e.id[kIdLen - 1] = '\0';
    strncpy(e.driver, driver != nullptr ? driver : "", kDriverLen - 1);
    e.driver[kDriverLen - 1] = '\0';
    e.mod = mod;
    ++n_;
    return true;
  }

  size_t size() const { return n_; }
  const char* idAt(size_t i) const { return entries_[i].id; }
  const char* driverAt(size_t i) const { return entries_[i].driver; }
  IModule* at(size_t i) const { return entries_[i].mod; }

  IModule* find(const char* id) const {
    if (id == nullptr) return nullptr;
    for (size_t i = 0; i < n_; ++i) {
      if (strcmp(entries_[i].id, id) == 0) return entries_[i].mod;
    }
    return nullptr;
  }

  /// Route "<instance>.<field>" (e.g. "range.mm") to the instance's read().
  bool readField(const char* dotted, float& out) const {
    if (dotted == nullptr) return false;
    const char* dot = strchr(dotted, '.');
    if (dot == nullptr || dot == dotted || dot[1] == '\0') return false;
    size_t idLen = static_cast<size_t>(dot - dotted);
    if (idLen >= kIdLen) return false;
    char id[kIdLen];
    memcpy(id, dotted, idLen);
    id[idLen] = '\0';
    IModule* mod = find(id);
    if (mod == nullptr) return false;
    return mod->read(dot + 1, out);
  }

  /// Offer an op to every module. True when at least one handled it.
  bool actAll(const char* op, JsonObjectConst params) const {
    bool handled = false;
    for (size_t i = 0; i < n_; ++i) {
      if (entries_[i].mod->act(op, params)) handled = true;
    }
    return handled;
  }

  void tickAll(uint32_t now) const {
    for (size_t i = 0; i < n_; ++i) entries_[i].mod->tick(now);
  }

 private:
  struct Entry {
    char id[kIdLen] = {0};
    char driver[kDriverLen] = {0};
    IModule* mod = nullptr;
  };

  Entry entries_[kMaxModules];
  size_t n_ = 0;
};

}  // namespace botforge
