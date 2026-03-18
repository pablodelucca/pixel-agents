# Codex Pixel Visualization Validation Test Plan

Date: 2026-03-18
Repo: `DavidUmKongs/oh-my-pixel-agents`
Goal: Verify whether this fork can represent Codex work as pixel agents, using the most recent merged PRs as the validation scope.

## Requirements Summary

Recent merged PRs define the current Codex path:
- PR #1 (`Phase 0: Adapter Pattern Interface`, merged 2026-03-17) added `AgentAdapter`/`ParsedEvent` as an abstraction layer in `src/agentAdapter.ts`, but the current runtime still appears to use direct Codex-specific logic rather than the adapter interface.
- PR #2 (`Phase 1: Paths and Terminal commands`, merged 2026-03-18) changed terminal launch and session discovery to Codex paths/commands in `src/agentManager.ts` and `src/constants.ts`.
- PR #8 (`Fix/remove unused imports`, merged 2026-03-18) materially expanded Codex behavior: recursive `.jsonl` discovery, workspace `cwd` filtering, Codex transcript parsing, and status-to-animation mapping in `src/fileWatcher.ts`, `src/transcriptParser.ts`, and `webview-ui/src/office/toolUtils.ts`.

## Scope

### In scope
1. Codex terminal launch and expected session path wiring.
2. Recursive discovery of Codex JSONL files under `~/.codex/sessions`.
3. Workspace filtering using `session_meta.payload.cwd`.
4. Mapping Codex transcript events to extension messages and then to pixel animations/overlays.
5. Waiting/permission/subtask visualization.
6. Browser-mock and extension-host verification paths.

### Out of scope
1. Claude compatibility regression testing.
2. Marketplace packaging/publishing.
3. Non-Codex adapter implementations.

## Acceptance Criteria

1. Launching a new agent from the panel starts a terminal named with the Codex prefix and sends `codex --session-id <uuid>` (`src/agentManager.ts:30-67`, `src/constants.ts:29-35`).
2. A matching Codex JSONL file anywhere under `~/.codex/sessions/**` is discovered and attached to the correct workspace only when `session_meta.payload.cwd` matches a current workspace folder (`src/fileWatcher.ts:98-135`, `137-258`).
3. Codex `function_call` and `function_call_output` records create and clear agent tool activity in the UI (`src/transcriptParser.ts:87-128`, `webview-ui/src/hooks/useExtensionMessages.ts:197-230`).
4. Codex `agent_message` or inactivity transitions produce the waiting state/bubble and optional done sound (`src/transcriptParser.ts:130-135`, `webview-ui/src/hooks/useExtensionMessages.ts:252-268`).
5. Tool statuses are converted into expected pixel behaviors/labels for key Codex tools like `read_file`, `apply_patch`, `shell_command`, `web_search_call`, `Agent`, and `request_user_input` (`src/transcriptParser.ts:21-71`, `webview-ui/src/office/toolUtils.ts:1-23`).
6. Subtask-style tool starts render a subagent character when the emitted status starts with `Subtask:` (`webview-ui/src/hooks/useExtensionMessages.ts:210-218`, `webview-ui/src/office/engine/officeState.ts:383-446`).
7. Existing agents restore cleanly after webview reload without losing tool/waiting state (`src/agentManager.ts:199-334`, `336-398`).
8. Any mismatch between configuration/docs and runtime behavior is explicitly logged as a product gap. Current likely gap: `pixel-agents.agentType` exists in `package.json:53-64`, but repo-wide search suggests it is not consumed in runtime code.

## Test Matrix by Recent PR

### PR #1 — Adapter foundation
- **Intent to validate:** whether the new abstraction actually protects Codex support.
- **Checks:**
  - Static review: confirm whether `AgentAdapter` is used by runtime paths.
  - Expected current result: likely **not wired yet**; record as architectural debt, not as a rendering failure.
- **Exit rule:** If adapter is unused, keep validating runtime behavior directly and open a follow-up issue.

### PR #2 — Codex launch/path migration
- **Intent to validate:** the extension can find and follow Codex sessions.
- **Checks:**
  - New panel-launched agent creates terminal and expected JSONL filename.
  - Existing JSONL under nested date folders is still discoverable.
  - Multi-root workspace folder name still appears on the created agent.

### PR #8 — Codex parsing/rendering path
- **Intent to validate:** Codex transcript events become visible pixel actions.
- **Checks:**
  - `function_call` -> active animation + overlay.
  - `function_call_output` -> tool done.
  - `agent_message`/idle -> waiting bubble.
  - `request_user_input` -> waiting wording.
  - `Agent`/`Task` -> subtask label + subagent character.
  - workspace `cwd` mismatch -> ignored JSONL.

## Test Levels

### 1) Environment prep
1. Run `npm ci` at repo root.
2. Run `cd webview-ui && npm ci`.
3. Baseline checks:
   - `npm run check-types`
   - `npm run lint`
   - `cd webview-ui && npm run lint`
   - `npm run build`
   - `cd webview-ui && npm test`

> Current local note: these checks were blocked before install because `tsc` and `tsx` were not available in the session.

### 2) Static validation
1. Confirm code paths for launch/discovery/parser/render:
   - `src/PixelAgentsViewProvider.ts`
   - `src/agentManager.ts`
   - `src/fileWatcher.ts`
   - `src/transcriptParser.ts`
   - `webview-ui/src/hooks/useExtensionMessages.ts`
   - `webview-ui/src/office/toolUtils.ts`
2. Record architectural gaps:
   - unused adapter interface
   - unused `pixel-agents.agentType` setting if still true after re-check
   - any Claude-era names still exposed in UX/docs (`openClaude`, README wording)

### 3) Browser-mock smoke tests
Use existing mock hooks to validate rendering without VS Code:
1. `cd webview-ui && npm run dev`
2. Open local Vite URL.
3. Confirm browser mock initializes and office renders (`webview-ui/src/App.tsx:123-150`, `webview-ui/src/browserMock.ts:184-258`).
4. Run `cd webview-ui && npm test` to verify asset endpoints still work (`webview-ui/test/dev-assets.test.ts:1-103`).

**Expected value:** proves rendering/assets pipeline is healthy, but does **not** prove real Codex transcript ingestion.

### 4) Fixture-driven transcript replay (recommended)
Create temporary Codex JSONL fixtures under a nested `~/.codex/sessions/<date>/` folder and replay them while the extension runs.

#### Fixture A — basic tool lifecycle
- `session_meta` with matching `cwd`
- `response_item/function_call` for `read_file`
- `response_item/function_call_output`
- expected: agent becomes active, shows reading status, then clears tool

#### Fixture B — shell/apply patch/web search
- `shell_command`, `apply_patch`, `web_search_call`
- expected: running/applying/searching overlays map to the right animations

#### Fixture C — waiting state
- `event_msg/agent_message`
- expected: waiting bubble and waiting status after idle window

#### Fixture D — subtask visualization
- `function_call` named `Agent` or `Task` with `description`
- expected: `Subtask:` label and subagent creation

#### Fixture E — cross-workspace rejection
- same event stream but `session_meta.payload.cwd` points to another workspace
- expected: ignored by scan/adoption path

### 5) Extension-host manual E2E with real Codex
1. Press `F5` to open Extension Development Host (`.vscode/launch.json:1-20`).
2. Open Pixel Agents panel and create a new agent.
3. In the spawned terminal, run a repeatable Codex workflow that exercises:
   - file read
   - file edit / patch
   - shell command
   - web search
   - user input wait
   - subtask/agent tool if supported
4. Observe:
   - agent creation/despawn
   - seat assignment and camera focus
   - tool overlay correctness
   - waiting/permission bubbles
   - recovery after panel reload
5. Repeat once with a second workspace folder selected from the toolbar.

## Evidence to Capture

For each test case, save:
1. absolute date/time
2. PR scenario covered (#1 / #2 / #8)
3. transcript snippet or fixture name
4. screenshot/GIF of the pixel state
5. VS Code + OS info
6. pass/fail + observed mismatch

## Risks and Mitigations

1. **Adapter abstraction may be incomplete**
   - Mitigation: treat runtime validation as the source of truth; file follow-up architecture issue separately.
2. **Mock browser path can overstate readiness**
   - Mitigation: require at least one extension-host test with real or replayed Codex JSONL.
3. **Workspace filtering may cause false negatives**
   - Mitigation: explicitly test both matching and mismatching `cwd` fixtures.
4. **Current docs/labels may still say Claude**
   - Mitigation: classify as UX/docs drift, not core rendering failure.

## Verification Steps

A run is considered successful when:
1. All baseline checks pass after dependency install.
2. Browser mock works.
3. Fixture replay proves launch/discovery/parser/render behavior for the 5 core Codex scenarios.
4. At least one real Extension Development Host session shows Codex activity rendered as pixel states.
5. Any remaining failures are categorized as:
   - blocker to Codex support
   - architectural debt
   - docs/UX mismatch

## Recommended Outcome Format

- **Verdict:** Yes / Partial / No
- **Confidence:** High / Medium / Low
- **Blockers:** list
- **Follow-ups:** list with file ownership hints
