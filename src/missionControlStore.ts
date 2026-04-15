import { execFileSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

import type { HookEvent } from '../server/src/hookEventHandler.js';
import { formatToolStatus } from '../server/src/hookEventHandler.js';
import {
  type CreateMissionControlTaskInput,
  MISSION_CONTROL_SCHEMA_VERSION,
  type MissionControlAgentSession,
  type MissionControlApprovalRequest,
  type MissionControlApprovalRisk,
  type MissionControlApprovalScope,
  type MissionControlApprovalStatus,
  type MissionControlArtifact,
  type MissionControlBlockedReason,
  type MissionControlBriefing,
  type MissionControlRunEvent,
  type MissionControlSessionStatus,
  type MissionControlSnapshot,
  type MissionControlTask,
  type MissionControlTaskStatus,
  type MissionControlTokenUsage,
  type MissionControlWorkspaceAssignment,
} from '../shared/missionControl.js';
import { WORKSPACE_KEY_MISSION_CONTROL } from './constants.js';
import { safeUpdateState } from './stateUtils.js';
import type { AgentState } from './types.js';

type MissionControlListener = (snapshot: MissionControlSnapshot) => void;
type IdKind = 'session' | 'task' | 'approval' | 'artifact' | 'workspace' | 'briefing' | 'event';

interface PersistedMissionControlState extends MissionControlSnapshot {
  nextIds: Record<IdKind, number>;
}

const TERMINAL_STATUSES = new Set<MissionControlSessionStatus>(['completed', 'failed', 'stopped']);

function nowIso(): string {
  return new Date().toISOString();
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return undefined;
}

function splitLines(lines: string[] | undefined): string[] {
  return (lines ?? []).map((line) => line.trim()).filter(Boolean);
}

function deriveTaskTitle(goal: string, explicitTitle?: string): string {
  const trimmed = explicitTitle?.trim();
  if (trimmed) return trimmed;

  const normalizedGoal = goal.replace(/\s+/g, ' ').trim();
  if (!normalizedGoal) return 'Untitled task';

  if (normalizedGoal.length <= 72) {
    return normalizedGoal;
  }

  return `${normalizedGoal.slice(0, 69).trimEnd()}...`;
}

function createDefaultState(): PersistedMissionControlState {
  return {
    schemaVersion: MISSION_CONTROL_SCHEMA_VERSION,
    generatedAt: nowIso(),
    sessions: [],
    tasks: [],
    approvals: [],
    events: [],
    artifacts: [],
    workspaces: [],
    briefings: [],
    activeSessionByAgentId: {},
    nextIds: {
      session: 1,
      task: 1,
      approval: 1,
      artifact: 1,
      workspace: 1,
      briefing: 1,
      event: 1,
    },
  };
}

function runGitCommand(cwd: string, args: string[]): string | undefined {
  try {
    const output = execFileSync('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}

function getWorkspaceSnapshot(agent: AgentState): {
  repoRoot: string;
  branchName?: string;
  worktreePath: string;
} {
  const worktreePath = agent.cwd ?? agent.projectDir;
  const repoRoot = runGitCommand(worktreePath, ['rev-parse', '--show-toplevel']) ?? worktreePath;
  const branchName = runGitCommand(repoRoot, ['branch', '--show-current']);
  return { repoRoot, branchName, worktreePath };
}

function getApprovalScope(
  toolName: string | undefined,
  command: string | undefined,
): MissionControlApprovalScope {
  if (toolName === 'Edit' || toolName === 'Write') return 'workspace_write';
  if (toolName === 'WebFetch' || toolName === 'WebSearch') return 'network';
  if (command) {
    if (/\b(rm|del|git\s+reset|git\s+clean|chmod|chown)\b/i.test(command)) {
      return 'destructive';
    }
    if (
      /\b(curl|wget|npm\s+install|pnpm\s+install|yarn\s+add|pip\s+install|brew\s+install)\b/i.test(
        command,
      )
    ) {
      return 'network';
    }
    if (/\b(mv|cp|tee|cat\s+>|echo\s+>)\b/i.test(command)) {
      return 'external_write';
    }
  }
  return 'unknown';
}

function getApprovalRisk(
  scope: MissionControlApprovalScope,
  command: string | undefined,
): MissionControlApprovalRisk {
  if (scope === 'destructive') return 'high';
  if (scope === 'network' || /\b(sudo|docker|kubectl|terraform)\b/i.test(command ?? '')) {
    return 'medium';
  }
  return 'low';
}

function getToolCommand(event: HookEvent): string | undefined {
  const input = (event.tool_input as Record<string, unknown> | undefined) ?? {};
  return trimToUndefined(typeof input.command === 'string' ? input.command : undefined);
}

function getActionSummary(event: HookEvent): string {
  const toolName = trimToUndefined(event.tool_name as string | undefined);
  const toolInput = (event.tool_input as Record<string, unknown> | undefined) ?? {};
  if (toolName) {
    return formatToolStatus(toolName, toolInput);
  }
  const notificationType = trimToUndefined(event.notification_type as string | undefined);
  if (notificationType) {
    return notificationType.replace(/_/g, ' ');
  }
  return event.hook_event_name;
}

function getTokenUsageFromEvent(
  event: HookEvent,
  timestamp: string,
): MissionControlTokenUsage | undefined {
  const usage = asRecord(event.usage);
  const inputDetails = asRecord(usage?.input_token_details ?? usage?.input_tokens_details);
  const outputDetails = asRecord(usage?.output_token_details ?? usage?.output_tokens_details);

  const inputTokens = toNonNegativeNumber(usage?.input_tokens ?? event.input_tokens);
  const outputTokens = toNonNegativeNumber(usage?.output_tokens ?? event.output_tokens);
  const cachedInputTokens = toNonNegativeNumber(
    inputDetails?.cached_tokens ?? usage?.cached_input_tokens ?? event.cached_input_tokens,
  );
  const reasoningTokens = toNonNegativeNumber(
    outputDetails?.reasoning_tokens ?? usage?.reasoning_tokens ?? event.reasoning_tokens,
  );
  const totalTokens = toNonNegativeNumber(usage?.total_tokens ?? event.total_tokens);

  if (
    totalTokens === undefined &&
    inputTokens === undefined &&
    outputTokens === undefined &&
    cachedInputTokens === undefined &&
    reasoningTokens === undefined
  ) {
    return undefined;
  }

  return {
    totalTokens:
      totalTokens ??
      (inputTokens !== undefined && outputTokens !== undefined
        ? inputTokens + outputTokens
        : undefined),
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    source: 'hook',
    lastUpdatedAt: timestamp,
  };
}

export class MissionControlStore {
  private state: PersistedMissionControlState = createDefaultState();
  private listeners = new Set<MissionControlListener>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  hydrate(agents: Iterable<AgentState>): MissionControlSnapshot {
    const persisted = this.context.workspaceState.get<PersistedMissionControlState>(
      WORKSPACE_KEY_MISSION_CONTROL,
    );
    if (persisted?.schemaVersion === MISSION_CONTROL_SCHEMA_VERSION) {
      this.state = {
        ...createDefaultState(),
        ...persisted,
        nextIds: {
          ...createDefaultState().nextIds,
          ...persisted.nextIds,
        },
      };
    }
    this.syncAgents(agents);
    return this.getSnapshot();
  }

  dispose(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
  }

  subscribe(listener: MissionControlListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): MissionControlSnapshot {
    return {
      schemaVersion: this.state.schemaVersion,
      generatedAt: this.state.generatedAt,
      sessions: [...this.state.sessions].sort((a, b) => {
        if (a.endedAt && !b.endedAt) return 1;
        if (!a.endedAt && b.endedAt) return -1;
        return b.updatedAt.localeCompare(a.updatedAt);
      }),
      tasks: [...this.state.tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      approvals: [...this.state.approvals].sort((a, b) =>
        b.requestedAt.localeCompare(a.requestedAt),
      ),
      events: [...this.state.events].sort((a, b) => {
        if (a.timestamp === b.timestamp) return a.seq - b.seq;
        return a.timestamp.localeCompare(b.timestamp);
      }),
      artifacts: [...this.state.artifacts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      workspaces: [...this.state.workspaces].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      briefings: [...this.state.briefings].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      activeSessionByAgentId: { ...this.state.activeSessionByAgentId },
    };
  }

  syncAgents(agents: Iterable<AgentState>): void {
    let changed = false;
    for (const agent of agents) {
      const session = this.ensureSession(agent);
      const workspace = this.ensureWorkspace(agent, session.id);
      if (session.workspaceAssignmentId !== workspace.id) {
        session.workspaceAssignmentId = workspace.id;
        session.updatedAt = nowIso();
        changed = true;
      }
    }
    if (changed) {
      this.emitChange();
    }
  }

  recordAgentLaunch(agent: AgentState): void {
    const session = this.ensureSession(agent);
    session.status = 'starting';
    session.updatedAt = nowIso();
    session.lastActionSummary = 'Agent launched';
    this.appendEvent(session.id, 'agent_launched', 'system', 'Agent launched');
    this.emitChange();
  }

  recordAgentRemoved(agent: AgentState, reason: string): void {
    const session = this.getCurrentSession(agent.id);
    if (!session) return;
    const endedAt = nowIso();
    session.status = 'stopped';
    session.blockerReason = reason;
    session.currentTool = undefined;
    session.lastActionSummary = reason;
    session.updatedAt = endedAt;
    session.endedAt = endedAt;
    delete this.state.activeSessionByAgentId[agent.id];
    this.markTaskForSession(session, 'blocked', 'unknown', reason);
    this.appendEvent(session.id, 'agent_removed', 'system', reason);
    this.emitChange();
  }

  createTask(input: CreateMissionControlTaskInput): MissionControlTask {
    const timestamp = nowIso();
    const title = deriveTaskTitle(input.goal, input.title);
    const briefing: MissionControlBriefing = {
      id: this.nextId('briefing'),
      scope: 'task',
      summary: input.goal.trim(),
      constraints: splitLines(input.constraints),
      artifactRefs: [],
      freshness: 'fresh',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const task: MissionControlTask = {
      id: this.nextId('task'),
      title,
      goal: input.goal.trim(),
      status: 'inbox',
      priority: input.priority ?? 'medium',
      dependencies: [],
      expectedArtifacts: splitLines(input.expectedArtifacts),
      acceptanceCriteria: splitLines(input.acceptanceCriteria),
      constraints: splitLines(input.constraints),
      briefingId: briefing.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: 'operator',
      latestUpdate: 'Task created',
    };

    briefing.taskId = task.id;
    this.state.tasks.push(task);
    this.state.briefings.push(briefing);
    this.appendSystemEvent('task_created', `Created task "${task.title}"`, {
      taskId: task.id,
      priority: task.priority,
    });
    this.emitChange();
    return task;
  }

  submitTask(
    input: CreateMissionControlTaskInput,
    agent: AgentState,
  ): MissionControlTask | undefined {
    const task = this.createTask(input);
    return this.assignTask(task.id, agent);
  }

  assignTask(taskId: string, agent: AgentState): MissionControlTask | undefined {
    const task = this.state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) return undefined;

    const session = this.ensureSession(agent);
    if (task.ownerSessionId && task.ownerSessionId !== session.id) {
      const previousSession = this.state.sessions.find(
        (candidate) => candidate.id === task.ownerSessionId,
      );
      if (previousSession?.taskId === task.id) {
        previousSession.taskId = undefined;
      }
    }
    const workspace = this.ensureWorkspace(agent, session.id);
    const timestamp = nowIso();

    task.ownerAgentId = agent.id;
    task.ownerSessionId = session.id;
    task.workspaceAssignmentId = workspace.id;
    task.status = 'assigned';
    task.blockedReason = undefined;
    task.updatedAt = timestamp;
    task.latestUpdate = `Assigned to Agent #${agent.id}`;

    session.taskId = task.id;
    session.status = 'active';
    session.workspaceAssignmentId = workspace.id;
    session.blockerReason = undefined;
    session.updatedAt = timestamp;
    session.lastActionSummary = `Assigned task "${task.title}"`;

    const briefing = this.getBriefing(task.briefingId);
    if (briefing) {
      briefing.sessionId = session.id;
      briefing.updatedAt = timestamp;
    }

    this.appendEvent(
      session.id,
      'task_assigned',
      'ui',
      `Assigned task "${task.title}"`,
      {
        taskId: task.id,
        agentId: agent.id,
      },
      [],
      task.id,
    );
    this.emitChange();
    return task;
  }

  updateTaskStatus(taskId: string, status: MissionControlTaskStatus, latestUpdate?: string): void {
    const task = this.state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    task.status = status;
    if (status !== 'blocked') {
      task.blockedReason = undefined;
    }
    task.latestUpdate = latestUpdate;
    task.updatedAt = nowIso();
    const summary = latestUpdate ? latestUpdate : `Task moved to ${status.replace(/_/g, ' ')}`;
    this.appendSystemEvent('task_status_changed', summary, { taskId, status });
    this.emitChange();
  }

  resolveApproval(
    approvalId: string,
    status: Extract<MissionControlApprovalStatus, 'approved' | 'rejected'>,
    decisionSummary?: string,
  ): void {
    const approval = this.state.approvals.find((candidate) => candidate.id === approvalId);
    if (!approval || approval.status !== 'pending') return;
    approval.status = status;
    approval.decidedAt = nowIso();
    approval.decisionSummary = decisionSummary;

    const session = this.state.sessions.find((candidate) => candidate.id === approval.sessionId);
    if (session) {
      session.updatedAt = approval.decidedAt;
      session.lastActionSummary =
        decisionSummary ?? `${status === 'approved' ? 'Approved' : 'Rejected'} in Mission Control`;
    }

    this.appendEvent(
      approval.sessionId,
      'approval_resolved',
      'ui',
      approval.decisionSummary ?? `${status === 'approved' ? 'Approved' : 'Rejected'} request`,
      {
        approvalId,
        status,
      },
      [],
      approval.taskId,
    );
    this.emitChange();
  }

  recordTakeover(agent: AgentState): void {
    const session = this.ensureSession(agent);
    session.updatedAt = nowIso();
    session.lastActionSummary = 'Operator took over in terminal';
    this.appendEvent(
      session.id,
      'takeover',
      'ui',
      'Operator took over in terminal',
      {
        agentId: agent.id,
      },
      [],
      session.taskId,
    );
    this.emitChange();
  }

  recordInterrupt(agent: AgentState): void {
    const session = this.ensureSession(agent);
    session.status = 'blocked';
    session.blockerReason = 'Interrupted by operator';
    session.currentTool = undefined;
    session.updatedAt = nowIso();
    session.lastActionSummary = 'Interrupt requested';
    this.markTaskForSession(session, 'blocked', 'operator_pause', 'Interrupted by operator');
    this.appendEvent(
      session.id,
      'interrupt_requested',
      'ui',
      'Interrupt requested',
      {
        agentId: agent.id,
      },
      [],
      session.taskId,
    );
    this.emitChange();
  }

  handleHookEvent(agent: AgentState, providerId: string, event: HookEvent): void {
    if (event.hook_event_name === 'SessionStart') {
      this.handleSessionStart(agent, providerId, event);
      return;
    }

    const session = this.ensureSession(agent);
    const timestamp = nowIso();
    session.provider = providerId;
    session.updatedAt = timestamp;
    this.mergeTokenUsage(session, event, timestamp);

    switch (event.hook_event_name) {
      case 'SessionEnd': {
        const reason = trimToUndefined(event.reason as string | undefined) ?? 'Session ended';
        session.status = reason === 'clear' || reason === 'resume' ? 'stopped' : 'stopped';
        session.currentTool = undefined;
        session.lastActionSummary = `Session ended: ${reason}`;
        session.blockerReason = reason;
        session.endedAt = timestamp;
        this.markTaskForSession(session, 'blocked', 'unknown', `Session ended: ${reason}`);
        this.appendEvent(
          session.id,
          'session_end',
          'hook',
          `Session ended: ${reason}`,
          { reason },
          [],
          session.taskId,
        );
        break;
      }
      case 'PreToolUse': {
        this.supersedePendingApprovals(session.id, 'Action continued');
        const toolName = trimToUndefined(event.tool_name as string | undefined) ?? 'Tool';
        const toolInput = (event.tool_input as Record<string, unknown> | undefined) ?? {};
        const summary = formatToolStatus(toolName, toolInput);
        session.status = 'active';
        session.blockerReason = undefined;
        session.currentTool = toolName;
        session.lastTool = toolName;
        session.lastActionSummary = summary;
        this.markTaskForSession(session, 'in_progress', undefined, summary);
        const eventId = this.nextId('event');
        const artifactRefs = this.createArtifactsForTool(session, eventId, toolName, toolInput);
        this.pushEvent({
          id: eventId,
          sessionId: session.id,
          taskId: session.taskId,
          seq: this.nextSequence(session.id),
          timestamp,
          eventType: 'tool_start',
          source: 'hook',
          summary,
          artifactRefs,
          payload: {
            toolName,
            toolInput,
          },
        });
        break;
      }
      case 'PostToolUse': {
        const summary = `${getActionSummary(event)} completed`;
        session.status = 'active';
        session.lastActionSummary = summary;
        session.currentTool = undefined;
        this.appendEvent(
          session.id,
          'tool_complete',
          'hook',
          summary,
          {
            toolName: event.tool_name,
          },
          [],
          session.taskId,
        );
        break;
      }
      case 'PostToolUseFailure': {
        const summary = `${getActionSummary(event)} failed`;
        session.status = 'blocked';
        session.currentTool = undefined;
        session.blockerReason = summary;
        session.lastActionSummary = summary;
        this.markTaskForSession(session, 'blocked', 'tool_failure', summary);
        this.appendEvent(
          session.id,
          'tool_failure',
          'hook',
          summary,
          {
            toolName: event.tool_name,
          },
          [],
          session.taskId,
        );
        break;
      }
      case 'PermissionRequest': {
        this.createApproval(session, event);
        break;
      }
      case 'Notification': {
        const notificationType = trimToUndefined(event.notification_type as string | undefined);
        if (notificationType === 'permission_prompt') {
          this.createApproval(session, event);
        } else if (notificationType === 'idle_prompt') {
          session.status = 'waiting_input';
          session.currentTool = undefined;
          session.blockerReason = 'Awaiting input or next instruction';
          session.lastActionSummary = 'Agent is waiting for input';
          this.markTaskForSession(session, 'blocked', 'idle', 'Agent is waiting for input');
          this.appendEvent(
            session.id,
            'idle',
            'hook',
            'Agent is waiting for input',
            {
              notificationType,
            },
            [],
            session.taskId,
          );
        }
        break;
      }
      case 'Stop': {
        this.supersedePendingApprovals(session.id, 'Turn finished');
        session.status = 'waiting_input';
        session.currentTool = undefined;
        session.blockerReason = 'Turn complete; waiting for direction';
        session.lastActionSummary = 'Turn complete';
        this.markTaskForSession(session, 'blocked', 'idle', 'Turn complete');
        this.appendEvent(
          session.id,
          'stop',
          'hook',
          'Turn complete',
          undefined,
          [],
          session.taskId,
        );
        break;
      }
      case 'SubagentStart': {
        const summary = 'Delegated work to a subagent';
        session.lastActionSummary = summary;
        session.status = 'active';
        this.appendEvent(
          session.id,
          'subagent_start',
          'hook',
          summary,
          {
            agentType: event.agent_type,
          },
          [],
          session.taskId,
        );
        break;
      }
      case 'SubagentStop': {
        const summary = 'Subagent finished its delegated work';
        session.lastActionSummary = summary;
        this.appendEvent(
          session.id,
          'subagent_stop',
          'hook',
          summary,
          undefined,
          [],
          session.taskId,
        );
        break;
      }
      default: {
        this.appendEvent(
          session.id,
          event.hook_event_name,
          'hook',
          getActionSummary(event),
          event as Record<string, unknown>,
          [],
          session.taskId,
        );
        break;
      }
    }

    this.emitChange();
  }

  private handleSessionStart(agent: AgentState, providerId: string, event: HookEvent): void {
    const existing = this.getCurrentSession(agent.id);
    const incomingSessionId = trimToUndefined(event.session_id);
    const needsNewSession =
      !existing ||
      TERMINAL_STATUSES.has(existing.status) ||
      (!!incomingSessionId && !!existing.sessionId && existing.sessionId !== incomingSessionId);

    const session = needsNewSession ? this.createSession(agent) : this.ensureSession(agent);
    const timestamp = nowIso();
    session.provider = providerId;
    session.sessionId = incomingSessionId ?? session.sessionId;
    session.status = 'starting';
    session.cwd = agent.cwd ?? session.cwd;
    session.projectDir = agent.projectDir;
    session.updatedAt = timestamp;
    session.endedAt = undefined;
    session.blockerReason = undefined;
    session.lastActionSummary = `Session started (${trimToUndefined(event.source as string | undefined) ?? 'new'})`;

    if (existing && needsNewSession && existing.id !== session.id) {
      existing.status = 'stopped';
      existing.endedAt = timestamp;
      existing.updatedAt = timestamp;
    }

    this.ensureWorkspace(agent, session.id);
    this.appendEvent(
      session.id,
      'session_start',
      'hook',
      session.lastActionSummary,
      {
        source: event.source,
        sessionId: session.sessionId,
      },
      [],
      session.taskId,
    );
    this.emitChange();
  }

  private createApproval(session: MissionControlAgentSession, event: HookEvent): void {
    const command = getToolCommand(event);
    const toolName = trimToUndefined(event.tool_name as string | undefined) ?? session.lastTool;
    const scope = getApprovalScope(toolName, command);
    const riskType = getApprovalRisk(scope, command);
    const requestedAt = nowIso();
    const approval: MissionControlApprovalRequest = {
      id: this.nextId('approval'),
      sessionId: session.id,
      taskId: session.taskId,
      riskType,
      scope,
      actionSummary: command ?? session.lastActionSummary ?? 'Approval requested',
      toolName,
      command,
      justification: trimToUndefined(event.justification as string | undefined),
      status: 'pending',
      requestedAt,
    };

    this.supersedePendingApprovals(session.id, 'Superseded by a newer request');
    this.state.approvals.push(approval);
    session.status = 'waiting_approval';
    session.updatedAt = requestedAt;
    session.blockerReason = approval.actionSummary;
    session.lastActionSummary = 'Waiting for approval';
    session.approvalCount += 1;
    this.markTaskForSession(session, 'blocked', 'approval_wait', approval.actionSummary);
    this.appendEvent(
      session.id,
      'approval_requested',
      'hook',
      `Approval requested: ${approval.actionSummary}`,
      {
        approvalId: approval.id,
        scope,
        riskType,
      },
      [],
      session.taskId,
    );
  }

  private mergeTokenUsage(
    session: MissionControlAgentSession,
    event: HookEvent,
    timestamp: string,
  ): void {
    const usage = getTokenUsageFromEvent(event, timestamp);
    if (!usage) return;

    const previous = session.tokenUsage;
    session.tokenUsage = {
      totalTokens: usage.totalTokens ?? previous?.totalTokens,
      inputTokens: usage.inputTokens ?? previous?.inputTokens,
      outputTokens: usage.outputTokens ?? previous?.outputTokens,
      cachedInputTokens: usage.cachedInputTokens ?? previous?.cachedInputTokens,
      reasoningTokens: usage.reasoningTokens ?? previous?.reasoningTokens,
      source: 'hook',
      lastUpdatedAt: usage.lastUpdatedAt,
    };
  }

  private createArtifactsForTool(
    session: MissionControlAgentSession,
    producedByEventId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
  ): string[] {
    const createdAt = nowIso();
    const artifactRefs: string[] = [];

    const filePath =
      typeof toolInput.file_path === 'string'
        ? toolInput.file_path
        : typeof toolInput.path === 'string'
          ? toolInput.path
          : undefined;
    if (filePath) {
      const artifact = this.createArtifact({
        type: 'file',
        title: path.basename(filePath),
        uri: filePath,
        producedByEventId,
        createdAt,
      });
      artifactRefs.push(artifact.id);
      session.artifactCount += 1;
    }

    const command = typeof toolInput.command === 'string' ? toolInput.command.trim() : undefined;
    if (command) {
      const artifact = this.createArtifact({
        type: 'command',
        title: toolName,
        value: command,
        producedByEventId,
        createdAt,
      });
      artifactRefs.push(artifact.id);
      session.artifactCount += 1;
    }

    const description =
      typeof toolInput.description === 'string'
        ? trimToUndefined(toolInput.description)
        : undefined;
    if (!filePath && !command && description) {
      const artifact = this.createArtifact({
        type: toolName === 'Task' || toolName === 'Agent' ? 'delegation' : 'summary',
        title: toolName,
        value: description,
        producedByEventId,
        createdAt,
      });
      artifactRefs.push(artifact.id);
      session.artifactCount += 1;
    }

    return artifactRefs;
  }

  private createArtifact(input: Omit<MissionControlArtifact, 'id'>): MissionControlArtifact {
    const artifact: MissionControlArtifact = {
      id: this.nextId('artifact'),
      ...input,
    };
    this.state.artifacts.push(artifact);
    return artifact;
  }

  private ensureSession(agent: AgentState): MissionControlAgentSession {
    const activeId = this.state.activeSessionByAgentId[agent.id];
    const current = activeId
      ? this.state.sessions.find((session) => session.id === activeId)
      : undefined;

    if (current) {
      if (!current.sessionId && agent.sessionId) {
        current.sessionId = agent.sessionId;
      }
      current.provider = agent.providerId ?? current.provider;
      current.isExternal = agent.isExternal;
      current.cwd = agent.cwd ?? current.cwd;
      current.projectDir = agent.projectDir;
      current.updatedAt = nowIso();
      return current;
    }

    return this.createSession(agent);
  }

  private createSession(agent: AgentState): MissionControlAgentSession {
    const timestamp = nowIso();
    const session: MissionControlAgentSession = {
      id: this.nextId('session'),
      agentId: agent.id,
      provider: agent.providerId ?? 'codex',
      sessionId: trimToUndefined(agent.sessionId),
      isExternal: agent.isExternal,
      status: agent.isWaiting ? 'waiting_input' : 'starting',
      cwd: agent.cwd,
      projectDir: agent.projectDir,
      startedAt: timestamp,
      updatedAt: timestamp,
      approvalCount: 0,
      artifactCount: 0,
    };
    this.state.sessions.push(session);
    this.state.activeSessionByAgentId[agent.id] = session.id;
    const workspace = this.ensureWorkspace(agent, session.id);
    session.workspaceAssignmentId = workspace.id;
    return session;
  }

  private getCurrentSession(agentId: number): MissionControlAgentSession | undefined {
    const sessionId = this.state.activeSessionByAgentId[agentId];
    return sessionId ? this.state.sessions.find((session) => session.id === sessionId) : undefined;
  }

  private ensureWorkspace(
    agent: AgentState,
    assignedSessionId: string,
  ): MissionControlWorkspaceAssignment {
    const snapshot = getWorkspaceSnapshot(agent);
    const existing = this.state.workspaces.find(
      (workspace) => workspace.worktreePath === snapshot.worktreePath,
    );
    const updatedAt = nowIso();
    if (existing) {
      existing.repoRoot = snapshot.repoRoot;
      existing.branchName = snapshot.branchName;
      existing.assignedSessionId = assignedSessionId;
      existing.status = 'ready';
      existing.updatedAt = updatedAt;
      return existing;
    }

    const workspace: MissionControlWorkspaceAssignment = {
      id: this.nextId('workspace'),
      repoRoot: snapshot.repoRoot,
      branchName: snapshot.branchName,
      worktreePath: snapshot.worktreePath,
      status: 'ready',
      assignedSessionId,
      updatedAt,
    };
    this.state.workspaces.push(workspace);
    return workspace;
  }

  private getBriefing(briefingId: string | undefined): MissionControlBriefing | undefined {
    if (!briefingId) return undefined;
    return this.state.briefings.find((briefing) => briefing.id === briefingId);
  }

  private markTaskForSession(
    session: MissionControlAgentSession,
    status: MissionControlTaskStatus,
    blockedReason: MissionControlBlockedReason | undefined,
    latestUpdate: string,
  ): void {
    if (!session.taskId) return;
    const task = this.state.tasks.find((candidate) => candidate.id === session.taskId);
    if (!task) return;
    if (task.status === 'done' || task.status === 'cancelled') return;
    if (task.status === 'review' && status === 'blocked') return;

    task.status = status;
    task.blockedReason = blockedReason;
    task.latestUpdate = latestUpdate;
    task.updatedAt = nowIso();
    task.ownerAgentId = session.agentId;
    task.ownerSessionId = session.id;
  }

  private supersedePendingApprovals(sessionId: string, reason: string): void {
    const decidedAt = nowIso();
    for (const approval of this.state.approvals) {
      if (approval.sessionId !== sessionId || approval.status !== 'pending') continue;
      approval.status = 'superseded';
      approval.decidedAt = decidedAt;
      approval.decisionSummary = reason;
    }
  }

  private appendSystemEvent(
    eventType: string,
    summary: string,
    payload?: Record<string, unknown>,
  ): void {
    this.appendEvent('system', eventType, 'system', summary, payload);
  }

  private appendEvent(
    sessionId: string,
    eventType: string,
    source: MissionControlRunEvent['source'],
    summary: string,
    payload?: Record<string, unknown>,
    artifactRefs: string[] = [],
    taskId?: string,
  ): void {
    const event: MissionControlRunEvent = {
      id: this.nextId('event'),
      sessionId,
      taskId,
      seq: this.nextSequence(sessionId),
      timestamp: nowIso(),
      eventType,
      source,
      summary,
      artifactRefs,
      payload,
    };
    this.pushEvent(event);
  }

  private pushEvent(event: MissionControlRunEvent): void {
    this.state.events.push(event);
  }

  private nextSequence(sessionId: string): number {
    let maxSeq = 0;
    for (const event of this.state.events) {
      if (event.sessionId === sessionId) {
        maxSeq = Math.max(maxSeq, event.seq);
      }
    }
    return maxSeq + 1;
  }

  private nextId(kind: IdKind): string {
    const value = this.state.nextIds[kind]++;
    return `${kind}-${value}`;
  }

  private emitChange(): void {
    this.state.generatedAt = nowIso();
    for (const listener of this.listeners) {
      listener(this.getSnapshot());
    }
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void safeUpdateState(this.context.workspaceState, WORKSPACE_KEY_MISSION_CONTROL, this.state);
    }, 100);
  }
}
