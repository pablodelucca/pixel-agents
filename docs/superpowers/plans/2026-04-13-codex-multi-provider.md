# Codex Multi-Provider Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-provider architecture that preserves current Claude behavior and introduces a high-parity Codex launch flow inside Pixel Agents.

**Architecture:** Introduce a provider registry plus adapter contract in the extension host, normalize provider lifecycle events before they reach the office UI, and keep the webview consuming the same canonical agent messages it already understands. Extract the existing Claude implementation first, then add Codex on top of the same contract with an explicit transport validation step.

**Tech Stack:** TypeScript, VS Code Extension API, React 19, Vitest, Playwright, Claude Code CLI, Codex CLI, Codex app-server

---

### Task 1: Introduce provider domain model and persistence

**Files:**

- Create: `src/providers/providerTypes.ts`
- Create: `src/providers/providerRegistry.ts`
- Create: `server/__tests__/providerRegistry.test.ts`
- Modify: `src/constants.ts`
- Modify: `src/types.ts`
- Modify: `src/configPersistence.ts`
- Modify: `src/PixelAgentsViewProvider.ts`

- [x] **Step 1: Write the failing provider-registry test**

```ts
import { describe, expect, it } from 'vitest';
import { getEnabledProviders, getProviderById } from '../../src/providers/providerRegistry.js';

describe('providerRegistry', () => {
  it('returns claude and codex in stable toolbar order', () => {
    expect(getEnabledProviders(['claude', 'codex']).map((p) => p.id)).toEqual(['claude', 'codex']);
    expect(getProviderById('claude')?.displayName).toBe('Claude Code');
    expect(getProviderById('codex')?.displayName).toBe('Codex');
  });
});
```

- [x] **Step 2: Run the new test to verify it fails**

Run: `cd server && npm test -- providerRegistry.test.ts`
Expected: FAIL because the provider registry does not exist yet.

- [x] **Step 3: Add the provider model**

Implement a shared provider type with at least:

```ts
export type ProviderId = 'claude' | 'codex';

export interface ProviderDescriptor {
  id: ProviderId;
  displayName: string;
  terminalPrefix: string;
  supportsExternalDiscovery: boolean;
  supportsStructuredEvents: boolean;
}
```

- [x] **Step 4: Thread provider state through extension persistence**

Add:

- `enabledProviders` to `src/configPersistence.ts`
- workspace key(s) for `defaultProvider`
- required `providerId` on `AgentState` and `PersistedAgent`

- [x] **Step 5: Run validation**

Run:

- `cd server && npm test -- providerRegistry.test.ts`
- `npm run check-types`

Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/providers/providerTypes.ts src/providers/providerRegistry.ts src/constants.ts src/types.ts src/configPersistence.ts src/PixelAgentsViewProvider.ts server/__tests__/providerRegistry.test.ts
git commit -m "refactor: add provider registry and persistence model"
```

### Task 2: Add provider selector UX and generic launch message

**Files:**

- Modify: `webview-ui/src/components/BottomToolbar.tsx`
- Modify: `webview-ui/src/components/SettingsModal.tsx`
- Modify: `webview-ui/src/hooks/useExtensionMessages.ts`
- Modify: `webview-ui/src/App.tsx`
- Modify: `src/PixelAgentsViewProvider.ts`

- [x] **Step 1: Add UI state for enabled providers and default provider**

Update `settingsLoaded` handling so the webview receives:

```ts
{
  enabledProviders: ['claude', 'codex'],
  defaultProvider: 'claude'
}
```

- [x] **Step 2: Replace the Claude-only toolbar action with a provider-aware launch flow**

Change the webview message from:

```ts
{
  type: ('openClaude', bypassPermissions);
}
```

to:

```ts
{ type: 'openAgent', providerId: selectedProvider, bypassPermissions }
```

- [x] **Step 3: Add the visible provider switcher before `+ Agent`**

The switcher must:

- show only enabled providers
- persist the selected value per workspace/project
- leave `+ Agent` behavior unchanged except for provider selection

- [x] **Step 4: Add provider management to Settings**

Expose enabled-provider toggles in `SettingsModal` without forcing the user to re-enter settings to switch between Claude and Codex.

- [x] **Step 5: Validate manually and with typecheck**

Run:

- `npm run check-types`
- `npm run lint`

Expected: PASS

Note: automated verification passed on 2026-04-13 via `node --import tsx/esm --test test/providerUi.test.ts`, `npm test -- providerPreferences.test.ts`, `npm run check-types`, and `npm run lint`. Interactive browser validation was attempted through Vite, but the local browser helper was unavailable in this session.

- [ ] **Step 6: Commit**

```bash
git add webview-ui/src/components/BottomToolbar.tsx webview-ui/src/components/SettingsModal.tsx webview-ui/src/hooks/useExtensionMessages.ts webview-ui/src/App.tsx src/PixelAgentsViewProvider.ts
git commit -m "feat: add provider switcher and generic launch message"
```

### Task 3: Extract the current Claude flow into an explicit adapter

**Files:**

- Create: `src/providers/claude/claudeProvider.ts`
- Modify: `src/agentManager.ts`
- Modify: `src/fileWatcher.ts`
- Modify: `src/PixelAgentsViewProvider.ts`
- Modify: `src/constants.ts`
- Modify: `server/src/providers/file/claudeHookInstaller.ts`
- Modify: `e2e/tests/agent-spawn.spec.ts`

- [x] **Step 1: Write an adapter contract test around Claude naming and launch parameters**

Add or extend the existing spawn coverage so the expected terminal label remains:

```ts
expect(terminalName).toMatch(/^Claude Code #\d+$/);
```

- [x] **Step 2: Move Claude-specific terminal naming and launch command into the adapter**

The adapter should own:

- terminal prefix
- CLI command string
- transcript root discovery
- hook installer wiring

- [x] **Step 3: Remove global Claude-only assumptions from extension control flow**

Replace broad constants like `TERMINAL_NAME_PREFIX = 'Claude Code'` with adapter lookups.

- [x] **Step 4: Keep webview messages canonical**

Do not create provider-specific UI message names beyond launch/config. Internal runtime messages like `agentToolStart` and `agentStatus` must remain shared.

- [x] **Step 5: Run regression checks**

Run:

- `npm run check-types`
- `npm run test:server`
- `npm run e2e -- --grep "mock claude"`

Expected: PASS, with no Claude behavior change.

- [ ] **Step 6: Commit**

```bash
git add src/providers/claude/claudeProvider.ts src/agentManager.ts src/fileWatcher.ts src/PixelAgentsViewProvider.ts src/constants.ts server/src/providers/file/claudeHookInstaller.ts e2e/tests/agent-spawn.spec.ts
git commit -m "refactor: extract claude provider adapter"
```

### Task 4: Normalize provider lifecycle events before they hit the office UI

**Files:**

- Create: `server/src/providerEventRouter.ts`
- Create: `server/__tests__/providerEventRouter.test.ts`
- Modify: `server/src/hookEventHandler.ts`
- Modify: `src/PixelAgentsViewProvider.ts`
- Modify: `src/types.ts`

- [x] **Step 1: Write the failing event-router test**

Test that provider-native events map to canonical UI actions:

```ts
expect(events).toContainEqual({ type: 'permissionRequested', agentId: 1 });
expect(events).toContainEqual({ type: 'turnCompleted', agentId: 1 });
```

- [x] **Step 2: Introduce a canonical event shape**

Add a provider-neutral event union:

```ts
type ProviderLifecycleEvent =
  | { type: 'permissionRequested'; agentId: number }
  | { type: 'waitingForInput'; agentId: number }
  | { type: 'turnCompleted'; agentId: number }
  | { type: 'toolStarted'; agentId: number; toolId: string; toolName: string; status: string };
```

- [x] **Step 3: Route Claude hook events through the new router**

`HookEventHandler` should emit canonical lifecycle events rather than writing webview messages directly whenever possible.

- [x] **Step 4: Keep the current webview contract stable**

The router may still translate canonical events into existing messages such as:

- `agentToolPermission`
- `agentStatus`
- `agentToolStart`
- `subagentToolStart`

- [x] **Step 5: Run tests**

Run:

- `cd server && npm test -- providerEventRouter.test.ts hookEventHandler.test.ts`
- `npm run check-types`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/providerEventRouter.ts server/__tests__/providerEventRouter.test.ts server/src/hookEventHandler.ts src/PixelAgentsViewProvider.ts src/types.ts
git commit -m "refactor: normalize provider lifecycle events"
```

### Task 5: Validate the Codex transport and create test fixtures

**Files:**

- Create: `scripts/codex-app-server-smoke.ts`
- Create: `server/__tests__/codexAppServerClient.test.ts`
- Create: `e2e/fixtures/mock-codex`
- Create: `e2e/fixtures/mock-codex.cmd`
- Modify: `e2e/helpers/launch.ts`

- [x] **Step 1: Write a failing transport test around Codex app-server notifications**

Model the minimum stream needed for v1:

```ts
[
  { method: 'thread/started', params: { thread: { id: 'thr_1' } } },
  { method: 'turn/started', params: { turn: { id: 'turn_1', status: 'inProgress' } } },
  { method: 'item/commandExecution/requestApproval', params: { itemId: 'cmd_1' } },
  { method: 'turn/completed', params: { turn: { id: 'turn_1', status: 'completed' } } },
];
```

- [x] **Step 2: Build a small smoke script for local transport validation**

The script should prove that Pixel Agents can:

- start `codex app-server`
- initialize a session
- read structured notifications

- [x] **Step 3: Add Codex mock binaries for e2e**

Mirror the Claude fixture strategy:

- log invocations
- create any expected local state needed by the launch test
- avoid using the real Codex CLI in CI

- [x] **Step 4: Update the e2e launcher to inject both provider mocks**

The test harness should be able to resolve either `claude` or `codex` depending on the selected provider.

- [x] **Step 5: Run validation**

Run:

- `cd server && npm test -- codexAppServerClient.test.ts`
- `npm run check-types`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/codex-app-server-smoke.ts server/__tests__/codexAppServerClient.test.ts e2e/fixtures/mock-codex e2e/fixtures/mock-codex.cmd e2e/helpers/launch.ts
git commit -m "test: add codex transport smoke checks and fixtures"
```

### Task 6: Implement the Codex provider launch path

**Files:**

- Create: `src/providers/codex/codexProvider.ts`
- Create: `src/providers/codex/codexLaunch.ts`
- Modify: `src/agentManager.ts`
- Modify: `src/PixelAgentsViewProvider.ts`
- Modify: `src/types.ts`
- Create: `e2e/tests/codex-agent-spawn.spec.ts`

- [x] **Step 1: Write the failing Codex spawn e2e**

The test should assert:

- the `codex` mock was invoked
- a `Codex #1` terminal appears
- an agent character is created

- [x] **Step 2: Implement provider-aware terminal creation**

Codex launch must own:

- terminal name generation
- provider-specific command string
- session bootstrap metadata

- [x] **Step 3: Persist provider identity on launch and restore**

Ensure restored agents keep `providerId: 'codex'` and never fall back to Claude naming logic.

- [x] **Step 4: Keep Codex behind a temporary enable flag until lifecycle mapping lands**

Expose it only when enabled in settings and when transport initialization succeeds.

Note: this landed through provider enablement/settings and is no longer a blocking temporary gate because lifecycle mapping is now implemented.

- [x] **Step 5: Run validation**

Run:

- `npm run check-types`
- `npm run e2e -- --grep "codex"`

Expected: PASS for launch and terminal naming.

- [ ] **Step 6: Commit**

```bash
git add src/providers/codex/codexProvider.ts src/providers/codex/codexLaunch.ts src/agentManager.ts src/PixelAgentsViewProvider.ts src/types.ts e2e/tests/codex-agent-spawn.spec.ts
git commit -m "feat: add codex launch provider"
```

### Task 7: Map Codex structured events to Pixel Agents runtime states

**Files:**

- Create: `server/src/providers/codex/codexAppServerClient.ts`
- Create: `server/src/providers/codex/codexEventMapper.ts`
- Create: `server/__tests__/codexEventMapper.test.ts`
- Modify: `server/src/providerEventRouter.ts`
- Modify: `src/PixelAgentsViewProvider.ts`

- [x] **Step 1: Write failing mapper tests for the v1 quality bar**

Cover at least:

- `turn/completed` -> waiting/turn complete
- approval events -> permission bubble
- command/file-change items -> active tool status
- `subAgent`-sourced items -> subagent start/stop

- [x] **Step 2: Implement a typed Codex app-server client**

Read JSON-RPC notifications and expose typed callbacks for:

- thread lifecycle
- turn lifecycle
- item lifecycle
- approval requests

- [x] **Step 3: Map Codex item types into the existing office semantics**

Examples:

- command execution -> `Bash`-like tool overlay
- file change -> write/edit animation
- tool call -> tool overlay text
- subagent-related source kinds -> subagent characters

- [x] **Step 4: Wire the Codex provider into the shared router**

The webview must continue to receive the same canonical runtime messages already used by Claude.

- [x] **Step 5: Run validation**

Run:

- `cd server && npm test -- codexEventMapper.test.ts codexAppServerClient.test.ts providerEventRouter.test.ts`
- `npm run check-types`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/providers/codex/codexAppServerClient.ts server/src/providers/codex/codexEventMapper.ts server/__tests__/codexEventMapper.test.ts server/src/providerEventRouter.ts src/PixelAgentsViewProvider.ts
git commit -m "feat: map codex events into pixel agents lifecycle"
```

### Task 8: Finish docs, regressions, and release gating

**Files:**

- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `CHANGELOG.md`
- Create: `e2e/tests/provider-switcher.spec.ts`
- Modify: `e2e/tests/agent-spawn.spec.ts`

- [x] **Step 1: Add the failing provider-switcher e2e**

Test:

- switch from Claude to Codex in the toolbar
- spawn one of each
- verify terminal names and provider persistence behavior

- [x] **Step 2: Update README prerequisites and usage**

Document:

- Codex CLI installation and authentication
- provider switcher behavior
- Codex v1 limitations

- [x] **Step 3: Update contributor docs**

Document:

- provider architecture
- mock fixtures for both CLIs
- required regression matrix before merging

- [x] **Step 4: Run the full validation suite**

Run:

- `npm run check-types`
- `npm run lint`
- `npm run test`
- `npm run e2e`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md CONTRIBUTING.md CHANGELOG.md e2e/tests/provider-switcher.spec.ts e2e/tests/agent-spawn.spec.ts
git commit -m "docs: ship codex multi-provider support"
```

## Exit Criteria

- Claude still passes existing regression coverage.
- The toolbar can switch providers without opening settings.
- The current workspace remembers its default provider.
- `+ Agent` can launch Claude or Codex.
- Codex exposes reliable work, permission, waiting, turn-complete, and subagent states.
- Codex support is documented in `README.md`.

## Deferred Follow-Up

After the work above is stable, implement Codex external-session discovery and attach using the existing `isExternal` model as the starting point.

- Add automatic attach/discovery for other active Codex sessions so Pixel Agents can rehydrate and observe them without a manual spawn from the toolbar.
- Add themeable office avatar packs so the current human sprites can be swapped for alternate icon sets, including sprite themes similar to VS Code icon themes such as `vscode-pokemon`.
