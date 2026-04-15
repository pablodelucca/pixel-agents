# Multi-Agent Control Roadmap

## Product Wedge

Shift Pixel Agents from "see what agents are doing" to "operate a team of coding agents."

The product should be framed as:

- The operating system for multiple coding agents
- A supervisor console for assigning, constraining, inspecting, interrupting, and recovering work
- A control layer on top of real agent sessions, not a decorative simulation

The current codebase already has the right base:

- Session lifecycle hooks: `SessionStart`, `SessionEnd`, `Stop`
- Permission signals: `PermissionRequest`, notification hooks, Bash interception
- Existing subagent and tool activity tracking
- A webview UI with agent selection, debug state, and live message transport

That means the next phase should optimize for control, auditability, and bounded delegation, not more visual polish.

## Product Principles

1. One visible session should correspond to one real runtime with an inspectable history.
2. Delegation should be explicit first, autonomous later.
3. Approvals should be first-class operational objects, not incidental bubbles.
4. Every important transition should be replayable from logs.
5. Workspaces should be isolated enough that "assign work" has a concrete execution target.

## V1

### Goal

Turn the extension into a usable single-operator control console for multiple active sessions.

### Primary outcome

A user can assign work, monitor progress, approve risky actions, inspect a full run trail, interrupt stuck work, and recover from common failures without leaving the extension.

### Features

- Task inbox / dispatch board
- Approval center
- Run history with replayable event log
- Session detail drawer
- Basic pause / stop / redirect controls
- Blocked-state detection

### Entities

#### `WorkItem`

Represents manager-assigned work, whether queued or active.

Suggested fields:

- `id`
- `title`
- `goal`
- `acceptanceCriteria: string[]`
- `constraints: string[]`
- `priority`
- `status: queued | dispatching | active | blocked | review | completed | failed | canceled`
- `assignedSessionId?: string`
- `assignedAgentId?: number`
- `briefingId?: string`
- `workspaceAssignmentId?: string`
- `budget?: { maxTurns?: number; maxApprovals?: number; maxRuntimeMs?: number }`
- `createdAt`
- `updatedAt`
- `createdBy`
- `blockedReason?: approval_wait | idle | missing_context | tool_failure | merge_conflict | unknown`

#### `SessionRun`

Represents a concrete execution attempt by an agent session.

Suggested fields:

- `id`
- `sessionId`
- `agentId`
- `providerId`
- `workItemId?: string`
- `status: starting | active | waiting_input | waiting_approval | paused | interrupted | completed | failed | ended`
- `cwd`
- `branch?: string`
- `worktreePath?: string`
- `startedAt`
- `endedAt?: string`
- `lastEventAt`
- `lastToolName?: string`
- `lastStatus?: string`
- `summary?: string`
- `parentSessionRunId?: string`

#### `ApprovalRequest`

Represents a specific elevated action that needs supervision.

Suggested fields:

- `id`
- `sessionRunId`
- `agentId`
- `workItemId?: string`
- `riskLevel: low | medium | high`
- `toolName`
- `command?: string`
- `justification?: string`
- `scope: workspace_write | external_write | network | destructive | unknown`
- `status: pending | approved | denied | expired | superseded`
- `requestedAt`
- `resolvedAt?: string`

#### `RunEvent`

Append-only event trail for replay.

Suggested fields:

- `id`
- `sessionRunId`
- `workItemId?: string`
- `timestamp`
- `type`
- `source: hook | transcript | ui | system`
- `payload`

### State Machines

#### `WorkItem`

`queued -> dispatching -> active -> review -> completed`

Alternative paths:

- `active -> blocked`
- `blocked -> active`
- `active -> failed`
- `active -> canceled`
- `review -> active` for follow-up or rework

Rules:

- A `WorkItem` is `blocked` only when a concrete blocker exists.
- `review` means the session claims task completion and has artifacts or diffs ready for inspection.
- `dispatching` is short-lived and should only cover session selection, workspace assignment, and briefing delivery.

#### `SessionRun`

`starting -> active -> waiting_input | waiting_approval | paused | interrupted | completed | failed | ended`

Rules:

- `waiting_approval` is entered on hook permission events.
- `waiting_input` is entered when the model explicitly asks for user input or is idle after exhausting available work.
- `paused` is a manager action.
- `interrupted` is a manager stop that preserves run history and leaves recovery options open.
- `ended` is terminal/session closure regardless of task outcome.

#### `ApprovalRequest`

`pending -> approved | denied | expired | superseded`

Rules:

- Only one active approval object should exist per concrete action.
- A denied request should mark the run as blocked only if the action was required to continue.
- `superseded` handles retries where the model reformulates the command.

### UI Panels

#### Dispatch Board

Purpose: assign and track work.

Columns:

- Inbox
- Active
- Blocked
- Review
- Done

Card fields:

- task title
- assigned session
- branch/worktree
- last action
- blocker badge
- approval count
- runtime / cost placeholder

Actions:

- assign to session
- reassign
- pause
- interrupt
- open run

#### Approval Center

Purpose: make risky actions a first-class queue.

Row fields:

- agent / session
- task
- risk badge
- tool / command
- justification
- age

Actions:

- approve once
- deny
- take over
- open run context

#### Run Inspector

Purpose: explain exactly what happened.

Tabs:

- Timeline
- Commands
- Files touched
- Diffs
- Events raw

Replay should be event-driven, not screenshot-driven. The user should be able to scrub a run and see state transitions in order.

#### Session Drawer

Purpose: operational control of a live session.

Fields:

- session status
- task assignment
- current workspace
- branch
- last tool
- idle time
- blocker reason
- linked child runs

Actions:

- message session
- interrupt
- pause / resume
- reroute model
- mark blocked
- recover into new run

### Backend Changes

Recommended additions:

- `src/controlStore.ts`
  Stores `WorkItem`, `SessionRun`, `ApprovalRequest`, and current mappings.
- `src/runLogStore.ts`
  Append-only event persistence plus replay queries.
- `src/dispatchManager.ts`
  Handles task assignment, status transitions, and blocked detection.
- `src/approvalManager.ts`
  Materializes approval objects from hook events.
- `src/recoveryManager.ts`
  Encodes restart, resume, reassign, and takeover flows.

Recommended integrations:

- Extend `server/src/hookEventHandler.ts` to emit normalized operational events, not only UI activity updates.
- Extend `src/agentManager.ts` to support session metadata beyond terminal spawn state.
- Extend `webview-ui/src/hooks/useExtensionMessages.ts` to ingest manager entities alongside animation events.

### V1 Non-Goals

- Autonomous swarm behavior
- Automatic task pickup
- Rich topology graph
- Fully automated merge flows
- Complex memory retrieval

## V2

### Goal

Move from multi-session supervision to explicit parent-child orchestration with isolated workspaces.

### Features

- Parent-child session linking
- Child session creation from a task
- Branch / worktree assignment
- Shared briefing packs
- Diff review before merge
- Failure recovery flows

### New Entities

#### `WorkspaceAssignment`

- `id`
- `repoRoot`
- `branch`
- `worktreePath`
- `baseBranch`
- `status: provisioning | ready | dirty | merge_pending | merged | abandoned`
- `assignedSessionRunId?: string`

#### `Briefing`

- `id`
- `title`
- `objective`
- `constraints: string[]`
- `referenceRuns: string[]`
- `referenceFiles: string[]`
- `handoffNotes`
- `version`

#### `Artifact`

- `id`
- `sessionRunId`
- `type: diff | patch | note | file | test_result`
- `label`
- `uri`
- `createdAt`

### State Machines

#### `WorkspaceAssignment`

`provisioning -> ready -> dirty -> merge_pending -> merged`

Alternative paths:

- `dirty -> abandoned`
- `merge_pending -> dirty` if review requests changes

Rules:

- Each active child task should have an isolated branch or worktree unless explicitly shared.
- Merge is a separate review step, not an implicit completion side effect.

#### `ChildRun`

`requested -> starting -> active -> blocked | review | completed | failed`

Rules:

- Child runs must have a bounded goal, budget, and stop condition.
- Parent run owns coordination; child runs own execution.

### UI Panels

#### Delegation Composer

Fields:

- task title
- scoped objective
- constraints
- budget
- target model
- target workspace
- stop condition

Actions:

- spawn child
- save as template

#### Workspace Panel

Fields:

- repo / branch
- worktree path
- dirty state
- pending diff
- merge readiness

Actions:

- create worktree
- open diff
- mark ready for review
- merge
- abandon

#### Briefing Panel

Fields:

- reusable prompt / brief
- references
- constraints
- prior decisions

Actions:

- attach to task
- update version
- reuse for child task

### Backend Changes

Recommended additions:

- `src/workspaceManager.ts`
  Creates and tracks branch/worktree assignments.
- `src/briefingStore.ts`
  Versioned session briefings.
- `src/artifactStore.ts`
  Diffs, notes, outputs, and test results.

Integration direction:

- Parent-child linkage can reuse the current subagent visual model, but the source of truth should become `SessionRun.parentSessionRunId`, not just transient tool activity.
- The office view can still render topology, but the control model must live outside canvas state.

## V3

### Goal

Add controlled autonomy after explicit delegation primitives are stable.

### Features

- Optional automatic task pickup from inbox
- Policy-based assignment rules
- Shared memory retrieval and task brief generation
- Subagent topology view
- Team-level dashboards across many repos or projects

### New Entities

#### `AssignmentPolicy`

- `id`
- `name`
- `filters`
- `preferredModel`
- `preferredWorkspaceStrategy`
- `maxParallelRuns`
- `autoPickupEnabled`

#### `MemoryNote`

- `id`
- `scope: repo | task_type | project | global`
- `tags`
- `content`
- `sourceRunIds`
- `lastUsedAt`

### State Machines

#### `AutoDispatch`

`idle -> candidate_selected -> briefing_prepared -> awaiting_policy_checks -> dispatched`

Fallback paths:

- `candidate_selected -> idle`
- `awaiting_policy_checks -> blocked`

Rules:

- Auto-dispatch must be reversible and auditable.
- Policy checks should include workspace capacity, approval budget, and missing briefing context.

### UI Panels

#### Topology View

Purpose: show parent-child execution tree and ownership.

Node fields:

- session
- task
- workspace
- status
- blocker
- artifacts

Actions:

- open node
- interrupt subtree
- recover failed branch

#### Memory / Briefing Library

Purpose: reuse decisions and reduce restarts from scratch.

Views:

- recent briefings
- reusable memory notes
- decision log

## Cross-Cutting Operational Features

These should start in V1 and deepen over time:

- Pause / resume
- Take over mode
- Reroute to another model
- Why blocked?
- Idle detection with explanation
- Diff review before merge
- Recovery from failed or interrupted runs

Blocked reasons should be explicit and machine-readable:

- `approval_wait`
- `user_input_required`
- `missing_workspace`
- `missing_briefing`
- `tool_failure`
- `merge_conflict`
- `idle_unknown`

## Suggested Build Order

### Phase 1

Control and logs.

Ship:

- `WorkItem`
- `SessionRun`
- `ApprovalRequest`
- append-only `RunEvent`
- dispatch board
- approval center
- run inspector

This is the highest-leverage step because it converts existing hooks into an operating surface.

### Phase 2

Delegation and child sessions.

Ship:

- explicit child run creation
- parent-child links
- budgets and stop conditions
- session drawer controls

### Phase 3

Workspace automation.

Ship:

- branch/worktree provisioning
- diff review state
- merge / abandon lifecycle

### Phase 4

Memory and context distribution.

Ship:

- briefing packs
- reusable notes
- handoff support

### Phase 5

Controlled autonomy.

Ship:

- auto-pickup
- assignment policies
- topology view

## Codebase Mapping

### Extension backend

Current strengths:

- `src/agentManager.ts`
- `src/PixelAgentsViewProvider.ts`
- `server/src/hookEventHandler.ts`

Next likely additions:

- operational stores and reducers
- normalized event bus
- persistent run log storage
- control actions for pause, interrupt, reroute, recover

### Webview

Current strengths:

- `webview-ui/src/hooks/useExtensionMessages.ts`
- `webview-ui/src/App.tsx`
- `webview-ui/src/components/DebugView.tsx`

Next likely additions:

- manager-focused React state separate from animation state
- panels for dispatch, approvals, and run inspection
- split between "office visualization" and "operations console"

### Server / hooks

Current strengths:

- reliable session lifecycle signals
- permission and subagent events

Next likely additions:

- richer event normalization
- better correlation IDs for actions needing approval
- replay-friendly event persistence

## Success Criteria

V1 is successful when:

- A user can create a task and assign it to a live session.
- Risky actions appear in an approval queue with enough context to decide.
- Every session has a replayable run timeline.
- A blocked session explains why it is blocked.
- A user can interrupt or recover work without losing audit history.

V2 is successful when:

- A parent session can spawn bounded child work intentionally.
- Each child can be assigned its own workspace/branch.
- Output can be reviewed before merge.

V3 is successful when:

- The system can safely auto-dispatch some work under policy.
- Memory and briefing reuse materially reduce restarts and duplicated context gathering.

## Bottom Line

The near-term product should not be "better agent avatars."

It should be:

- assign work
- constrain execution
- inspect progress
- approve risk
- interrupt safely
- recover from failure

That is the shortest path from a compelling demo to a real multi-agent operating system.
