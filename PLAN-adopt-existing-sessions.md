# Plan: Auto-Adopt Already-Running Claude Code Sessions

## Context

When Pixel Agents starts (or the webview becomes ready), `ensureProjectScan()` in `src/fileWatcher.ts` seeds `knownJsonlFiles` with **all** existing JSONL files in the project directory. This means any Claude Code session that was already running — whether from the official Claude Code VS Code extension or a terminal started before Pixel Agents loaded — is immediately marked as "known" and never adopted. The scanner only detects **new** files appearing after startup.

This PR adds a one-time startup scan that identifies recently-active JSONL files and pairs them with unowned Claude terminals, so Pixel Agents automatically picks up sessions that are already running.

## Approach

Add an `adoptExistingSessions()` function that runs once at startup, **before** seeding `knownJsonlFiles`. It:

1. Reads all `.jsonl` files in the project directory
2. Filters to files modified within the last 30 seconds (active sessions)
3. Excludes files already owned by restored agents
4. Enumerates `vscode.window.terminals` for unowned terminals whose name contains "claude" (case-insensitive) — this matches both Pixel Agents terminals ("Claude Code #N") and the official extension ("Claude Code")
5. Pairs active files with unowned Claude terminals (sorted by most recent mtime)
6. Calls the existing `adoptTerminalForFile()` for each pair

Unpaired active files (more sessions than terminals) are placed in an `adoptableFiles` set. The ongoing `scanForNewJsonlFiles()` loop checks this set each tick — when an unowned Claude terminal gets focused, it adopts the most recent adoptable file.

## Files Modified

### 1. `src/constants.ts`
Add one constant:
```typescript
export const ACTIVE_SESSION_THRESHOLD_MS = 30_000;
```

### 2. `src/fileWatcher.ts` — Primary changes

- **`isClaudeTerminal()`** — new exported helper that checks if a terminal name contains "claude" (case-insensitive). Used for prioritization, not as a hard filter.
- **`adoptExistingSessions()`** — new function that runs once at startup to find active JSONL files and pair them with unowned terminals. Prefers Claude-named terminals but falls back to any unowned terminal (since manually opened terminals are named "zsh"/"bash", not "Claude Code").
- **`ensureProjectScan()`** — updated signature to accept `adoptableFiles` parameter; calls `adoptExistingSessions()` before seeding; skips adoptable files when seeding `knownJsonlFiles`
- **`scanForNewJsonlFiles()`** — updated to check `adoptableFiles` set each tick; adopts the most-recently-modified adoptable file when any unowned terminal is focused

### 3. `src/PixelAgentsViewProvider.ts`
- Add `adoptableFiles = new Set<string>()` class member
- Thread `this.adoptableFiles` into `ensureProjectScan()` calls

### 4. `src/agentManager.ts`
- Thread `adoptableFiles` parameter through `launchNewTerminal()` and `restoreAgents()` into their calls to `ensureProjectScan()`

## Edge Cases

- **No active sessions at startup**: `adoptExistingSessions()` finds nothing, behavior identical to today
- **Session ends after adoption**: Normal flow — `turn_duration`/idle timers mark agent waiting, terminal close triggers cleanup
- **Race with `restoreAgents()`**: `restoreAgents()` runs first in the `webviewReady` handler, so restored agents' files and terminals are already claimed before adoption runs
- **Adopted agent reads full history**: `adoptTerminalForFile()` sets `fileOffset: 0`, replaying the entire transcript to reconstruct current tool state
- **Multiple sessions, fewer terminals**: Extra sessions go into `adoptableFiles`, adopted later when a terminal is focused
- **`adoptableFiles` cleanup**: Stale entries removed when `statSync` throws during the scan loop; the set is garbage-collected on extension dispose

## Verification

1. `npm run build` — ensure no type errors
2. F5 launch Extension Dev Host:
   - **Test A**: Open a terminal manually, run `claude`, then open Pixel Agents panel → agent should appear
   - **Test B**: Have the Claude Code VS Code extension running with an active session, then open Pixel Agents panel → agent should appear
   - **Test C**: Start Pixel Agents with no active sessions → behavior unchanged from today
   - **Test D**: Use "+ Agent" button → still works as before (regression check)
   - **Test E**: `/clear` in an adopted terminal → reassignment still works
