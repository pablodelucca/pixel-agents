#!/usr/bin/env bash
# Feature: kiro-pixel-agents-bridge, Property 13: Reset produces new session
#
# For any existing session, invoking reset followed by init SHALL produce a
# Session_ID different from the original, resulting in a new JSONL file name.
#
# Validates: Requirements 14.4

set -euo pipefail

BRIDGE_SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/pixel-agents-bridge.sh"
PASS=0
FAIL=0
ITERATIONS=100

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

get_project_dir() {
  local dir_name
  dir_name=$(echo "$PWD" | sed 's/[^a-zA-Z0-9-]/-/g')
  echo "$HOME/.claude/projects/$dir_name"
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

assert_neq() {
  local desc="$1" not_expected="$2" actual="$3"
  if [[ "$not_expected" == "$actual" ]]; then
    echo "FAIL: $desc"
    echo "  should differ from: $not_expected"
    echo "  actual:             $actual"
    FAIL=$((FAIL + 1))
    return 1
  fi
  return 0
}


# ── Test 1: Reset produces new session ID ($ITERATIONS iterations) ──
# Run init to create a session, record the session ID, run reset, run init again,
# assert new session ID differs from original and a new JSONL file exists.

echo "=== Test 1: Reset produces new session ($ITERATIONS iterations) ==="

for i in $(seq 1 $ITERATIONS); do
  setup_temp_env

  PROJECT_DIR=$(get_project_dir)

  # Step 1: Run init to create a session
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1

  SESSION_FILE="$PROJECT_DIR/.kiro-session"
  if [[ ! -f "$SESSION_FILE" ]]; then
    echo "FAIL: iter $i: .kiro-session not created after init"
    FAIL=$((FAIL + 1))
    teardown_temp_env
    continue
  fi

  # Record the original session ID
  ORIGINAL_SID=$(cat "$SESSION_FILE")
  ORIGINAL_JSONL="$PROJECT_DIR/${ORIGINAL_SID}.jsonl"

  if [[ ! -f "$ORIGINAL_JSONL" ]]; then
    echo "FAIL: iter $i: original JSONL file not found at $ORIGINAL_JSONL"
    FAIL=$((FAIL + 1))
    teardown_temp_env
    continue
  fi

  # Step 2: Run reset to delete the session
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" reset) > /dev/null 2>&1

  # Verify .kiro-session was deleted
  if [[ -f "$SESSION_FILE" ]]; then
    echo "FAIL: iter $i: .kiro-session still exists after reset"
    FAIL=$((FAIL + 1))
    teardown_temp_env
    continue
  fi

  # Step 3: Run init again to create a new session
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1

  if [[ ! -f "$SESSION_FILE" ]]; then
    echo "FAIL: iter $i: .kiro-session not created after second init"
    FAIL=$((FAIL + 1))
    teardown_temp_env
    continue
  fi

  # Step 4: Assert new session ID differs from original
  NEW_SID=$(cat "$SESSION_FILE")

  if ! assert_neq "iter $i: new session ID differs from original" "$ORIGINAL_SID" "$NEW_SID"; then
    teardown_temp_env
    continue
  fi

  # Step 5: Assert a new JSONL file exists with the new session ID name
  NEW_JSONL="$PROJECT_DIR/${NEW_SID}.jsonl"
  if [[ ! -f "$NEW_JSONL" ]]; then
    echo "FAIL: iter $i: new JSONL file not found at $NEW_JSONL"
    FAIL=$((FAIL + 1))
    teardown_temp_env
    continue
  fi

  # Verify the new JSONL file is different from the original
  if [[ "$ORIGINAL_JSONL" == "$NEW_JSONL" ]]; then
    echo "FAIL: iter $i: new JSONL path is same as original"
    FAIL=$((FAIL + 1))
    teardown_temp_env
    continue
  fi

  PASS=$((PASS + 1))
  teardown_temp_env
done

echo "Test 1: $PASS passed, $FAIL failed"


# ── Test 2: Reset cleans tool trackers before new session ($ITERATIONS iterations) ──
# Create a session with active tool trackers, reset, init again, verify
# tool tracker dir is clean and new session is different.

echo ""
echo "=== Test 2: Reset cleans tool trackers before new session ($ITERATIONS iterations) ==="

PASS2=0
FAIL2=0

TOOL_NAMES=("readFile" "editCode" "fsWrite" "executeBash" "grepSearch")

for i in $(seq 1 $ITERATIONS); do
  setup_temp_env

  PROJECT_DIR=$(get_project_dir)

  # Init and start some tools (leave them unfinished)
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1

  ORIGINAL_SID=$(cat "$PROJECT_DIR/.kiro-session")
  TRACKER_DIR="$PROJECT_DIR/.kiro-tools"

  # Start 1-3 tools without finishing them
  tool_count=$(( (i % 3) + 1 ))
  for t in $(seq 1 $tool_count); do
    idx=$(( (t - 1) % ${#TOOL_NAMES[@]} ))
    (cd "$PWD" && bash "$BRIDGE_SCRIPT" tool-start "${TOOL_NAMES[$idx]}") > /dev/null 2>&1
  done

  # Verify tracker files exist
  tracker_before=$(find "$TRACKER_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')
  if [[ "$tracker_before" -lt 1 ]]; then
    echo "FAIL: iter $i: no tracker files created"
    FAIL2=$((FAIL2 + 1))
    teardown_temp_env
    continue
  fi

  # Reset
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" reset) > /dev/null 2>&1

  # Verify tool trackers are cleaned
  tracker_after=$(find "$TRACKER_DIR" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')
  if ! assert_eq "iter $i: tool trackers cleaned after reset" "0" "$tracker_after"; then
    FAIL2=$((FAIL2 + 1))
    teardown_temp_env
    continue
  fi

  # Init again
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1

  NEW_SID=$(cat "$PROJECT_DIR/.kiro-session")

  # New session must differ
  if ! assert_neq "iter $i: new session differs after reset with trackers" "$ORIGINAL_SID" "$NEW_SID"; then
    FAIL2=$((FAIL2 + 1))
    teardown_temp_env
    continue
  fi

  # New JSONL file must exist
  NEW_JSONL="$PROJECT_DIR/${NEW_SID}.jsonl"
  if [[ ! -f "$NEW_JSONL" ]]; then
    echo "FAIL: iter $i: new JSONL file not found at $NEW_JSONL"
    FAIL2=$((FAIL2 + 1))
    teardown_temp_env
    continue
  fi

  PASS2=$((PASS2 + 1))
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
