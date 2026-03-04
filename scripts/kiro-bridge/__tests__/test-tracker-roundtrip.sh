#!/usr/bin/env bash
# Feature: kiro-pixel-agents-bridge, Property 5: Tool ID tracker round-trip
#
# For any tool invocation, when tool-start writes a tracker file named {tool-id}
# containing the tool name, a subsequent tool-done for the same tool name SHALL
# find the tracker file by scanning for matching content, extract the Tool_ID
# from the filename, include it as tool_use_id in the tool_result record, and
# delete the tracker file. When multiple concurrent invocations of the same tool
# exist, each SHALL have its own tracker file and be resolved independently.
#
# Validates: Requirements 4.3, 5.2, 5.3, 5.4

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

# Compute the project dir the same way the bridge does
get_project_dir() {
  local dir_name
  dir_name=$(echo "$PWD" | sed 's/[^a-zA-Z0-9-]/-/g')
  echo "$HOME/.claude/projects/$dir_name"
}

get_tracker_dir() {
  echo "$(get_project_dir)/.kiro-tools"
}

get_jsonl_file() {
  local project_dir
  project_dir=$(get_project_dir)
  local session_file="$project_dir/.kiro-session"
  if [[ -f "$session_file" ]]; then
    local sid
    sid=$(cat "$session_file")
    echo "$project_dir/${sid}.jsonl"
  fi
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


# ── Test 1: Single tool round-trip (100 iterations) ──
# Each iteration: tool-start creates tracker, tool-done resolves and deletes it

echo "=== Test 1: Single tool round-trip ($ITERATIONS iterations) ==="

TOOL_NAMES=("readFile" "editCode" "fsWrite" "executeBash" "grepSearch" "invokeSubAgent" "readCode" "strReplace" "deleteFile" "webFetch" "unknown")

for i in $(seq 1 $ITERATIONS); do
  setup_temp_env

  # Pick a tool name (cycle through the list)
  idx=$(( (i - 1) % ${#TOOL_NAMES[@]} ))
  TOOL="${TOOL_NAMES[$idx]}"

  # Initialize session
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1

  TRACKER_DIR=$(get_tracker_dir)

  # tool-start: should create exactly one tracker file
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" tool-start "$TOOL") > /dev/null 2>&1

  tracker_count=$(find "$TRACKER_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')
  if ! assert_eq "iter $i: tracker file created" "1" "$tracker_count"; then
    teardown_temp_env
    continue
  fi

  # Read the tracker file: filename = tool_id, content = tool name
  tracker_file=$(find "$TRACKER_DIR" -maxdepth 1 -type f | head -1)
  tool_id=$(basename "$tracker_file")
  stored_name=$(cat "$tracker_file")

  if ! assert_eq "iter $i: tracker content is tool name" "$TOOL" "$stored_name"; then
    teardown_temp_env
    continue
  fi

  # Verify tool_id format: toolu_kiro_{24-hex-chars}
  if ! echo "$tool_id" | grep -qE '^toolu_kiro_[a-f0-9]{24}$'; then
    echo "FAIL: iter $i: tool_id format invalid: $tool_id"
    FAIL=$((FAIL + 1))
    teardown_temp_env
    continue
  fi

  # tool-done: should find tracker, write tool_result with correct id, delete tracker
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" tool-done "$TOOL") > /dev/null 2>&1

  tracker_count_after=$(find "$TRACKER_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')
  if ! assert_eq "iter $i: tracker deleted after tool-done" "0" "$tracker_count_after"; then
    teardown_temp_env
    continue
  fi

  # Verify the JSONL file contains a tool_result with the correct tool_use_id
  JSONL=$(get_jsonl_file)
  if [[ -z "$JSONL" || ! -f "$JSONL" ]]; then
    echo "FAIL: iter $i: JSONL file not found"
    FAIL=$((FAIL + 1))
    teardown_temp_env
    continue
  fi

  # The last line should be the tool_result record
  last_line=$(tail -1 "$JSONL")
  if ! echo "$last_line" | grep -q "\"tool_use_id\":\"$tool_id\""; then
    echo "FAIL: iter $i: tool_result does not contain correct tool_use_id"
    echo "  expected tool_id: $tool_id"
    echo "  last JSONL line: $last_line"
    FAIL=$((FAIL + 1))
    teardown_temp_env
    continue
  fi

  PASS=$((PASS + 1))
  teardown_temp_env
done

echo "Test 1: $PASS passed, $FAIL failed"


# ── Test 2: Concurrent same-tool invocations (100 iterations) ──
# Multiple tool-start calls with the SAME tool name, then tool-done for each.
# Each tool-done should resolve to a unique Tool_ID and delete only its tracker.

ITERATIONS2=30  # Fewer iterations for concurrent test (each spawns 2-5 sub-invocations)
echo ""
echo "=== Test 2: Concurrent same-tool round-trip ($ITERATIONS2 iterations) ==="

PASS2=0
FAIL2=0

for i in $(seq 1 $ITERATIONS2); do
  setup_temp_env

  # Use the same tool name for all concurrent calls
  TOOL="readFile"

  # Vary concurrency count between 2 and 5
  CONCURRENT=$(( (i % 4) + 2 ))

  # Initialize session
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1

  TRACKER_DIR=$(get_tracker_dir)
  JSONL=$(get_jsonl_file)

  # Start multiple tools with the same name
  for _c in $(seq 1 $CONCURRENT); do
    (cd "$PWD" && bash "$BRIDGE_SCRIPT" tool-start "$TOOL") > /dev/null 2>&1
  done

  # Verify we have exactly CONCURRENT tracker files
  tracker_count=$(find "$TRACKER_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')
  if ! assert_eq "iter $i: $CONCURRENT tracker files created" "$CONCURRENT" "$tracker_count"; then
    teardown_temp_env
    FAIL2=$((FAIL2 + 1))
    continue
  fi

  # Collect all tool IDs from tracker filenames
  TOOL_IDS=()
  while IFS= read -r f; do
    TOOL_IDS+=("$(basename "$f")")
  done < <(find "$TRACKER_DIR" -maxdepth 1 -type f | sort)

  # Verify all tracker files contain the same tool name
  all_names_match=true
  for f in "$TRACKER_DIR"/*; do
    [[ -f "$f" ]] || continue
    if [[ "$(cat "$f")" != "$TOOL" ]]; then
      all_names_match=false
      break
    fi
  done
  if [[ "$all_names_match" != "true" ]]; then
    echo "FAIL: iter $i: not all tracker files contain tool name '$TOOL'"
    FAIL2=$((FAIL2 + 1))
    teardown_temp_env
    continue
  fi

  # Verify all tool IDs are unique
  unique_count=$(printf '%s\n' "${TOOL_IDS[@]}" | sort -u | wc -l | tr -d ' ')
  if ! assert_eq "iter $i: all tool IDs unique" "$CONCURRENT" "$unique_count"; then
    teardown_temp_env
    FAIL2=$((FAIL2 + 1))
    continue
  fi

  # Now resolve each tool-done one at a time
  resolved_ids=()
  iter_ok=true
  for _c in $(seq 1 $CONCURRENT); do
    # Count trackers before
    before=$(find "$TRACKER_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')

    (cd "$PWD" && bash "$BRIDGE_SCRIPT" tool-done "$TOOL") > /dev/null 2>&1

    # Count trackers after — should be one less
    after=$(find "$TRACKER_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')
    expected_after=$((before - 1))
    if [[ "$after" != "$expected_after" ]]; then
      echo "FAIL: iter $i, done $_c: expected $expected_after trackers, got $after"
      iter_ok=false
      break
    fi

    # Extract the tool_use_id from the last JSONL line
    last_line=$(tail -1 "$JSONL")
    tid=$(echo "$last_line" | grep -o '"tool_use_id":"[^"]*"' | sed 's/"tool_use_id":"//' | sed 's/"$//')
    if [[ -z "$tid" ]]; then
      echo "FAIL: iter $i, done $_c: no tool_use_id in JSONL"
      iter_ok=false
      break
    fi
    resolved_ids+=("$tid")
  done

  if [[ "$iter_ok" != "true" ]]; then
    FAIL2=$((FAIL2 + 1))
    teardown_temp_env
    continue
  fi

  # Verify all resolved IDs are unique (each tool-done resolved a different tracker)
  resolved_unique=$(printf '%s\n' "${resolved_ids[@]}" | sort -u | wc -l | tr -d ' ')
  if ! assert_eq "iter $i: all resolved IDs unique" "$CONCURRENT" "$resolved_unique"; then
    teardown_temp_env
    FAIL2=$((FAIL2 + 1))
    continue
  fi

  # Verify all resolved IDs were in the original set
  all_in_set=true
  for rid in "${resolved_ids[@]}"; do
    found=false
    for oid in "${TOOL_IDS[@]}"; do
      if [[ "$rid" == "$oid" ]]; then
        found=true
        break
      fi
    done
    if [[ "$found" != "true" ]]; then
      echo "FAIL: iter $i: resolved ID $rid not in original set"
      all_in_set=false
      break
    fi
  done
  if [[ "$all_in_set" != "true" ]]; then
    FAIL2=$((FAIL2 + 1))
    teardown_temp_env
    continue
  fi

  # Verify tracker dir is now empty
  final_count=$(find "$TRACKER_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')
  if ! assert_eq "iter $i: all trackers cleaned up" "0" "$final_count"; then
    teardown_temp_env
    FAIL2=$((FAIL2 + 1))
    continue
  fi

  PASS2=$((PASS2 + 1))
  teardown_temp_env
done

echo "Test 2: $PASS2 passed, $FAIL2 failed"


# ── Test 3: tool-done with no matching tracker is a no-op (100 iterations) ──
# Validates Requirement 5.5: no tracker → skip without error
# Uses a single temp env for all iterations to reduce overhead.

echo ""
echo "=== Test 3: tool-done with no tracker is no-op ($ITERATIONS iterations) ==="

PASS3=0
FAIL3=0

setup_temp_env
(cd "$PWD" && bash "$BRIDGE_SCRIPT" init) > /dev/null 2>&1
JSONL=$(get_jsonl_file)

for i in $(seq 1 $ITERATIONS); do
  # Pick a tool name
  idx=$(( (i - 1) % ${#TOOL_NAMES[@]} ))
  TOOL="${TOOL_NAMES[$idx]}"

  lines_before=$(wc -l < "$JSONL" | tr -d ' ')

  # tool-done without a prior tool-start — should exit 0 and not write a record
  (cd "$PWD" && bash "$BRIDGE_SCRIPT" tool-done "$TOOL") > /dev/null 2>&1
  exit_code=$?

  if [[ "$exit_code" -ne 0 ]]; then
    echo "FAIL: iter $i: tool-done without tracker exited with $exit_code"
    FAIL3=$((FAIL3 + 1))
    continue
  fi

  lines_after=$(wc -l < "$JSONL" | tr -d ' ')
  if ! assert_eq "iter $i: no new JSONL line written" "$lines_before" "$lines_after"; then
    FAIL3=$((FAIL3 + 1))
    continue
  fi

  PASS3=$((PASS3 + 1))
done

teardown_temp_env
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
