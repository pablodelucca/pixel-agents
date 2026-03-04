#!/usr/bin/env bash
# Feature: kiro-pixel-agents-bridge, Property 9: Bridge script completes without stdin
#
# For any invocation of the bridge script (regardless of stdin state), the script
# SHALL complete execution immediately without attempting to read from stdin,
# because stdin reading has been removed.
#
# This test invokes the bridge script for all event types with no stdin pipe,
# verifying it completes within 2 seconds and exits 0.
#
# Validates: Requirements 9.1, 9.4

set -euo pipefail

BRIDGE_SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/pixel-agents-bridge.sh"
PASS=0
FAIL=0
ITERATIONS=100
TIMEOUT_SECS=2

EVENT_TYPES=("init" "tool-start" "tool-done" "agent-stop" "reset")
TOOL_NAMES=("readFile" "editCode" "fsWrite" "executeBash" "grepSearch" "invokeSubAgent" "readCode" "strReplace" "deleteFile" "webFetch" "unknown")

# ── Helpers ──

setup_temp_env() {
  export TEST_TMPDIR
  TEST_TMPDIR=$(mktemp -d)
  export HOME="$TEST_TMPDIR/home"
  mkdir -p "$HOME"
  export PWD="$TEST_TMPDIR/workspace"
  mkdir -p "$PWD"
}

teardown_temp_env() {
  rm -rf "$TEST_TMPDIR"
}

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: $desc"
    echo "  expected: $expected"
    echo "  actual:   $actual"
    FAIL=$((FAIL + 1))
    return 1
  fi
  return 0
}

# Run a command with a timeout, return 0 if it completed in time, 1 if it timed out
run_with_timeout() {
  local timeout="$1"
  shift
  # Use the timeout command (coreutils on Linux, built-in on macOS via gtimeout or bash)
  # Fall back to a background-process approach for portability
  "$@" &
  local pid=$!
  (
    sleep "$timeout"
    kill "$pid" 2>/dev/null
  ) &
  local watchdog=$!
  wait "$pid" 2>/dev/null
  local exit_code=$?
  # Kill the watchdog if the process finished before timeout
  kill "$watchdog" 2>/dev/null
  wait "$watchdog" 2>/dev/null || true
  return $exit_code
}

# ── Test 1: All event types complete without hanging ($ITERATIONS iterations) ──
# Each iteration picks an event type and verifies the script completes within
# TIMEOUT_SECS with exit code 0, with NO stdin piped.

echo "=== Test 1: All event types complete without stdin ($ITERATIONS iterations) ==="

for i in $(seq 1 $ITERATIONS); do
  setup_temp_env

  # Cycle through event types
  evt_idx=$(( (i - 1) % ${#EVENT_TYPES[@]} ))
  EVENT="${EVENT_TYPES[$evt_idx]}"

  # Pick a tool name for tool-start/tool-done events
  tool_idx=$(( (i - 1) % ${#TOOL_NAMES[@]} ))
  TOOL="${TOOL_NAMES[$tool_idx]}"

  # For tool-done to work, we need a prior tool-start to create a tracker.
  # For init/agent-stop/reset, no setup needed.
  if [[ "$EVENT" == "tool-done" ]]; then
    # Create a tracker so tool-done has something to find (tests the non-hanging path)
    (cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1
    (cd "$PWD" && bash "$BRIDGE_SCRIPT" tool-start "$TOOL") > /dev/null 2>&1
  elif [[ "$EVENT" == "agent-stop" ]]; then
    # Init first so the JSONL file exists
    (cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1
  fi

  # Build the command args
  ARGS=("$EVENT")
  if [[ "$EVENT" == "tool-start" || "$EVENT" == "tool-done" ]]; then
    ARGS+=("$TOOL")
  fi

  # Run with timeout and NO stdin (redirect from /dev/null to ensure no stdin)
  START_TIME=$(date +%s)
  run_with_timeout "$TIMEOUT_SECS" bash -c "cd \"$PWD\" && bash \"$BRIDGE_SCRIPT\" ${ARGS[*]}" < /dev/null > /dev/null 2>&1
  exit_code=$?
  END_TIME=$(date +%s)

  elapsed=$((END_TIME - START_TIME))

  # Verify exit code is 0
  if ! assert_eq "iter $i ($EVENT): exit code" "0" "$exit_code"; then
    teardown_temp_env
    continue
  fi

  # Verify it completed within the timeout
  if [[ $elapsed -ge $TIMEOUT_SECS ]]; then
    echo "FAIL: iter $i ($EVENT): took ${elapsed}s (>= ${TIMEOUT_SECS}s timeout)"
    FAIL=$((FAIL + 1))
    teardown_temp_env
    continue
  fi

  PASS=$((PASS + 1))
  teardown_temp_env
done

echo "Test 1: $PASS passed, $FAIL failed"


# ── Test 2: Rapid sequential calls without stdin ($ITERATIONS iterations) ──
# Simulates a realistic sequence: init → tool-start → tool-done → agent-stop
# All within a single temp env per iteration, verifying none hang.

echo ""
echo "=== Test 2: Rapid sequential event sequences without stdin ($ITERATIONS iterations) ==="

PASS2=0
FAIL2=0

for i in $(seq 1 $ITERATIONS); do
  setup_temp_env

  tool_idx=$(( (i - 1) % ${#TOOL_NAMES[@]} ))
  TOOL="${TOOL_NAMES[$tool_idx]}"

  iter_ok=true

  for EVENT in init "tool-start $TOOL" "tool-done $TOOL" agent-stop; do
    # shellcheck disable=SC2086
    run_with_timeout "$TIMEOUT_SECS" bash -c "cd \"$PWD\" && bash \"$BRIDGE_SCRIPT\" $EVENT" < /dev/null > /dev/null 2>&1
    exit_code=$?

    if [[ "$exit_code" -ne 0 ]]; then
      echo "FAIL: iter $i ($EVENT): exit code $exit_code"
      iter_ok=false
      break
    fi
  done

  if [[ "$iter_ok" == "true" ]]; then
    PASS2=$((PASS2 + 1))
  else
    FAIL2=$((FAIL2 + 1))
  fi

  teardown_temp_env
done

echo "Test 2: $PASS2 passed, $FAIL2 failed"


# ── Summary ──

echo ""
echo "=== Summary ==="
TOTAL_PASS=$((PASS + PASS2))
TOTAL_FAIL=$((FAIL + FAIL2))
TOTAL=$((TOTAL_PASS + TOTAL_FAIL))
echo "Total: $TOTAL_PASS/$TOTAL passed"

if [[ $TOTAL_FAIL -gt 0 ]]; then
  echo "FAILED"
  exit 1
fi

echo "ALL PASSED"
exit 0
