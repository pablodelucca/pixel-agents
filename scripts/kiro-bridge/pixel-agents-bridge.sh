#!/usr/bin/env bash
# pixel-agents-bridge.sh — Writes Claude-Code-compatible JSONL for Pixel Agents
# Called by Kiro hooks to bridge Kiro agent activity into the Pixel Agents extension.
#
# Usage:
#   pixel-agents-bridge.sh <event-type> [tool-name]
#
# Events:
#   init          — Create session JSONL file (called on promptSubmit)
#   tool-start    — Record a tool_use block (called on preToolUse, tool name passed as argument)
#   tool-done     — Record a tool_result block (called on postToolUse, tool name passed as argument)
#   agent-stop    — Record turn_duration + waiting state (called on agentStop)
#   reset         — Clear session to start fresh
#
# Tool name is passed as the second argument for tool-start/tool-done events.
# If not provided, defaults to "unknown".

set -euo pipefail

# ── Resolve project directory (same algorithm as Pixel Agents) ──
WORKSPACE_DIR="${PWD}"
DIR_NAME=$(echo "$WORKSPACE_DIR" | sed 's/[^a-zA-Z0-9-]/-/g')
PROJECT_DIR="$HOME/.claude/projects/$DIR_NAME"
mkdir -p "$PROJECT_DIR"

# ── Session file management ──
SESSION_TRACKER="$PROJECT_DIR/.kiro-session"
EVENT_TYPE="${1:-}"

get_or_create_session() {
  if [[ -f "$SESSION_TRACKER" ]]; then
    cat "$SESSION_TRACKER"
  else
    local sid
    sid=$(uuidgen | tr '[:upper:]' '[:lower:]')
    echo "$sid" > "$SESSION_TRACKER"
    echo "$sid"
  fi
}

SESSION_ID=$(get_or_create_session)
JSONL_FILE="$PROJECT_DIR/${SESSION_ID}.jsonl"

# ── Tool ID tracking ──
TOOL_TRACKER_DIR="$PROJECT_DIR/.kiro-tools"
mkdir -p "$TOOL_TRACKER_DIR"

generate_tool_id() {
  echo "toolu_kiro_$(uuidgen | tr '[:upper:]' '[:lower:]' | tr -d '-' | head -c 24)"
}

# ── Map Kiro tool names to Claude Code equivalents ──
map_tool_name() {
  local kiro_name="$1"
  case "$kiro_name" in
    readFile|readCode|readMultipleFiles|getDiagnostics)
      echo "Read" ;;
    editCode|strReplace|semanticRename|smartRelocate)
      echo "Edit" ;;
    fsWrite|fsAppend|deleteFile)
      echo "Write" ;;
    executeBash)
      echo "Bash" ;;
    fileSearch|listDirectory)
      echo "Glob" ;;
    grepSearch|mcp_builder_mcp_WorkspaceSearch)
      echo "Grep" ;;
    remote_web_search|webFetch)
      echo "WebFetch" ;;
    invokeSubAgent)
      echo "Task" ;;
    createHook)
      echo "Write" ;;
    *)
      echo "$kiro_name" ;;
  esac
}

# ── Extract tool name from hook context ──
extract_tool_name() {
  local ctx="$1"
  if [[ -z "$ctx" ]]; then
    echo "unknown"
    return
  fi
  local name
  name=$(echo "$ctx" | grep -o '"toolName"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//' | sed 's/"$//' 2>/dev/null || echo "")
  if [[ -z "$name" ]]; then
    name=$(echo "$ctx" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//' | sed 's/"$//' 2>/dev/null || echo "")
  fi
  if [[ -z "$name" ]]; then
    name=$(echo "$ctx" | grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//' | sed 's/"$//' 2>/dev/null || echo "")
  fi
  echo "${name:-unknown}"
}

# ── Build tool input for display in Pixel Agents ──
build_tool_input() {
  local mapped_name="$1"
  local ctx="$2"

  case "$mapped_name" in
    Read)
      local fp
      fp=$(echo "$ctx" | grep -o '"path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//' | sed 's/"$//' 2>/dev/null || echo "")
      echo "{\"file_path\":\"${fp}\"}"
      ;;
    Edit)
      local fp
      fp=$(echo "$ctx" | grep -o '"path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//' | sed 's/"$//' 2>/dev/null || echo "")
      echo "{\"file_path\":\"${fp}\"}"
      ;;
    Write)
      local fp
      fp=$(echo "$ctx" | grep -o '"path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//' | sed 's/"$//' 2>/dev/null || echo "")
      if [[ -z "$fp" ]]; then
        fp=$(echo "$ctx" | grep -o '"targetFile"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//' | sed 's/"$//' 2>/dev/null || echo "")
      fi
      echo "{\"file_path\":\"${fp}\"}"
      ;;
    Bash)
      local cmd
      cmd=$(echo "$ctx" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//' | sed 's/"$//' 2>/dev/null || echo "")
      cmd=$(echo "$cmd" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')
      echo "{\"command\":\"${cmd}\"}"
      ;;
    Task)
      local desc
      desc=$(echo "$ctx" | grep -o '"prompt"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//' | sed 's/"$//' 2>/dev/null || echo "")
      desc="${desc:0:80}"
      desc=$(echo "$desc" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')
      echo "{\"description\":\"${desc}\"}"
      ;;
    *)
      echo "{}"
      ;;
  esac
}

# ── Event handlers ──

case "$EVENT_TYPE" in
  init)
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    echo "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"[Kiro prompt]\"},\"timestamp\":\"$TIMESTAMP\"}" >> "$JSONL_FILE"
    ;;

  tool-start)
    TOOL_NAME="${2:-unknown}"
    MAPPED_NAME=$(map_tool_name "$TOOL_NAME")
    TOOL_ID=$(generate_tool_id)

    # Store tool name in a file keyed by tool ID (supports concurrent same-tool calls)
    echo "$TOOL_NAME" > "$TOOL_TRACKER_DIR/$TOOL_ID"

    TOOL_INPUT=$(build_tool_input "$MAPPED_NAME" "")
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

    echo "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"id\":\"$TOOL_ID\",\"name\":\"$MAPPED_NAME\",\"input\":$TOOL_INPUT}]},\"timestamp\":\"$TIMESTAMP\"}" >> "$JSONL_FILE"
    ;;

  tool-done)
    TOOL_NAME="${2:-unknown}"

    # Scan tracker dir for a file whose content matches the tool name
    TOOL_ID=""
    for tracker_file in "$TOOL_TRACKER_DIR"/*; do
      [[ -f "$tracker_file" ]] || continue
      if [[ "$(cat "$tracker_file")" == "$TOOL_NAME" ]]; then
        TOOL_ID=$(basename "$tracker_file")
        rm -f "$tracker_file"
        break
      fi
    done

    if [[ -z "$TOOL_ID" ]]; then
      exit 0
    fi

    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    echo "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"tool_result\",\"tool_use_id\":\"$TOOL_ID\"}]},\"timestamp\":\"$TIMESTAMP\"}" >> "$JSONL_FILE"
    ;;

  agent-stop)
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    rm -f "$TOOL_TRACKER_DIR"/* 2>/dev/null || true
    echo "{\"type\":\"system\",\"subtype\":\"turn_duration\",\"timestamp\":\"$TIMESTAMP\"}" >> "$JSONL_FILE"
    # Reset session so the next promptSubmit creates a fresh agent
    rm -f "$SESSION_TRACKER"
    ;;

  permission)
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    echo "{\"type\":\"system\",\"subtype\":\"permission\",\"timestamp\":\"$TIMESTAMP\"}" >> "$JSONL_FILE"
    ;;

  reset)
    rm -f "$SESSION_TRACKER"
    rm -f "$TOOL_TRACKER_DIR"/* 2>/dev/null || true
    echo "Session reset. A new agent will appear on next prompt."
    ;;

  *)
    echo "Usage: pixel-agents-bridge.sh {init|tool-start|tool-done|agent-stop|permission|reset}" >&2
    exit 1
    ;;
esac
