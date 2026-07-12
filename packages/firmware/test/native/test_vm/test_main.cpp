/**
 * botforge firmware — BSJ VM golden-trace conformance tests (native host).
 *
 * Runs every fixture from packages/behavior-ts/fixtures/ (the SAME files the
 * TypeScript reference interpreter is tested with) through the C++ VM with a
 * recording mock HAL and asserts the exact ordered HAL trace. The harness
 * procedure and trace format are specified in that directory's README.md.
 *
 * Fixture location: $BSJ_FIXTURES if set, otherwise resolved relative to the
 * current working directory — both the repo root ("packages/behavior-ts/
 * fixtures") and the firmware project dir ("../behavior-ts/fixtures") work.
 *
 * Run with: pio test -d packages/firmware -e native
 */
#include <unity.h>

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include <ArduinoJson.h>

// Compile the VM into this test binary directly (the native test build does
// not compile src/, and test_build_src would drag Arduino-only code into
// sibling test suites).
#include "../../../src/vm/Vm.cpp"

// ---------------------------------------------------------------------------
// Mock HAL: records "<now> <call> <args>" lines, scripted sensors + random.
// ---------------------------------------------------------------------------

struct MockHal : public VmHal {
  uint32_t nowMs = 0;
  std::vector<std::string> trace;
  std::map<std::string, std::vector<std::pair<uint32_t, float>>> sensors;
  std::vector<long> randomSeq;
  size_t randomIdx = 0;

  void rec(const std::string& line) {
    trace.push_back(std::to_string(nowMs) + " " + line);
  }
  void drive(int l, int r) override {
    rec("drive " + std::to_string(l) + " " + std::to_string(r));
  }
  void servo(const char* id, int deg) override {
    rec("servo " + std::string(id) + " " + std::to_string(deg));
  }
  void led(int r, int g, int b, int id) override {
    rec("led " + std::to_string(r) + " " + std::to_string(g) + " " +
        std::to_string(b) + " " + std::to_string(id));
  }
  void ledOff(int id) override { rec("led_off " + std::to_string(id)); }
  void tone(int hz, int ms) override {
    rec("tone " + std::to_string(hz) + " " + std::to_string(ms));
  }
  float readSensor(const char* name) override {
    auto it = sensors.find(name);
    if (it == sensors.end()) return 0.0f;
    float value = 0.0f;
    for (const auto& step : it->second) {
      if (step.first <= nowMs) value = step.second;
      else break;
    }
    return value;
  }
  void log(int level, const char* msg) override {
    rec("log " + std::to_string(level) + " " + msg);
  }
  long random(long lo, long /*hi*/) override {
    if (randomSeq.empty()) return lo;
    long v = randomSeq[randomIdx % randomSeq.size()];
    randomIdx++;
    return v;
  }
};

// ---------------------------------------------------------------------------
// Fixture discovery + runner
// ---------------------------------------------------------------------------

static std::string g_fixturesDir;
static std::string g_fixturePath; // set before each UnityDefaultTestRun

static bool readFile(const std::string& path, std::string& out) {
  std::ifstream f(path, std::ios::binary);
  if (!f) return false;
  std::ostringstream ss;
  ss << f.rdbuf();
  out = ss.str();
  return true;
}

static std::string resolveFixturesDir() {
  const char* env = getenv("BSJ_FIXTURES");
  std::vector<std::string> candidates;
  if (env != nullptr && env[0] != '\0') candidates.push_back(env);
  candidates.push_back("packages/behavior-ts/fixtures"); // cwd = repo root
  candidates.push_back("../behavior-ts/fixtures");       // cwd = packages/firmware
  candidates.push_back("../../packages/behavior-ts/fixtures");
  for (const auto& c : candidates) {
    std::string probe;
    if (readFile(c + "/index.json", probe)) return c;
  }
  return "";
}

static void run_fixture(void) {
  std::string text;
  TEST_ASSERT_TRUE_MESSAGE(readFile(g_fixturePath, text),
                           ("cannot read " + g_fixturePath).c_str());

  JsonDocument doc;
  // Fixtures wrap the program in ~4 extra levels; raise the nesting limit.
  DeserializationError derr =
      deserializeJson(doc, text, DeserializationOption::NestingLimit(96));
  TEST_ASSERT_FALSE_MESSAGE(derr, "fixture is not valid JSON");

  // Build the mock from the fixture's scripted inputs.
  MockHal hal;
  for (JsonPairConst kv : doc["sensors"].as<JsonObjectConst>()) {
    auto& profile = hal.sensors[kv.key().c_str()];
    for (JsonArrayConst step : kv.value().as<JsonArrayConst>()) {
      profile.emplace_back(step[0].as<uint32_t>(), step[1].as<float>());
    }
  }
  for (JsonVariantConst v : doc["random"].as<JsonArrayConst>()) {
    hal.randomSeq.push_back(v.as<long>());
  }
  std::vector<uint32_t> buttons;
  for (JsonVariantConst v : doc["buttons"].as<JsonArrayConst>()) {
    buttons.push_back(v.as<uint32_t>());
  }
  uint32_t tickMs = doc["tick_ms"].as<uint32_t>();
  uint32_t runMs = doc["run_ms"].as<uint32_t>();
  TEST_ASSERT_TRUE_MESSAGE(tickMs > 0, "fixture tick_ms must be > 0");

  // The VM consumes JSON text, exactly like POST /api/behavior on-device.
  std::string programJson;
  serializeJson(doc["program"], programJson);

  Vm vm;
  bool ok = vm.load(programJson.c_str(), programJson.size(), &hal);
  TEST_ASSERT_TRUE_MESSAGE(ok, vm.error());

  // Harness procedure per fixtures/README.md: start(0), then ticks at
  // tick_ms..run_ms inclusive; button presses land before their tick.
  hal.nowMs = 0;
  vm.start(0);
  for (uint32_t t = tickMs; t <= runMs; t += tickMs) {
    hal.nowMs = t;
    for (uint32_t b : buttons) {
      if (b == t) vm.onButton(t);
    }
    vm.tick(t);
  }

  // Exact trace comparison.
  JsonArrayConst expected = doc["expected"].as<JsonArrayConst>();
  size_t i = 0;
  for (JsonVariantConst line : expected) {
    if (i >= hal.trace.size()) {
      char msg[256];
      snprintf(msg, sizeof(msg), "trace too short: missing line %zu: \"%s\"", i,
               line.as<const char*>());
      TEST_FAIL_MESSAGE(msg);
    }
    if (hal.trace[i] != line.as<const char*>()) {
      char msg[256];
      snprintf(msg, sizeof(msg), "trace line %zu: expected \"%s\" got \"%s\"", i,
               line.as<const char*>(), hal.trace[i].c_str());
      TEST_FAIL_MESSAGE(msg);
    }
    i++;
  }
  if (i < hal.trace.size()) {
    char msg[256];
    snprintf(msg, sizeof(msg), "trace too long: unexpected line %zu: \"%s\"", i,
             hal.trace[i].c_str());
    TEST_FAIL_MESSAGE(msg);
  }

  // Error expectations.
  const char* expectError = doc["expect_error"].as<const char*>();
  if (expectError != nullptr) {
    TEST_ASSERT_EQUAL_STRING(expectError, vm.error());
    TEST_ASSERT_FALSE_MESSAGE(vm.running(), "vm should have halted");
  } else {
    TEST_ASSERT_EQUAL_STRING("", vm.error());
  }
}

// A few C++-side unit checks beyond the shared fixtures.

static void test_load_rejects_garbage(void) {
  MockHal hal;
  Vm vm;
  const char* bad = "{\"bsj\":2,\"handlers\":[]}";
  TEST_ASSERT_FALSE(vm.load(bad, strlen(bad), &hal));
  TEST_ASSERT_EQUAL_STRING("unsupported bsj version", vm.error());
  const char* notJson = "hello";
  TEST_ASSERT_FALSE(vm.load(notJson, strlen(notJson), &hal));
  const char* unknownOp =
      "{\"bsj\":1,\"handlers\":[{\"event\":{\"type\":\"on_start\"},"
      "\"body\":[{\"op\":\"fly\"}]}]}";
  TEST_ASSERT_FALSE(vm.load(unknownOp, strlen(unknownOp), &hal));
  TEST_ASSERT_EQUAL_STRING("unknown op", vm.error());
  const char* undeclared =
      "{\"bsj\":1,\"handlers\":[{\"event\":{\"type\":\"on_start\"},"
      "\"body\":[{\"op\":\"set_var\",\"name\":\"ghost\",\"value\":1}]}]}";
  TEST_ASSERT_FALSE(vm.load(undeclared, strlen(undeclared), &hal));
  TEST_ASSERT_EQUAL_STRING("undeclared variable", vm.error());
}

static void test_stop_halts_and_stops_motors(void) {
  MockHal hal;
  Vm vm;
  const char* prog =
      "{\"bsj\":1,\"handlers\":[{\"event\":{\"type\":\"on_start\"},"
      "\"body\":[{\"op\":\"wait\",\"ms\":1000}]}]}";
  TEST_ASSERT_TRUE(vm.load(prog, strlen(prog), &hal));
  vm.start(0);
  TEST_ASSERT_TRUE(vm.running());
  vm.stop();
  vm.stop(); // idempotent
  TEST_ASSERT_FALSE(vm.running());
  TEST_ASSERT_EQUAL_INT(1, (int)hal.trace.size());
  TEST_ASSERT_EQUAL_STRING("0 drive 0 0", hal.trace[0].c_str());
}

void setUp(void) {}
void tearDown(void) {}

int main(int argc, char** argv) {
  (void)argc;
  (void)argv;
  UNITY_BEGIN();

  RUN_TEST(test_load_rejects_garbage);
  RUN_TEST(test_stop_halts_and_stops_motors);

  g_fixturesDir = resolveFixturesDir();
  if (g_fixturesDir.empty()) {
    UnityDefaultTestRun(
        [] {
          TEST_FAIL_MESSAGE(
              "fixtures not found: set BSJ_FIXTURES or run from the repo root "
              "(expected packages/behavior-ts/fixtures/index.json)");
        },
        "fixtures_located", __LINE__);
    return UNITY_END();
  }

  std::string indexText;
  readFile(g_fixturesDir + "/index.json", indexText);
  JsonDocument index;
  deserializeJson(index, indexText);
  std::vector<std::string> names; // keep Unity's name pointers alive
  for (JsonVariantConst v : index.as<JsonArrayConst>()) {
    names.push_back(v.as<const char*>());
  }
  for (const auto& name : names) {
    g_fixturePath = g_fixturesDir + "/" + name;
    UnityDefaultTestRun(run_fixture, name.c_str(), __LINE__);
  }

  return UNITY_END();
}
