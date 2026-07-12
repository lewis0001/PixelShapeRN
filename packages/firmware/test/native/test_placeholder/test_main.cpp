/**
 * botforge firmware — Phase-0 native Unity test.
 * Proves the native test environment works: one sanity assertion and one
 * test of the vmcore clamp100() helper.
 *
 * Run with: pio test -e native
 */
#include <unity.h>

#include "clamp.h"

void setUp(void) {
  // Required by Unity; nothing to set up yet.
}

void tearDown(void) {
  // Required by Unity; nothing to tear down yet.
}

static void test_math_sanity(void) {
  TEST_ASSERT_EQUAL_INT(4, 2 + 2);
}

static void test_clamp100_clamps_both_ends(void) {
  TEST_ASSERT_EQUAL_INT(-100, clamp100(-150));
  TEST_ASSERT_EQUAL_INT(100, clamp100(150));
  // Values inside the range pass through untouched, including the edges.
  TEST_ASSERT_EQUAL_INT(0, clamp100(0));
  TEST_ASSERT_EQUAL_INT(-100, clamp100(-100));
  TEST_ASSERT_EQUAL_INT(100, clamp100(100));
  TEST_ASSERT_EQUAL_INT(42, clamp100(42));
}

int main(int argc, char **argv) {
  (void)argc;
  (void)argv;
  UNITY_BEGIN();
  RUN_TEST(test_math_sanity);
  RUN_TEST(test_clamp100_clamps_both_ends);
  return UNITY_END();
}
