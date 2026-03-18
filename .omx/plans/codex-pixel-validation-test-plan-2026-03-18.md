# Codex Pixel Visualization Validation Test Plan

Date: 2026-03-18
Scope: Verify that this repo can observe Codex session activity and render it as pixel-agent behavior in the VS Code webview.

## Requirements Summary
- Validate the end-to-end path from Codex JSONL/session discovery to webview messages and pixel-character state updates.
- Review the recent Codex-focused PRs merged on 2026-03-17/18 (#1-#8).
- Confirm both functional behavior and current gaps before claiming Codex support.

## Recent PRs in Scope
- PR #1: Adapter Pattern Interface — https://github.com/DavidUmKongs/oh-my-pixel-agents/pull/1
- PR #2: Paths and Terminal commands — https://github.com/DavidUmKongs/oh-my-pixel-agents/pull/2
- PR #3: JSONL Parsing logic — https://github.com/DavidUmKongs/oh-my-pixel-agents/pull/3
- PR #4: File watching logic — https://github.com/DavidUmKongs/oh-my-pixel-agents/pull/4
- PR #5: UI and Metadata Updates — https://github.com/DavidUmKongs/oh-my-pixel-agents/pull/5
- PR #6: Agent type setting — https://github.com/DavidUmKongs/oh-my-pixel-agents/pull/6
- PR #7: Codex auto launch — https://github.com/DavidUmKongs/oh-my-pixel-agents/pull/7
- PR #8: Remove unused imports — https://github.com/DavidUmKongs/oh-my-pixel-agents/pull/8

## Code Paths Under Test
- Codex session launch/path setup: `src/agentManager.ts:20-27`, `src/agentManager.ts:30-137`, `src/constants.ts:29-35`
- Workspace-relevant JSONL discovery and watching: `src/fileWatcher.ts:98-180`, `src/fileWatcher.ts:182-258`
- Codex transcript parsing: `src/transcriptParser.ts:19-72`, `src/transcriptParser.ts:87-136`
- Webview message handling and sub-agent creation: `webview-ui/src/hooks/useExtensionMessages.ts:197-365`
- Pixel behavior/animation state: `webview-ui/src/office/toolUtils.ts:1-23`, `webview-ui/src/office/engine/characters.ts:17-23`, `webview-ui/src/office/engine/officeState.ts:519-606`
- Extension host/dev harness: `src/PixelAgentsViewProvider.ts:74-167`, `.vscode/launch.json:1-20`, `.vscode/tasks.json:6-70`

## Current Known Gaps / Risks to Verify Explicitly
- `pixel-agents.agentType` exists in `package.json:50-67` but is not read anywhere else.
- `AgentAdapter` exists in `src/agentAdapter.ts:1-29` but is not wired into runtime flow.
- README and some message names still reference Claude (`README.md:29`, `README.md:52-77`, `src/PixelAgentsViewProvider.ts:80`, `webview-ui/src/hooks/useEditorActions.ts:106-108`).
- Existing automated coverage is minimal; only `webview-ui/test/dev-assets.test.ts` exists and does not validate Codex transcript parsing.

## Acceptance Criteria
1. A new Codex session created from the extension appears as one pixel character in the panel.
2. The extension discovers the correct `~/.codex/sessions/**.jsonl` file for the active workspace and ignores foreign workspaces.
3. Codex `function_call` events produce correct overlay text and typing/reading/running animation changes.
4. Codex `function_call_output` clears active tool indicators without leaving stale state.
5. Codex `agent_message` / idle heuristics transition the character to waiting state and show the waiting bubble.
6. Subtasks spawned through `Task`/`Agent` create sub-agent characters and clear them on completion.
7. Permission-wait heuristics show and clear approval bubbles correctly for parent and sub-agent tools.
8. Terminal close, `/clear`/session reassignment, and workspace restore do not orphan characters or bind the wrong transcript.
9. Documentation/UI findings are explicitly recorded if support is functionally present but still branded or configured incorrectly.

## Test Stages

### Stage 0 — Baseline environment
- Run `npm ci` at repo root and `cd webview-ui && npm ci`.
- Then run:
  - `npm run check-types`
  - `npm run lint`
  - `cd webview-ui && npm test`
- Record baseline because current checkout without dependencies cannot run these commands locally.

### Stage 1 — PR review to test mapping
- PR #1 → architecture smoke check: confirm adapter abstraction exists but is not runtime-integrated.
- PR #2/#7 → launch/path checks: verify terminal naming, `codex --session-id`, expected JSONL path assumptions.
- PR #3 → parser matrix: enumerate supported Codex event types and unsupported ones.
- PR #4 → watcher/reassignment checks: verify recursive scan and `session_meta.cwd` filtering.
- PR #5/#6 → UX/config checks: verify whether UI/config truly reflects backend selection.
- PR #8 → sanity pass only; no behavior target.

### Stage 2 — Synthetic parser tests (recommended first automation work)
Add fixture-driven tests around `processTranscriptLine` with representative Codex JSONL lines for:
- `response_item/function_call` for `read_file`, `shell_command`, `apply_patch`, `web_search_call`, `request_user_input`
- `response_item/function_call_output`
- `event_msg/agent_message`
- malformed JSON / unknown payloads
- mixed parent/sub-agent tool sequences
Expected assertions:
- webview messages emitted
- `activeToolIds`, `activeToolNames`, `activeSubagentToolIds` mutate correctly
- waiting/permission timer triggers are requested only when appropriate

### Stage 3 — Watcher and workspace tests
Use temporary fixture directories to simulate `~/.codex/sessions/YYYY/MM/DD/*.jsonl` trees.
Scenarios:
- relevant workspace file is discovered from `session_meta.cwd`
- unrelated workspace file is ignored
- late file creation after terminal spawn is picked up
- new JSONL causes reassignment/adoption behavior only for the active terminal path
- recursive scanning handles date-based subdirectories

### Stage 4 — Manual Extension Development Host validation
- Start `watch` task and launch `.vscode/launch.json` F5 config.
- Open Pixel Agents panel.
- Spawn a Codex agent via `+ Agent`.
- Exercise one prompt each for: file read, patch/apply_patch, shell command, web search, request for user input, and sub-agent delegation.
- Capture screenshots/GIFs and console logs for each transition.
Manual checkpoints:
- overlay text matches tool intent
- typing vs reading vs running motion is visually correct
- waiting/permission bubbles appear/disappear on time
- sub-agent character spawns near parent and is removed cleanly
- closing terminal removes pixel agent

### Stage 5 — Browser/webview-only visual sanity
Use the mocked browser flow where useful:
- run `Mocked Pixel Agent Dev Server` task or `cd webview-ui && npm run dev`
- validate assets load and the office renders correctly
- optional: inject mocked extension messages to confirm overlay text and sprite state changes independent of VS Code host

### Stage 6 — Cross-session regression pass
- restore agents after reloading the Extension Development Host
- multi-root workspace folder selection from `+ Agent`
- verify no cross-workspace transcript leakage
- verify stale permission bubbles/tool rows are cleared after turn end or transcript completion

## Evidence to Collect
- Exact PR reviewed and file/line references
- Terminal output / webview console logs
- 1 screenshot or GIF per major state: active tool, approval wait, waiting, sub-agent active, cleanup
- Pass/fail matrix against acceptance criteria
- A short “support verdict”:
  - Supported now
  - Partially supported / behind gaps
  - Not yet supported

## Risks and Mitigations
- Risk: no Codex parser tests today. Mitigation: add fixture-driven transcript tests before manual sign-off.
- Risk: `agentType` setting is misleading. Mitigation: treat current verification as Codex-specific runtime validation, not multi-backend validation.
- Risk: adapter abstraction is incomplete. Mitigation: document that PR #1 is preparatory, not proof of interchangeable backends.
- Risk: Linux/macOS watcher behavior may differ from Windows README assumptions. Mitigation: include watcher checks on current Linux environment.

## Verification Steps
1. Install deps and record baseline quality checks.
2. Execute synthetic transcript tests.
3. Execute watcher/workspace fixture tests.
4. Run manual Extension Development Host scenario.
5. Fill pass/fail matrix against acceptance criteria.
6. Publish final verdict with screenshots, logs, and any blocking gaps.
