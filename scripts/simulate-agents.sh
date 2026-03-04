#!/usr/bin/env bash
# simulate-agents.sh — Spawn multiple fake Kiro agent sessions for testing
# Each agent gets its own JSONL file and cycles through tool_use/tool_result pairs.
#
# Usage: bash scripts/simulate-agents.sh [num_agents] [duration_seconds]
#   Defaults: 4 agents, 60 seconds

set -eo pipefail

NUM_AGENTS="${1:-4}"
DURATION="${2:-60}"

WORKSPACE_DIR="${PWD}"
DIR_NAME=$(echo "$WORKSPACE_DIR" | sed 's/[^a-zA-Z0-9-]/-/g')
PROJECT_DIR="$HOME/.claude/projects/$DIR_NAME"
mkdir -p "$PROJECT_DIR"

# Tool definitions: name|input JSON
TOOLS=(
  "Read|{\"file_path\":\"src/extension.ts\"}"
  "Edit|{\"file_path\":\"src/agentManager.ts\"}"
  "Write|{\"file_path\":\"src/types.ts\"}"
  "Bash|{\"command\":\"npm run build\"}"
  "Grep|{\"pattern\":\"TODO\"}"
  "Read|{\"file_path\":\"package.json\"}"
  "Edit|{\"file_path\":\"src/kiroBridgeSetup.ts\"}"
  "Bash|{\"command\":\"npm test\"}"
  "Write|{\"file_path\":\"src/constants.ts\"}"
  "Read|{\"file_path\":\"tsconfig.json\"}"
  "Glob|{\"pattern\":\"**/*.ts\"}"
  "Bash|{\"command\":\"git status\"}"
  "Edit|{\"file_path\":\"webview-ui/src/App.tsx\"}"
  "Read|{\"file_path\":\"src/transcriptParser.ts\"}"
  "Task|{\"description\":\"Refactoring the asset loader module\"}"
  "WebFetch|{\"url\":\"https://docs.example.com/api\"}"
)

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%S.000Z"
}

generate_tool_id() {
  echo "toolu_sim_$(uuidgen | tr '[:upper:]' '[:lower:]' | tr -d '-' | head -c 24)"
}

run_agent() {
  local agent_num="$1"
  local session_id
  session_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
  local jsonl_file="$PROJECT_DIR/${session_id}.jsonl"
  local end_time=$((SECONDS + DURATION))

  echo "[Agent $agent_num] Session: $session_id"

  # Initial user prompt
  local ts
  ts=$(timestamp)
  echo "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"[Kiro prompt from agent $agent_num]\"},\"timestamp\":\"$ts\"}" >> "$jsonl_file"

  local tool_idx=0
  local num_tools=${#TOOLS[@]}

  while [[ $SECONDS -lt $end_time ]]; do
    # Use modulo to cycle through tools; +1 offset for zsh compatibility (1-indexed arrays)
    local idx=$(( (tool_idx + agent_num * 3) % num_tools ))
    local tool_entry="${TOOLS[$idx]}"
    local tool_name="${tool_entry%%|*}"
    local tool_input="${tool_entry#*|}"
    local tool_id
    tool_id=$(generate_tool_id)

    # tool_use
    ts=$(timestamp)
    echo "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"id\":\"$tool_id\",\"name\":\"$tool_name\",\"input\":$tool_input}]},\"timestamp\":\"$ts\"}" >> "$jsonl_file"

    # Simulate tool execution (1-3s)
    sleep $(( (RANDOM % 3) + 1 ))

    # tool_result
    ts=$(timestamp)
    echo "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"tool_result\",\"tool_use_id\":\"$tool_id\"}]},\"timestamp\":\"$ts\"}" >> "$jsonl_file"

    # Thinking gap (1s)
    sleep 1

    tool_idx=$((tool_idx + 1))
  done

  # Agent stop
  ts=$(timestamp)
  echo "{\"type\":\"system\",\"subtype\":\"turn_duration\",\"timestamp\":\"$ts\"}" >> "$jsonl_file"
  echo "[Agent $agent_num] Done ($tool_idx tools executed)"
}

echo "🎮 Spawning $NUM_AGENTS simulated agents for ${DURATION}s..."
echo "   Project dir: $PROJECT_DIR"
echo ""

PIDS=()
for i in $(seq 1 "$NUM_AGENTS"); do
  run_agent "$i" &
  PIDS+=($!)
  sleep 3
done

echo ""
echo "Agents running. Press Ctrl+C to stop early, or wait ${DURATION}s."
echo ""

for pid in "${PIDS[@]}"; do
  wait "$pid" 2>/dev/null || true
done

echo ""
echo "✅ All agents finished. Check the Pixel Agents panel!"
