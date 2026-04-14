# Pixel Agents Multi-Provider Design

## Goal

Make this fork of Pixel Agents work with both Claude Code and Codex without degrading the current Claude experience.

The first supported Codex experience must match the current Claude flow:

1. The user selects a provider in the Pixel Agents toolbar.
2. Clicking `+ Agent` opens a new terminal for that provider.
3. A character is created immediately.
4. Pixel Agents tracks live work, waiting, permission prompts, turn completion, and subagents with high reliability.

## Product Decisions

### In scope for Codex v1

- Multi-provider architecture, not a Codex-only fork.
- A toolbar provider switcher visible directly in the Pixel Agents UI.
- A per-project default provider persisted in workspace state.
- A global list of enabled providers managed from Pixel Agents settings.
- Explicit terminal naming by provider, for example `Claude Code #1` and `Codex #1`.
- High-parity Codex support for:
  - launching a new session
  - live activity updates
  - waiting-for-input
  - permission-required states
  - turn completion
  - subagent visualization

### Out of scope for Codex v1

- A dedicated `Attach` button in the UI.
- General support for every future provider.
- Accepting degraded Codex support based only on heuristic terminal scraping.
- Replacing the current Claude behavior with a fully rewritten runtime.

### Planned next step after Codex v1

- Add external-session discovery and attach for Codex using the same architecture already used for Claude `isExternal` sessions.

## UX Design

### Provider selection

- Pixel Agents settings control which providers are enabled globally.
- The bottom toolbar shows a provider selector before `+ Agent`.
- The selected toolbar value becomes the default provider for the current workspace/project.
- `+ Agent` always uses the current toolbar selection.

### Agent naming

- Agent labels and terminal names remain provider-specific.
- Examples:
  - `Claude Code #1`
  - `Codex #1`

This keeps the office readable when a project mixes providers.

## Architecture

### 1. Provider adapter layer

Introduce a provider registry and an adapter contract so the rest of Pixel Agents stops hardcoding Claude assumptions.

Each provider adapter must declare:

- provider metadata
- launch behavior
- terminal naming
- whether it supports transcripts
- whether it supports hooks or an equivalent event transport
- whether external session discovery is supported

Representative shape:

```ts
export interface ProviderAdapter {
  id: 'claude' | 'codex';
  displayName: string;
  terminalLabel(index: number): string;
  launch(input: LaunchRequest): Promise<LaunchedSession>;
  supportsExternalDiscovery: boolean;
}
```

### 2. Normalized lifecycle events

Pixel Agents should consume provider-neutral lifecycle events instead of provider-native payloads.

Canonical internal events:

- `sessionStarted`
- `sessionEnded`
- `toolStarted`
- `toolFinished`
- `waitingForInput`
- `permissionRequested`
- `permissionCleared`
- `turnCompleted`
- `subagentStarted`
- `subagentStopped`

The office UI, overlays, sounds, and agent state updates continue to run on these canonical events.

### 3. Claude adapter extraction

Claude remains the reference implementation for the first adapter.

The current behavior in:

- `src/agentManager.ts`
- `src/fileWatcher.ts`
- `server/src/hookEventHandler.ts`
- `server/src/providers/file/claudeHookInstaller.ts`

should be extracted behind a Claude adapter without behavior changes before Codex is introduced.

### 4. Codex adapter

Codex must plug into the same contract as Claude.

The preferred control plane for Codex is `codex app-server`, because the official protocol provides structured thread, turn, item, diff, approval, and subagent-related events. It is a better fit for the required quality bar than terminal-text heuristics.

Important official capabilities already documented by OpenAI:

- `thread/start`, `thread/resume`, and `thread/fork`
- `turn/start`, `turn/completed`, `turn/diff/updated`
- `item/started`, `item/completed`, and agent-message deltas
- approval events for command execution, file changes, and tool input
- source kinds including `subAgent`

The unresolved implementation detail is transport ownership:

- validate whether Pixel Agents can own a Codex app-server session while still launching a user-visible Codex terminal experience
- if that path is not viable, validate Codex hooks as the fallback event source
- terminal scraping alone is not an acceptable primary source for Codex v1

## State Model Changes

### Agent state

`AgentState` should treat `providerId` as first-class state, not an optional afterthought.

Needed additions or cleanups:

- `providerId` required on all agents
- provider-aware persisted terminal names
- provider-aware restoration rules
- provider-aware external-session handling

### Settings and persistence

- Global settings/config:
  - `enabledProviders`
- Workspace/project state:
  - `defaultProvider`

The provider choice must round-trip between extension host and webview in the same way that sound, hooks, and session scanning already do.

## Quality Bar

Codex is not considered supported until all of the following are true:

- `+ Agent` reliably launches a new Codex-backed agent
- the office shows active work without major state drift
- waiting and permission prompts are driven by structured provider events
- turn completion is not inferred only from idle timers
- subagents appear and clear correctly
- existing Claude behavior remains green in regression tests

## Delivery Strategy

1. Add provider model and persistence.
2. Extract Claude into an explicit adapter without changing behavior.
3. Add the toolbar provider switcher and generic `openAgent` flow.
4. Implement the Codex adapter behind a feature flag while transport is validated.
5. Enable Codex by default only after launch and lifecycle parity are verified.

## Risks

### Transport risk

Codex parity depends on a structured event source. If app-server ownership and the terminal UX cannot coexist cleanly, the team must stop and resolve transport before broader refactors continue.

### Regression risk

The current code has Claude-specific assumptions in constants, message names, session scanning, and hook installation. Extracting the adapter in small steps is mandatory to avoid breaking the existing provider.

### Test coverage risk

Current tests are strong on server-side Claude hooks and minimal on webview/provider selection. Codex work must add launch-path and provider-selection coverage, not only server tests.
