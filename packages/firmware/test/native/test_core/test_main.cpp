/**
 * botforge firmware — native Unity tests for the Phase-2 core pure logic:
 *
 *   - cfg_hash / SHA-256 against FIPS 180-4 vectors
 *   - RingLog 128-line ring buffer (wraparound, sink)
 *   - DeadmanTimer (§5.4 manual-mode safety, incl. millis() wraparound)
 *   - SlewLimiter (motor brownout prevention)
 *   - BootButton (short press = on_button, 5 s hold = wifi wipe)
 *   - Hostname helpers (§5.4 Botforge-XXXX / mDNS names)
 *   - versionLess (OTA check-on-boot comparison)
 *   - Config parse of the REAL rover config.json content (§5.5), embedded
 *     below as a string literal, plus wifi.json handling
 *
 * Run with: pio test -d packages/firmware -e native
 */
#include <unity.h>

#include <cstring>
#include <string>

#include "../../../src/core/BootButton.h"
#include "../../../src/core/Config.h"
#include "../../../src/core/DeadmanTimer.h"
#include "../../../src/core/Hostname.h"
#include "../../../src/core/Log.h"
#include "../../../src/core/Sha256.h"
#include "../../../src/core/SlewLimiter.h"
#include "../../../src/core/Version.h"

using namespace botforge;

void setUp(void) {}
void tearDown(void) {}

// ---------------------------------------------------------------------------
// SHA-256 / cfg_hash
// ---------------------------------------------------------------------------

static void test_sha256_known_vectors(void) {
  char hex[65];

  sha256Hex("abc", 3, hex);
  TEST_ASSERT_EQUAL_STRING(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", hex);

  sha256Hex("", 0, hex);
  TEST_ASSERT_EQUAL_STRING(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", hex);

  // Two-block message (FIPS 180-4 example).
  const char* msg = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
  sha256Hex(msg, strlen(msg), hex);
  TEST_ASSERT_EQUAL_STRING(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1", hex);
}

static void test_sha256_incremental_matches_oneshot(void) {
  // Chunked update() must equal the one-shot hash (exercises buffering
  // across the 64-byte block boundary).
  const char* msg = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
  size_t len = strlen(msg);

  uint8_t oneshot[32];
  sha256(msg, len, oneshot);

  Sha256 h;
  h.update(msg, 10);
  h.update(msg + 10, 30);
  h.update(msg + 40, len - 40);
  uint8_t chunked[32];
  h.finish(chunked);

  TEST_ASSERT_EQUAL_MEMORY(oneshot, chunked, 32);
}

static void test_cfg_hash_is_first_8_hex_chars(void) {
  char h8[9];
  cfgHash8("abc", 3, h8);
  TEST_ASSERT_EQUAL_STRING("ba7816bf", h8);  // §5.5: first 8 of sha256
}

// ---------------------------------------------------------------------------
// RingLog
// ---------------------------------------------------------------------------

static void test_ringlog_basic_order(void) {
  RingLog log;
  TEST_ASSERT_EQUAL_UINT32(0, (uint32_t)log.size());
  log.add(LOG_INFO, 10, "first");
  log.add(LOG_WARN, 20, "second");
  log.add(LOG_ERROR, 30, "third");
  TEST_ASSERT_EQUAL_UINT32(3, (uint32_t)log.size());
  TEST_ASSERT_EQUAL_STRING("first", log.text(0));
  TEST_ASSERT_EQUAL_STRING("third", log.text(2));
  TEST_ASSERT_EQUAL_INT(LOG_WARN, log.level(1));
  TEST_ASSERT_EQUAL_UINT32(20, log.timeMs(1));
}

static void test_ringlog_wraparound(void) {
  RingLog log;
  // 200 lines through a 128-line ring: lines 0..71 are evicted.
  for (int i = 0; i < 200; ++i) {
    log.addf(LOG_INFO, (uint32_t)i, "msg %d", i);
  }
  TEST_ASSERT_EQUAL_UINT32(RingLog::kLines, (uint32_t)log.size());
  TEST_ASSERT_EQUAL_UINT32(200, (uint32_t)log.totalAdded());
  TEST_ASSERT_EQUAL_STRING("msg 72", log.text(0));    // oldest retained
  TEST_ASSERT_EQUAL_STRING("msg 199", log.text(127)); // newest
  TEST_ASSERT_EQUAL_UINT32(72, log.timeMs(0));
}

static void test_ringlog_truncates_long_lines(void) {
  RingLog log;
  char big[300];
  memset(big, 'x', sizeof(big) - 1);
  big[sizeof(big) - 1] = '\0';
  log.add(LOG_INFO, 0, big);
  TEST_ASSERT_EQUAL_UINT32(RingLog::kLineLen - 1, (uint32_t)strlen(log.text(0)));
}

struct SinkCapture {
  int calls = 0;
  LogLevel lastLevel = LOG_DEBUG;
  std::string lastMsg;
};

static void sinkFn(void* ctx, LogLevel level, uint32_t ms, const char* msg) {
  (void)ms;
  SinkCapture* cap = static_cast<SinkCapture*>(ctx);
  cap->calls++;
  cap->lastLevel = level;
  cap->lastMsg = msg;
}

static void test_ringlog_sink_receives_lines(void) {
  RingLog log;
  SinkCapture cap;
  log.setSink(sinkFn, &cap);
  log.add(LOG_ERROR, 5, "boom");
  TEST_ASSERT_EQUAL_INT(1, cap.calls);
  TEST_ASSERT_EQUAL_INT(LOG_ERROR, cap.lastLevel);
  TEST_ASSERT_EQUAL_STRING("boom", cap.lastMsg.c_str());
}

// ---------------------------------------------------------------------------
// DeadmanTimer (§5.4: manual mode, 800 ms)
// ---------------------------------------------------------------------------

static void test_deadman_disarmed_never_trips(void) {
  DeadmanTimer dm;
  TEST_ASSERT_FALSE(dm.shouldTrip(100000));
  TEST_ASSERT_FALSE(dm.expired(100000));
}

static void test_deadman_trips_once_at_timeout(void) {
  DeadmanTimer dm;  // default 800 ms
  dm.arm(1000);
  TEST_ASSERT_FALSE(dm.shouldTrip(1799));  // 799 ms: not yet
  TEST_ASSERT_TRUE(dm.shouldTrip(1800));   // exactly 800 ms: trip
  TEST_ASSERT_FALSE(dm.shouldTrip(1801));  // edge-triggered: only once
  TEST_ASSERT_TRUE(dm.expired(1801));      // level view stays true
}

static void test_deadman_feed_resets_window(void) {
  DeadmanTimer dm;
  dm.arm(0);
  TEST_ASSERT_FALSE(dm.shouldTrip(700));
  dm.feed(700);  // cmd.drive arrived
  TEST_ASSERT_FALSE(dm.shouldTrip(1400));  // 700 ms since feed
  TEST_ASSERT_TRUE(dm.shouldTrip(1500));   // 800 ms since feed
  dm.feed(1600);  // link recovered: re-opens the window
  TEST_ASSERT_FALSE(dm.shouldTrip(2000));
  TEST_ASSERT_TRUE(dm.shouldTrip(2400));
}

static void test_deadman_disarm_stops_tripping(void) {
  DeadmanTimer dm;
  dm.arm(0);
  dm.disarm();  // switched to behavior mode (P8)
  TEST_ASSERT_FALSE(dm.shouldTrip(5000));
}

static void test_deadman_survives_millis_wraparound(void) {
  DeadmanTimer dm;
  dm.arm(0xFFFFFF00u);          // ~256 ms before uint32 wrap
  TEST_ASSERT_FALSE(dm.shouldTrip(0xFFFFFFF0u));  // 240 ms elapsed
  TEST_ASSERT_FALSE(dm.shouldTrip(0x00000100u));  // 512 ms elapsed (wrapped)
  TEST_ASSERT_TRUE(dm.shouldTrip(0x00000230u));   // 816 ms elapsed (wrapped)
}

// ---------------------------------------------------------------------------
// SlewLimiter (drv-8833 slew_per_s = 400 default)
// ---------------------------------------------------------------------------

static void test_slew_ramps_at_configured_rate(void) {
  SlewLimiter slew(400.0f);  // 400 units/s = 40 units per 100 ms
  slew.reset(0.0f);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 40.0f, slew.update(100.0f, 100));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 80.0f, slew.update(100.0f, 100));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 100.0f, slew.update(100.0f, 100));  // clamp
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 100.0f, slew.update(100.0f, 100));  // hold
}

static void test_slew_direction_change_passes_through_zero(void) {
  SlewLimiter slew(400.0f);
  slew.reset(100.0f);
  // Full forward -> full reverse: 200 units at 400/s = 500 ms total.
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, slew.update(-100.0f, 250));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, -100.0f, slew.update(-100.0f, 250));
}

static void test_slew_zero_rate_is_instant(void) {
  SlewLimiter slew(0.0f);
  slew.reset(0.0f);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 100.0f, slew.update(100.0f, 1));
}

static void test_slew_reset_forces_output(void) {
  SlewLimiter slew(400.0f);
  slew.reset(80.0f);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 80.0f, slew.value());
  slew.reset(0.0f);  // hard stop path (deadman)
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, slew.value());
}

static void test_slew_small_dt_accumulates(void) {
  SlewLimiter slew(400.0f);
  slew.reset(0.0f);
  // 10 x 10 ms = 100 ms -> 40 units.
  for (int i = 0; i < 10; ++i) slew.update(100.0f, 10);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 40.0f, slew.value());
}

// ---------------------------------------------------------------------------
// BootButton
// ---------------------------------------------------------------------------

static void test_bootbutton_short_press(void) {
  BootButton btn;  // 5000 ms hold, <1000 ms short, 30 ms debounce
  TEST_ASSERT_EQUAL_INT(BootButton::None, btn.update(true, 1000));
  TEST_ASSERT_EQUAL_INT(BootButton::None, btn.update(true, 1100));
  TEST_ASSERT_EQUAL_INT(BootButton::ShortPress, btn.update(false, 1200));
  TEST_ASSERT_EQUAL_INT(BootButton::None, btn.update(false, 1300));
}

static void test_bootbutton_bounce_ignored(void) {
  BootButton btn;
  btn.update(true, 1000);
  TEST_ASSERT_EQUAL_INT(BootButton::None, btn.update(false, 1010));  // 10 ms
}

static void test_bootbutton_long_hold_fires_while_held(void) {
  BootButton btn;
  TEST_ASSERT_EQUAL_INT(BootButton::None, btn.update(true, 0));
  TEST_ASSERT_EQUAL_INT(BootButton::None, btn.update(true, 4999));
  TEST_ASSERT_EQUAL_INT(BootButton::LongHold, btn.update(true, 5000));
  TEST_ASSERT_EQUAL_INT(BootButton::None, btn.update(true, 6000));   // once
  TEST_ASSERT_EQUAL_INT(BootButton::None, btn.update(false, 7000));  // no short
}

static void test_bootbutton_medium_hold_is_nothing(void) {
  BootButton btn;
  btn.update(true, 0);
  btn.update(true, 2000);
  TEST_ASSERT_EQUAL_INT(BootButton::None, btn.update(false, 2500));
}

// ---------------------------------------------------------------------------
// Hostname helpers
// ---------------------------------------------------------------------------

static void test_default_names_from_mac(void) {
  char ap[14];
  char host[14];
  defaultApSsid(0xAB, 0x3F, ap);
  defaultHostname(0xAB, 0x3F, host);
  TEST_ASSERT_EQUAL_STRING("Botforge-AB3F", ap);
  TEST_ASSERT_EQUAL_STRING("botforge-ab3f", host);
}

static void test_sanitize_hostname(void) {
  char out[kHostnameMax];

  sanitizeHostname("My Robot!", out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("my-robot", out);

  sanitizeHostname("  Rover  #1  ", out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("rover-1", out);

  sanitizeHostname("!!!", out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("botforge", out);  // fallback

  sanitizeHostname("", out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("botforge", out);

  sanitizeHostname("ALLCAPS42", out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("allcaps42", out);
}

// ---------------------------------------------------------------------------
// versionLess (OTA)
// ---------------------------------------------------------------------------

static void test_version_less(void) {
  TEST_ASSERT_TRUE(versionLess("0.2.0", "0.3.0"));
  TEST_ASSERT_TRUE(versionLess("0.2.0", "0.2.1"));
  TEST_ASSERT_TRUE(versionLess("0.9.9", "1.0.0"));
  TEST_ASSERT_TRUE(versionLess("0.2.0", "0.10.0"));  // numeric, not lexical
  TEST_ASSERT_FALSE(versionLess("0.2.0", "0.2.0"));
  TEST_ASSERT_FALSE(versionLess("1.0.0", "0.9.9"));
  TEST_ASSERT_FALSE(versionLess("0.10.0", "0.2.0"));
}

// ---------------------------------------------------------------------------
// Config: the REAL engine-generated rover config (dist/rover-v1/firmware/
// config.json), embedded verbatim (§5.5)
// ---------------------------------------------------------------------------

static const char kRoverConfig[] = R"JSON({
  "cfg": 1,
  "robot_id": "rover-v1",
  "name_default": "Rover",
  "autostart": "avoid",
  "modules": [
    {
      "id": "pwr",
      "driver": "PowerMon",
      "pins": {},
      "params": {
        "vbat_adc": null
      }
    },
    {
      "id": "mdrv",
      "driver": "Motor_DRV8833",
      "pins": {
        "ain1": 4,
        "ain2": 5,
        "bin1": 6,
        "bin2": 7,
        "slp": 15
      },
      "params": {
        "pwm_hz": 20000,
        "slew_per_s": 400
      }
    },
    {
      "id": "range",
      "driver": "Range_VL53L0X",
      "pins": {
        "sda": 8,
        "scl": 9
      },
      "params": {}
    },
    {
      "id": "line",
      "driver": "Line_TCRT",
      "pins": {
        "out_l": 1,
        "out_r": 2
      },
      "params": {}
    },
    {
      "id": "eyes",
      "driver": "Pixel_WS2812",
      "pins": {
        "din": 38
      },
      "params": {
        "count": 2
      }
    },
    {
      "id": "buzz",
      "driver": "Buzzer_PWM",
      "pins": {
        "sig": 16
      },
      "params": {}
    }
  ]
})JSON";

static void test_config_parses_real_rover_config(void) {
  Config cfg;
  TEST_ASSERT_FALSE(cfg.hasConfig());
  TEST_ASSERT_EQUAL_STRING("00000000", cfg.cfgHash());

  TEST_ASSERT_TRUE(cfg.setConfigJson(kRoverConfig, strlen(kRoverConfig)));
  TEST_ASSERT_TRUE(cfg.hasConfig());
  TEST_ASSERT_EQUAL_INT(1, cfg.cfgVersion());
  TEST_ASSERT_EQUAL_STRING("rover-v1", cfg.robotId());
  TEST_ASSERT_EQUAL_STRING("Rover", cfg.nameDefault());
  TEST_ASSERT_EQUAL_STRING("avoid", cfg.autostartId());
  TEST_ASSERT_FALSE(cfg.otaCheckOnBoot());  // flag absent = off
  TEST_ASSERT_EQUAL_UINT32(6, (uint32_t)cfg.moduleCount());
}

static void test_config_module_pins_and_params(void) {
  Config cfg;
  TEST_ASSERT_TRUE(cfg.setConfigJson(kRoverConfig, strlen(kRoverConfig)));

  JsonObjectConst mdrv = cfg.module(1);
  TEST_ASSERT_EQUAL_STRING("mdrv", mdrv["id"] | "");
  TEST_ASSERT_EQUAL_STRING("Motor_DRV8833", mdrv["driver"] | "");
  TEST_ASSERT_EQUAL_INT(4, mdrv["pins"]["ain1"] | -1);
  TEST_ASSERT_EQUAL_INT(7, mdrv["pins"]["bin2"] | -1);
  TEST_ASSERT_EQUAL_INT(15, mdrv["pins"]["slp"] | -1);
  TEST_ASSERT_EQUAL_INT(20000, mdrv["params"]["pwm_hz"] | 0);
  TEST_ASSERT_EQUAL_INT(400, mdrv["params"]["slew_per_s"] | 0);

  JsonObjectConst pwr = cfg.module(0);
  TEST_ASSERT_EQUAL_STRING("PowerMon", pwr["driver"] | "");
  TEST_ASSERT_FALSE(pwr["params"]["vbat_adc"].is<int>());  // null stays null

  JsonObjectConst line = cfg.module(3);
  TEST_ASSERT_EQUAL_INT(1, line["pins"]["out_l"] | -1);  // engine emits out_l
  TEST_ASSERT_EQUAL_INT(2, line["pins"]["out_r"] | -1);

  JsonObjectConst eyes = cfg.module(4);
  TEST_ASSERT_EQUAL_INT(38, eyes["pins"]["din"] | -1);
  TEST_ASSERT_EQUAL_INT(2, eyes["params"]["count"] | 0);
}

static void test_config_cfg_hash_matches_direct_sha256(void) {
  Config cfg;
  TEST_ASSERT_TRUE(cfg.setConfigJson(kRoverConfig, strlen(kRoverConfig)));

  char expected[9];
  cfgHash8(kRoverConfig, strlen(kRoverConfig), expected);
  TEST_ASSERT_EQUAL_STRING(expected, cfg.cfgHash());
  TEST_ASSERT_EQUAL_UINT32(8, (uint32_t)strlen(cfg.cfgHash()));

  // Raw text round-trips byte-for-byte (GET /api/config returns the file).
  TEST_ASSERT_EQUAL_UINT32((uint32_t)strlen(kRoverConfig),
                           (uint32_t)cfg.rawConfigLen());
  TEST_ASSERT_EQUAL_STRING(kRoverConfig, cfg.rawConfig());
}

static void test_config_rejects_bad_json(void) {
  Config cfg;
  const char* garbage = "{\"cfg\": 1, \"modules\": [";
  TEST_ASSERT_FALSE(cfg.setConfigJson(garbage, strlen(garbage)));
  TEST_ASSERT_FALSE(cfg.hasConfig());

  // Valid JSON but not a config (no "cfg" version field).
  const char* foreign = "{\"hello\": \"world\"}";
  TEST_ASSERT_FALSE(cfg.setConfigJson(foreign, strlen(foreign)));
}

static void test_config_wifi_json_and_name_fallback(void) {
  Config cfg;
  TEST_ASSERT_TRUE(cfg.setConfigJson(kRoverConfig, strlen(kRoverConfig)));
  TEST_ASSERT_FALSE(cfg.hasWifi());
  TEST_ASSERT_EQUAL_STRING("Rover", cfg.robotName());  // name_default fallback

  const char* wifi = "{\"ssid\":\"HomeNet\",\"pass\":\"hunter2\",\"name\":\"scout\"}";
  TEST_ASSERT_TRUE(cfg.setWifiJson(wifi, strlen(wifi)));
  TEST_ASSERT_TRUE(cfg.hasWifi());
  TEST_ASSERT_EQUAL_STRING("HomeNet", cfg.wifiSsid());
  TEST_ASSERT_EQUAL_STRING("hunter2", cfg.wifiPass());
  TEST_ASSERT_EQUAL_STRING("scout", cfg.robotName());

  // Provisioned without a name -> falls back to name_default.
  const char* wifiNoName = "{\"ssid\":\"HomeNet\",\"pass\":\"\",\"name\":\"\"}";
  TEST_ASSERT_TRUE(cfg.setWifiJson(wifiNoName, strlen(wifiNoName)));
  TEST_ASSERT_EQUAL_STRING("Rover", cfg.robotName());

  cfg.clearWifi();
  TEST_ASSERT_FALSE(cfg.hasWifi());
}

// ---------------------------------------------------------------------------

int main(int argc, char** argv) {
  (void)argc;
  (void)argv;
  UNITY_BEGIN();

  RUN_TEST(test_sha256_known_vectors);
  RUN_TEST(test_sha256_incremental_matches_oneshot);
  RUN_TEST(test_cfg_hash_is_first_8_hex_chars);

  RUN_TEST(test_ringlog_basic_order);
  RUN_TEST(test_ringlog_wraparound);
  RUN_TEST(test_ringlog_truncates_long_lines);
  RUN_TEST(test_ringlog_sink_receives_lines);

  RUN_TEST(test_deadman_disarmed_never_trips);
  RUN_TEST(test_deadman_trips_once_at_timeout);
  RUN_TEST(test_deadman_feed_resets_window);
  RUN_TEST(test_deadman_disarm_stops_tripping);
  RUN_TEST(test_deadman_survives_millis_wraparound);

  RUN_TEST(test_slew_ramps_at_configured_rate);
  RUN_TEST(test_slew_direction_change_passes_through_zero);
  RUN_TEST(test_slew_zero_rate_is_instant);
  RUN_TEST(test_slew_reset_forces_output);
  RUN_TEST(test_slew_small_dt_accumulates);

  RUN_TEST(test_bootbutton_short_press);
  RUN_TEST(test_bootbutton_bounce_ignored);
  RUN_TEST(test_bootbutton_long_hold_fires_while_held);
  RUN_TEST(test_bootbutton_medium_hold_is_nothing);

  RUN_TEST(test_default_names_from_mac);
  RUN_TEST(test_sanitize_hostname);
  RUN_TEST(test_version_less);

  RUN_TEST(test_config_parses_real_rover_config);
  RUN_TEST(test_config_module_pins_and_params);
  RUN_TEST(test_config_cfg_hash_matches_direct_sha256);
  RUN_TEST(test_config_rejects_bad_json);
  RUN_TEST(test_config_wifi_json_and_name_fallback);

  return UNITY_END();
}
