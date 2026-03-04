#!/usr/bin/env bash
# Feature: kiro-pixel-agents-bridge, Property 2: Session ID round-trip persistence
#
# For any UUID v4 string written to the .kiro-session file, subsequent invocations
# of get_or_create_session() SHALL return the exact same string, and the JSONL file
# SHALL be named {that-string}.jsonl.
#
# Also tests that when no .kiro-session exists, a new UUID is generated and persisted.
#
# Validates: Requirements 2.2, 2.3

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

generate_uuid() {
  uuidgen | tr '[:upper:]' '[:lower:]'
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


# ── Test 1: Pre-written session ID round-trip ($ITERATIONS iterations) ──
# Generate a UUID, write it to .kiro-session, invoke init, assert the returned
# session ID matches and the JSONL filename matches.

echo "=== Test 1: Pre-written session ID round-trip ($ITERATIONS iterations) ==="

for i in $(seq 1 $ITERATIONS); do
  setup_temp_env

  PROJECT_DIR=$(get_project_dir)
  mkdir -p "$PROJECT_DIR"

  # Generate a UUID and write it to .kiro-session
  EXPECTED_SID=$(generate_uuid)
  echo "$EXPECTED_SID" > "$PROJECT_DIR/.kiro-session"

  # Invoke bridge with init event
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1

  # Assert .kiro-session still contains the same UUID
  ACTUAL_SID=$(cat "$PROJECT_DIR/.kiro-session")
  if ! assert_eq "iter $i: session ID preserved in .kiro-session" "$EXPECTED_SID" "$ACTUAL_SID"; then
    teardown_temp_env
    continue
  fi

  # Assert the JSONL file is named {session-id}.jsonl
  EXPECTED_JSONL="$PROJECT_DIR/${EXPECTED_SID}.jsonl"
  if [[ ! -f "$EXPECTED_JSONL" ]]; then
    echo "FAIL: iter $i: JSONL file not found at expected path"
    echo "  expected: $EXPECTED_JSONL"
    # Show what files exist
    echo "  files in project dir: $(ls "$PROJECT_DIR")"
    FAIL=$((FAIL + 1))
    teardown_temp_env
    continue
  fi

  # Assert no other .jsonl files exist (only the expected one)
  jsonl_count=$(find "$PROJECT_DIR" -maxdepth 1 -name "*.jsonl" -type f | wc -l | tr -d ' ')
  if ! assert_eq "iter $i: exactly one JSONL file" "1" "$jsonl_count"; then
    teardown_temp_env
    continue
  fi

  # Invoke init again — session should still be the same
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1

  ACTUAL_SID_2=$(cat "$PROJECT_DIR/.kiro-session")
  if ! assert_eq "iter $i: session ID stable across invocations" "$EXPECTED_SID" "$ACTUAL_SID_2"; then
    teardown_temp_env
    continue
  fi

  # Still only one JSONL file (same session)
  jsonl_count_2=$(find "$PROJECT_DIR" -maxdepth 1 -name "*.jsonl" -type f | wc -l | tr -d ' ')
  if ! assert_eq "iter $i: still one JSONL file after second init" "1" "$jsonl_count_2"; then
    teardown_temp_env
    continue
  fi

  PASS=$((PASS + 1))
  teardown_temp_env
done

echo "Test 1: $PASS passed, $FAIL failed"


# ── Test 2: No .kiro-session — new UUID generated and persisted ($ITERATIONS iterations) ──
# When no .kiro-session exists, the bridge should generate a new UUID, persist it,
# and use it as the JSONL filename.

echo ""
echo "=== Test 2: New session creation when no .kiro-session exists ($ITERATIONS iterations) ==="

PASS2=0
FAIL2=0

for i in $(seq 1 $ITERATIONS); do
  setup_temp_env

  PROJECT_DIR=$(get_project_dir)
  # Do NOT create .kiro-session — let the bridge create it

  # Invoke bridge with init event
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1

  # Assert .kiro-session was created
  SESSION_FILE="$PROJECT_DIR/.kiro-session"
  if [[ ! -f "$SESSION_FILE" ]]; then
    echo "FAIL: iter $i: .kiro-session not created"
    FAIL2=$((FAIL2 + 1))
    teardown_temp_env
    continue
  fi

  # Read the generated session ID
  GENERATED_SID=$(cat "$SESSION_FILE")

  # Assert it looks like a UUID (lowercase, with hyphens)
  if ! echo "$GENERATED_SID" | grep -qE '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'; then
    echo "FAIL: iter $i: generated session ID is not a valid UUID: $GENERATED_SID"
    FAIL2=$((FAIL2 + 1))
    teardown_temp_env
    continue
  fi

  # Assert the JSONL file matches the generated session ID
  EXPECTED_JSONL="$PROJECT_DIR/${GENERATED_SID}.jsonl"
  if [[ ! -f "$EXPECTED_JSONL" ]]; then
    echo "FAIL: iter $i: JSONL file not found at $EXPECTED_JSONL"
    FAIL2=$((FAIL2 + 1))
    teardown_temp_env
    continue
  fi

  # Invoke init again — should reuse the same session
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1

  REREAD_SID=$(cat "$SESSION_FILE")
  if ! assert_eq "iter $i: session ID stable on re-invocation" "$GENERATED_SID" "$REREAD_SID"; then
    FAIL2=$((FAIL2 + 1))
    teardown_temp_env
    continue
  fi

  PASS2=$((PASS2 + 1))
  teardown_temp_env
done

echo "Test 2: $PASS2 passed, $FAIL2 failed"


# ── Test 3: Session ID used in JSONL filename for tool events ($ITERATIONS iterations) ──
# Write a session ID, then invoke tool-start and tool-done. Assert all JSONL records
# land in the file named after the session ID.

echo ""
echo "=== Test 3: Session ID in JSONL filename across event types ($ITERATIONS iterations) ==="

PASS3=0
FAIL3=0

TOOL_NAMES=("readFile" "editCode" "fsWrite" "executeBash" "grepSearch" "invokeSubAgent")

for i in $(seq 1 $ITERATIONS); do
  setup_temp_env

  PROJECT_DIR=$(get_project_dir)
  mkdir -p "$PROJECT_DIR"

  # Pre-write a session ID
  EXPECTED_SID=$(generate_uuid)
  echo "$EXPECTED_SID" > "$PROJECT_DIR/.kiro-session"

  EXPECTED_JSONL="$PROJECT_DIR/${EXPECTED_SID}.jsonl"

  # Pick a tool name
  idx=$(( (i - 1) % ${#TOOL_NAMES[@]} ))
  TOOL="${TOOL_NAMES[$idx]}"

  # Run a full event sequence: init → tool-start → tool-done → agent-stop
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" tool-start "$TOOL") > /dev/null 2>&1
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" tool-done "$TOOL") > /dev/null 2>&1
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" agent-stop) > /dev/null 2>&1

  # Assert all records are in the expected JSONL file
  if [[ ! -f "$EXPECTED_JSONL" ]]; then
    echo "FAIL: iter $i: JSONL file not found at $EXPECTED_JSONL"
    FAIL3=$((FAIL3 + 1))
    teardown_temp_env
    continue
  fi

  # Should have exactly 4 lines (init, tool-start, tool-done, agent-stop)
  line_count=$(wc -l < "$EXPECTED_JSONL" | tr -d ' ')
  if ! assert_eq "iter $i: JSONL has 4 records" "4" "$line_count"; then
    FAIL3=$((FAIL3 + 1))
    teardown_temp_env
    continue
  fi

  # No other JSONL files should exist
  jsonl_count=$(find "$PROJECT_DIR" -maxdepth 1 -name "*.jsonl" -type f | wc -l | tr -d ' ')
  if ! assert_eq "iter $i: only one JSONL file" "1" "$jsonl_count"; then
    FAIL3=$((FAIL3 + 1))
    teardown_temp_env
    continue
  fi

  PASS3=$((PASS3 + 1))
  teardown_temp_env
done

echo "Test 3: $PASS3 passed, $FAIL3 failed"


# ── Summary ──

echo ""
echo "=== Summary ==="
TOTAL_PASS=$((PASS + PASS2 + PASS3))
TOTAL_FAIL=$((FAIL + FAIL2 + FAIL3))
TOTAL=$((TOTAL_PASS + TOTAL_FAIL))
echo "Total: $TOTAL_PASS/$TOTAL passed"

if [[ $TOTAL_FAIL -gt 0 ]]; then
  echo "FAILED"
  exit 1
fi

echo "ALL PASSED"
exit 0
