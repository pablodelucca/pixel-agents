# Pixel Agents — Kiro Setup

Pixel Agents works with Kiro through a bridge script and four agent hooks. When you use Kiro in this workspace, your AI agent gets its own animated pixel character that reacts to what it's doing in real time.

## How It Works

Kiro fires hooks at four lifecycle points: prompt submit, tool start, tool done, and agent stop. Each hook runs a bridge script that writes Claude-Code-compatible JSONL records to `~/.claude/projects/`. The Pixel Agents extension watches that directory and picks up the activity — no terminal needed.

```
Kiro hook → pixel-agents-bridge.sh → JSONL file → Pixel Agents extension
```

## Prerequisites

- [Kiro IDE](https://kiro.dev) (a VS Code fork — does not use the VS Code marketplace)
- The Pixel Agents VSIX installed manually (see below)
- bash available on your system (macOS or Linux)
- `uuidgen` available (ships with macOS and most Linux distros)

## Installing the Extension in Kiro

Since Kiro doesn't use the VS Code marketplace, you need to build and install the VSIX manually:

```bash
git clone https://github.com/pablodelucca/pixel-agents.git
cd pixel-agents
npm install
cd webview-ui && npm install && cd ..
npm run vsix
```

This produces a `pixel-agents-*.vsix` file. Install it in Kiro:

1. Open Kiro
2. Open the Command Palette (Cmd+Shift+P / Ctrl+Shift+P)
3. Run "Extensions: Install from VSIX..."
4. Select the `.vsix` file

## Setup

The hooks are already configured in this repo. Just open the workspace in Kiro and they'll activate automatically.

The four hook files in `.kiro/hooks/`:

| Hook File | Event | What It Does |
|---|---|---|
| `pixel-agents-prompt.kiro.hook` | `promptSubmit` | Creates/reuses a session, writes a user prompt record |
| `pixel-agents-tool-start.kiro.hook` | `preToolUse` | Maps the tool name and writes a tool_use record |
| `pixel-agents-tool-done.kiro.hook` | `postToolUse` | Resolves the tool ID and writes a tool_result record |
| `pixel-agents-agent-stop.kiro.hook` | `agentStop` | Writes a turn_duration record, cleans up trackers |

The `preToolUse` and `postToolUse` hooks filter on `["read", "write", "shell"]` tool types to avoid recursive firing from the hooks' own `runCommand` invocations.

## Verifying It Works

1. Open the Pixel Agents panel (bottom panel area)
2. Send a prompt in Kiro
3. A pixel character should appear and start animating

The character will show different animations based on what Kiro is doing — reading files, writing code, running commands, etc. When Kiro finishes its turn, the character immediately enters a waiting state.

## Disabling the Bridge

To temporarily disable the bridge without removing the hook files, set `"enabled": false` in any of the `.kiro/hooks/pixel-agents-*.kiro.hook` files.

## Resetting a Session

To start fresh with a new pixel character:

```bash
bash scripts/kiro-bridge/pixel-agents-bridge.sh reset
```

This deletes the session tracker and tool state. The next prompt will create a new session and spawn a new character.

## Tool Name Mapping

The bridge translates Kiro tool names to the Claude Code equivalents that Pixel Agents recognizes:

| Kiro Tools | Pixel Agents Label |
|---|---|
| `readFile`, `readCode`, `readMultipleFiles`, `getDiagnostics` | Read |
| `editCode`, `strReplace`, `semanticRename`, `smartRelocate` | Edit |
| `fsWrite`, `fsAppend`, `deleteFile` | Write |
| `executeBash` | Bash |
| `fileSearch`, `listDirectory` | Glob |
| `grepSearch` | Grep |
| `remote_web_search`, `webFetch` | WebFetch |
| `invokeSubAgent` | Task |

Unknown tools pass through with their original name — the character still animates, just without a specific label.

**Note:** Kiro's `runCommand` hooks don't currently pass tool context to the command, so the bridge can't determine which specific tool is being used. The character will show "Working" as a generic status instead of tool-specific labels like "Reading src/main.ts". If Kiro adds tool context support to `runCommand` hooks in the future, the bridge is already wired up to use it (via the `$2` argument).

## Running Tests

```bash
# TypeScript property tests
npm test

# Shell bridge tests
bash scripts/kiro-bridge/__tests__/test-tracker-roundtrip.sh
bash scripts/kiro-bridge/__tests__/test-no-stdin-hang.sh
bash scripts/kiro-bridge/__tests__/test-session-roundtrip.sh
bash scripts/kiro-bridge/__tests__/test-reset-new-session.sh
bash scripts/kiro-bridge/__tests__/test-agent-stop-cleanup.sh
```

## Troubleshooting

**No character appears** — Check that the Pixel Agents panel is open and the hooks are enabled. Look for `.jsonl` files in `~/.claude/projects/` to verify the bridge is writing records.

**Character doesn't animate on tool use** — The `preToolUse`/`postToolUse` hooks only fire for `read`, `write`, and `shell` tool types. Web searches, sub-agent invocations via MCP, and other tool categories won't trigger animations unless you expand the `toolTypes` filter.

**Character stays active after Kiro finishes** — Make sure the `pixel-agents-agent-stop.kiro.hook` is enabled. The `agentStop` hook is what tells the character to enter waiting state.

**Multiple characters for the same session** — Run `bash scripts/kiro-bridge/pixel-agents-bridge.sh reset` to clear the session and start fresh.
