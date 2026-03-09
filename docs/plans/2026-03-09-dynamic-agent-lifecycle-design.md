# Dynamic Agent Lifecycle — Design

## Problem

Pixel Agents only detects Claude Code sessions running in VS Code integrated terminals
within the current workspace. This misses:

1. **Subagent sessions** — Agent tool spawns write to `<session>/subagents/*.jsonl`
2. **External sessions** — `claude -p` subprocess calls (e.g., Security Analyst bots)
3. **Cross-workspace sessions** — Claude Code in other project directories

Result: The office feels empty even when many agents are actively working.

## Solution: Global Session Discovery + Headless Agents

### Core Idea

Scan ALL directories under `~/.claude/projects/` for active JSONL files.
Sessions without a VS Code terminal become "headless agents" — visible characters
that work, type, and react, but cannot be focused to a terminal.

### Architecture Changes

#### 1. AgentState (types.ts)

```typescript
terminalRef?: vscode.Terminal;  // optional (was required)
isHeadless?: boolean;           // true for non-terminal agents
sourceDir?: string;             // which project dir this came from
```

#### 2. Global Scanner (fileWatcher.ts)

- `ensureGlobalScan()` — scans `~/.claude/projects/*/` for active JONLs
- Recursive: also scans `<session-uuid>/subagents/*.jsonl`
- Smart filter: only JONLs actively growing (modified <10min, >3KB)
- Single shared interval timer for all directories

#### 3. Headless Agent Manager (agentManager.ts)

- `addHeadlessAgent(jsonlFile, projectDir)` — creates agent without terminal
- Focus action: opens JSONL file in editor (read-only)
- Auto-despawn: 5 minutes without JSONL growth → remove agent

#### 4. Lifecycle

| Event | Action |
|-------|--------|
| New active JSONL found | Spawn agent (matrix effect) |
| JSONL stops growing (5min) | Despawn agent (matrix effect) |
| Terminal closed | Despawn immediately |
| Subagent JSONL appears | Spawn as sub-character |

### Files Changed

| File | Change |
|------|--------|
| `src/types.ts` | `terminalRef` optional, `isHeadless` flag |
| `src/constants.ts` | Timeout constants |
| `src/fileWatcher.ts` | Global scan, subagent scan |
| `src/agentManager.ts` | `addHeadlessAgent()`, headless focus |
| `src/PixelAgentsViewProvider.ts` | Global scan init, auto-despawn |

### What Stays the Same

- Webview rendering (already agent-type agnostic)
- Character state machine (IDLE/WALK/TYPE)
- Tool event parsing (transcriptParser.ts)
- Subagent character spawning (already works via `Subtask:` prefix)
