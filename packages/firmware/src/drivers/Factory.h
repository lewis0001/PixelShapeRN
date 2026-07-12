/**
 * botforge firmware — driver factory (P2: one universal firmware).
 *
 * Maps the `driver` string from config.json modules[] to a freshly
 * constructed driver instance. Unknown drivers return nullptr: main() logs
 * and skips them (e.g. CoreS3Devkit is a capability record, not a runtime
 * driver; IMU_6050 arrives in Phase 6).
 */
#pragma once
#ifndef NATIVE_BUILD

#include "IModule.h"

namespace botforge {

IModule* createDriver(const char* name);

}  // namespace botforge

#endif  // NATIVE_BUILD
