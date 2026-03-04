# Kiro Bridge — Design Document

This document describes the architecture and design decisions behind the Kiro-to-Pixel-Agents bridge. It's intended for contributors who want to understand, extend, or debug the integration.

For setup and usage instructions, see [KIRO.md](../KIRO.md).

## Problem

Pixel Agents was built around Claude Code, which runs in a VS Code terminal and writes JSONL transcript files that the extension watches. Kiro is a different AI IDE that has no terminal — it uses a hook system that fires shell commands at lifecycle points. The bridge translates Kiro hook events into the same JSONL format so Pixel Agents can visualize Kiro agents without any changes to the JSONL parser.

## Architecture

```
Kiro hook (promptSubmit)  →  bridge.sh init       →  user record      ─┐
Kiro hook (preToolUse)    →  bridge.sh tool-start  →  tool_use record   │→  {session}.jsonl
Kiro hook (postToolUse)   →  bridge.sh tool-done   →  tool_result record│    in ~/.claude/projects/{hash}/
Kiro hook (agentStop)     →  bridge.sh agent-stop  →  turn_duration    ─┘
                                                                          ↓
                                                              Extension file watcher
                                                                          ↓
                                                              createTerminalLessAgent()
                                                                          ↓
                                                              processTranscriptLine()
                                                                          ↓
                                                              Pixel character animates
```

### Data Flow

1. Kiro fires a hook → shell command executes `pixel-agents-bridge.sh` with an event type
2. The script computes the project directory using the same path-hashing algorithm as `getProjectDirPath()` in the extension
3. Session identity is managed via a `.kiro-session` tracker file containing a UUID
4. For tool events, the script maps Kiro tool names to Claude Code equivalents and tracks tool IDs via files in `.kiro-tools/`
5. JSONL records are appended to `{session-id}.jsonl`
6. The extension's `ensureProjectScan()` discovers the JSONL file on startup (or `scanForNewJsonlFiles()` finds it on the next interval)
7. Since no VS Code terminal matches, `createTerminalLessAgent()` creates an `AgentState` with `terminalRef: null`
8. `processTranscriptLine()` handles records identically to Claude Code agents

## Key Design Decisions

| Decision | Choice | Why |
|---|---|---|
| `terminalRef` type | `vscode.Terminal \| null` | Kiro agents have no terminal. `null` (not `undefined`) makes absence explicit and avoids truthiness bugs. |
| Agent creation path | New `createTerminalLessAgent()` in `fileWatcher.ts` | Keeps existing `adoptTerminalForFile()` unchanged. The new function is a simpler variant without terminal binding. |
| Persistence | `terminalName: null` in `PersistedAgent` | `restoreAgents()` checks JSONL file existence instead of terminal matching for null-terminal agents. |
| Recursive hook prevention | Explicit `toolTypes: ["read", "write", "shell"]` in hook config | Each hook spawns a fresh shell process, so env vars don't propagate between invocations. The `toolTypes` filter prevents hooks from firing on their own `runCommand` operations. |
| stdin reading | Removed entirely | Kiro's `runCommand` hooks don't pipe context to stdin. The 1-second `read -t` timeout added unacceptable latency per tool call. The bridge accepts tool names as arguments instead. |
| Tool name fallback | `formatToolStatus()` shows "Working" for unknown tools | Kiro's `runCommand` hooks don't pass tool context, so the bridge defaults to `"unknown"`. The parser catches this and displays "Working" instead of "Using unknown". |
| Tool tracker keying | Filename = Tool_ID, content = tool name | Keying by tool name caused collisions with concurrent same-tool calls (e.g., parallel `readFile`). Keying by Tool_ID eliminates this. |
| Tool ID format | `toolu_kiro_{24-char-hex}` | Distinguishable from Claude's `toolu_` IDs, compatible with the transcript parser's string-based ID tracking. |
| Orphaned file adoption | `ensureProjectScan()` adopts unowned JSONL files on startup | The bridge may write the JSONL file before the extension starts scanning. Without adoption, the file gets seeded as "known" but no agent is created for it. |


## JSONL Record Formats

All records share a `timestamp` field (ISO 8601 UTC). These match the format Claude Code produces, so the existing `processTranscriptLine()` handles them without modification.

### User Prompt (init)
```json
{"type":"user","message":{"role":"user","content":"[Kiro prompt]"},"timestamp":"2025-01-15T10:30:00.000Z"}
```

### Tool Use (tool-start)
```json
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_kiro_a1b2c3d4e5f6a1b2c3d4e5f6","name":"Read","input":{"file_path":"src/main.ts"}}]},"timestamp":"2025-01-15T10:30:01.000Z"}
```

### Tool Result (tool-done)
```json
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_kiro_a1b2c3d4e5f6a1b2c3d4e5f6"}]},"timestamp":"2025-01-15T10:30:02.000Z"}
```

### Turn Duration (agent-stop)
```json
{"type":"system","subtype":"turn_duration","timestamp":"2025-01-15T10:30:05.000Z"}
```

## Tool Name Mapping

| Kiro Tools | Mapped Name | Input Extraction |
|---|---|---|
| `readFile`, `readCode`, `readMultipleFiles`, `getDiagnostics` | Read | `path` → `file_path` |
| `editCode`, `strReplace`, `semanticRename`, `smartRelocate` | Edit | `path` → `file_path` |
| `fsWrite`, `fsAppend`, `deleteFile` | Write | `path` or `targetFile` → `file_path` |
| `executeBash` | Bash | `command` → `command` |
| `fileSearch`, `listDirectory` | Glob | `{}` |
| `grepSearch` | Grep | `{}` |
| `remote_web_search`, `webFetch` | WebFetch | `{}` |
| `invokeSubAgent` | Task | `prompt` or `description` → `description` (truncated to 80 chars) |
| Unknown tools | Pass-through | `{}` |

## Extension Modifications

Seven files were modified to support terminal-less agents and Kiro integration:

### `types.ts`
- `AgentState.terminalRef`: changed from `vscode.Terminal` to `vscode.Terminal | null`
- `PersistedAgent.terminalName`: changed from `string` to `string | null`

### `agentManager.ts`
- `persistAgents()`: uses `agent.terminalRef?.name ?? null` for serialization
- `restoreAgents()`: for agents with `terminalName: null`, checks JSONL file existence instead of terminal matching

### `fileWatcher.ts`
- New `createTerminalLessAgent()` function: creates an `AgentState` with `terminalRef: null`, starts file watching, reads initial lines
- `scanForNewJsonlFiles()`: falls through to `createTerminalLessAgent()` when no unowned terminal is available (the Kiro path)
- `ensureProjectScan()`: after seeding known files, adopts any JSONL files not tracked by an existing agent — this handles the case where the bridge writes the file before the extension starts scanning

### `transcriptParser.ts`
- `formatToolStatus()`: default case now shows "Working" instead of "Using unknown" when the tool name is empty or literally `"unknown"` — handles the Kiro bridge case where `runCommand` hooks can't pass tool context

### `PixelAgentsViewProvider.ts`
- On webview ready, runs `which claude` to check if the Claude Code CLI is installed. Sends `claudeAvailable` boolean to the webview via `settingsLoaded` message.

### `webview-ui/src/components/BottomToolbar.tsx`
- New `claudeAvailable` prop. When `false` (Kiro), the "+ Agent" button and folder picker are hidden since Kiro agents are created automatically via hooks, not by spawning Claude Code terminals.

### `webview-ui/src/hooks/useExtensionMessages.ts`
- Tracks `claudeAvailable` state from the `settingsLoaded` message and exposes it to `App.tsx`.

## Tracker Files

| File | Location | Content | Lifecycle |
|---|---|---|---|
| `.kiro-session` | `~/.claude/projects/{hash}/` | UUID v4 string | Created on first `init`, reused on subsequent calls, deleted on `reset` |
| `{tool-id}` | `~/.claude/projects/{hash}/.kiro-tools/` | Tool name string | Created on `tool-start`, deleted on matching `tool-done` or bulk-deleted on `agent-stop` |

Tracker files are keyed by Tool_ID (filename) with the tool name as content. On `tool-done`, the script scans all tracker files for one whose content matches the tool name, reads the Tool_ID from the filename, and deletes the file. This handles concurrent invocations of the same tool (e.g., parallel `readFile` calls).

## Error Handling

| Scenario | Behavior |
|---|---|
| Project directory doesn't exist | `mkdir -p` creates it. Script continues. |
| `uuidgen` not available | Falls back to `/dev/urandom` |
| Tool tracker missing on tool-done | Exits cleanly (`exit 0`), no tool_result written |
| JSONL write fails (permissions, disk) | `set -euo pipefail` exits non-zero. Kiro hook runner handles the error. |
| Malformed JSONL lines | `processTranscriptLine()` catches and silently skips (existing behavior) |
| Terminal-less agent's JSONL deleted | File watcher catches `statSync` errors. Agent stays in last known state. |
| VS Code reload with Kiro agent | `restoreAgents()` checks JSONL file existence. If present, agent is restored. |
| JSONL file exists before extension scans | `ensureProjectScan()` adopts orphaned files by creating terminal-less agents for any unowned JSONL files found during seeding. |

## Correctness Properties

These properties are validated by the test suite (TypeScript property tests in `src/__tests__/` and shell tests in `scripts/kiro-bridge/__tests__/`). They document the invariants that should hold if the bridge is working correctly.

1. **Path equivalence**: The bridge's `sed 's/[^a-zA-Z0-9-]/-/g'` produces the same directory name as the extension's `workspacePath.replace(/[^a-zA-Z0-9-]/g, '-')` for any input string.

2. **Session persistence**: A UUID written to `.kiro-session` is returned unchanged by subsequent `get_or_create_session()` calls, and the JSONL filename matches.

3. **Tool mapping**: All Kiro tool names in the mapping table produce the correct Claude Code equivalent. Unknown names pass through unchanged.

4. **Tool ID round-trip**: A tool-start/tool-done pair for the same tool name correctly correlates via the tracker file, even with concurrent same-tool invocations.

5. **JSONL validity**: Every record produced by the bridge is valid JSON matching the expected schema for its event type, with valid ISO 8601 timestamps.

6. **Parser round-trip**: JSONL records processed by `processTranscriptLine()` produce correct state transitions: init clears waiting, tool-start adds to activeToolIds, tool-done removes from activeToolIds, agent-stop sets isWaiting and clears all tool state.

7. **Terminal-less equivalence**: `processTranscriptLine()` produces identical state transitions regardless of whether `terminalRef` is null or a real terminal.

8. **Persistence round-trip**: Agents with `terminalRef: null` serialize as `terminalName: null` and restore correctly when the JSONL file exists.

9. **Reset isolation**: After reset + init, the new session ID differs from the original.

10. **Agent-stop cleanup**: All tracker files in `.kiro-tools/` are removed on agent-stop.

## Extending the Bridge

To add support for another AI IDE or agent framework:

1. Write a bridge script (or adapt `pixel-agents-bridge.sh`) that produces the same JSONL format
2. The extension already handles terminal-less agents — any JSONL file appearing in `~/.claude/projects/{hash}/` will be adopted automatically
3. Add tool name mappings for the new framework's tool names in `map_tool_name()`
4. If the framework has lifecycle hooks, wire them to the bridge's event types (init, tool-start, tool-done, agent-stop)

The key contract is the JSONL format and the project directory path computation. Everything else is implementation detail.
