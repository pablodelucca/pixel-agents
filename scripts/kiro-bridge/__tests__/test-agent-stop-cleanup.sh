#!/usr/bin/env bash
# Feature: kiro-pixel-agents-bridge, Property 14: Agent-stop cleans up all tool trackers
#
# For any set of tool tracker files in .kiro-tools/, invoking agent-stop SHALL
# remove all files from that directory, leaving it empty.
#
# Validates: Requirements 6.2, 14.2

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

get_tracker_dir() {
  echo "$(get_project_dir)/.kiro-tools"
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

# Generate a random tool ID in the same format as the bridge script
random_tool_id() {
  echo "toolu_kiro_$(uuidgen | tr '[:upper:]' '[:lower:]' | tr -d '-' | head -c 24)"
}

TOOL_NAMES=("readFile" "editCode" "fsWrite" "executeBash" "grepSearch" "invokeSubAgent" "readCode" "strReplace" "deleteFile" "webFetch" "unknown" "fileSearch" "listDirectory" "getDiagnostics")


# ── Test 1: agent-stop cleans up tool-start trackers ($ITERATIONS iterations) ──
# Start a random number of tools via tool-start, then run agent-stop,
# assert the .kiro-tools/ directory is empty.

echo "=== Test 1: agent-stop cleans tool-start trackers ($ITERATIONS iterations) ==="

for i in $(seq 1 $ITERATIONS); do
  setup_temp_env

  # Initialize session
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1

  TRACKER_DIR=$(get_tracker_dir)

  # Start a random number of tools (1 to 8)
  tool_count=$(( (RANDOM % 8) + 1 ))
  for _t in $(seq 1 $tool_count); do
    idx=$(( RANDOM % ${#TOOL_NAMES[@]} ))
    (cd "$PWD" && bash "$BRIDGE_SCRIPT" tool-start "${TOOL_NAMES[$idx]}") > /dev/null 2>&1
  done

  # Verify tracker files were created
  tracker_before=$(find "$TRACKER_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')
  if [[ "$tracker_before" -lt 1 ]]; then
    echo "FAIL: iter $i: no tracker files created after $tool_count tool-start calls"
    FAIL=$((FAIL + 1))
    teardown_temp_env
    continue
  fi

  # Run agent-stop
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" agent-stop) > /dev/null 2>&1

  # Assert .kiro-tools/ directory is empty
  tracker_after=$(find "$TRACKER_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')
  if ! assert_eq "iter $i: all trackers cleaned after agent-stop ($tracker_before files)" "0" "$tracker_after"; then
    teardown_temp_env
    continue
  fi

  PASS=$((PASS + 1))
  teardown_temp_env
done

echo "Test 1: $PASS passed, $FAIL failed"


# ── Test 2: agent-stop cleans manually created tracker files ($ITERATIONS iterations) ──
# Create random tracker files directly (not via tool-start) to verify bulk cleanup
# works regardless of how the files were created.

echo ""
echo "=== Test 2: agent-stop cleans manually created trackers ($ITERATIONS iterations) ==="

PASS2=0
FAIL2=0

for i in $(seq 1 $ITERATIONS); do
  setup_temp_env

  # Initialize session
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1

  TRACKER_DIR=$(get_tracker_dir)

  # Create a random number of tracker files manually (1 to 10)
  file_count=$(( (RANDOM % 10) + 1 ))
  for _f in $(seq 1 $file_count); do
    tid=$(random_tool_id)
    idx=$(( RANDOM % ${#TOOL_NAMES[@]} ))
    echo "${TOOL_NAMES[$idx]}" > "$TRACKER_DIR/$tid"
  done

  # Verify files exist
  actual_count=$(find "$TRACKER_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')
  if [[ "$actual_count" -lt 1 ]]; then
    echo "FAIL: iter $i: no manual tracker files created"
    FAIL2=$((FAIL2 + 1))
    teardown_temp_env
    continue
  fi

  # Run agent-stop
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" agent-stop) > /dev/null 2>&1

  # Assert directory is empty
  tracker_after=$(find "$TRACKER_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')
  if ! assert_eq "iter $i: all manual trackers cleaned ($actual_count files)" "0" "$tracker_after"; then
    FAIL2=$((FAIL2 + 1))
    teardown_temp_env
    continue
  fi

  PASS2=$((PASS2 + 1))
  teardown_temp_env
done

echo "Test 2: $PASS2 passed, $FAIL2 failed"


# ── Test 3: agent-stop with mixed trackers (tool-start + manual) ($ITERATIONS iterations) ──
# Combine tool-start-created and manually-created tracker files, then agent-stop.

echo ""
echo "=== Test 3: agent-stop cleans mixed trackers ($ITERATIONS iterations) ==="

PASS3=0
FAIL3=0

for i in $(seq 1 $ITERATIONS); do
  setup_temp_env

  # Initialize session
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1

  TRACKER_DIR=$(get_tracker_dir)

  # Start some tools via bridge (1 to 4)
  bridge_count=$(( (RANDOM % 4) + 1 ))
  for _t in $(seq 1 $bridge_count); do
    idx=$(( RANDOM % ${#TOOL_NAMES[@]} ))
    (cd "$PWD" && bash "$BRIDGE_SCRIPT" tool-start "${TOOL_NAMES[$idx]}") > /dev/null 2>&1
  done

  # Also create some manual tracker files (1 to 4)
  manual_count=$(( (RANDOM % 4) + 1 ))
  for _f in $(seq 1 $manual_count); do
    tid=$(random_tool_id)
    idx=$(( RANDOM % ${#TOOL_NAMES[@]} ))
    echo "${TOOL_NAMES[$idx]}" > "$TRACKER_DIR/$tid"
  done

  # Verify files exist
  total_before=$(find "$TRACKER_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')
  if [[ "$total_before" -lt 2 ]]; then
    echo "FAIL: iter $i: expected at least 2 tracker files, got $total_before"
    FAIL3=$((FAIL3 + 1))
    teardown_temp_env
    continue
  fi

  # Run agent-stop
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" agent-stop) > /dev/null 2>&1

  # Assert directory is empty
  tracker_after=$(find "$TRACKER_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')
  if ! assert_eq "iter $i: all mixed trackers cleaned ($total_before files)" "0" "$tracker_after"; then
    FAIL3=$((FAIL3 + 1))
    teardown_temp_env
    continue
  fi

  PASS3=$((PASS3 + 1))
  teardown_temp_env
done

echo "Test 3: $PASS3 passed, $FAIL3 failed"


# ── Test 4: agent-stop with empty tracker directory ──
# Verify agent-stop succeeds even when no tracker files exist.

ITERATIONS4=20
echo ""
echo "=== Test 4: agent-stop with empty tracker dir ($ITERATIONS4 iterations) ==="

PASS4=0
FAIL4=0

for i in $(seq 1 $ITERATIONS4); do
  setup_temp_env

  # Initialize session (creates .kiro-tools/ dir but no tracker files)
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1

  TRACKER_DIR=$(get_tracker_dir)

  # Verify no tracker files
  tracker_before=$(find "$TRACKER_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')
  if [[ "$tracker_before" -ne 0 ]]; then
    echo "FAIL: iter $i: expected 0 tracker files after init, got $tracker_before"
    FAIL4=$((FAIL4 + 1))
    teardown_temp_env
    continue
  fi

  # Run agent-stop — should succeed without error
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" agent-stop) > /dev/null 2>&1
  exit_code=$?

  if [[ "$exit_code" -ne 0 ]]; then
    echo "FAIL: iter $i: agent-stop exited with $exit_code on empty tracker dir"
    FAIL4=$((FAIL4 + 1))
    teardown_temp_env
    continue
  fi

  # Directory should still be empty
  tracker_after=$(find "$TRACKER_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')
  if ! assert_eq "iter $i: tracker dir still empty" "0" "$tracker_after"; then
    FAIL4=$((FAIL4 + 1))
    teardown_temp_env
    continue
  fi

  PASS4=$((PASS4 + 1))
  teardown_temp_env
done

echo "Test 4: $PASS4 passed, $FAIL4 failed"


# ── Summary ──

echo ""
echo "=== Summary ==="
TOTAL_PASS=$((PASS + PASS2 + PASS3 + PASS4))
TOTAL_FAIL=$((FAIL + FAIL2 + FAIL3 + FAIL4))
TOTAL=$((TOTAL_PASS + TOTAL_FAIL))
echo "Total: $TOTAL_PASS/$TOTAL passed"

if [[ $TOTAL_FAIL -gt 0 ]]; then
  echo "FAILED"
  exit 1
fi

echo "ALL PASSED"
exit 0
