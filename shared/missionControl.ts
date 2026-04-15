export const MISSION_CONTROL_SCHEMA_VERSION = 1 as const;

export type MissionControlPriority = 'low' | 'medium' | 'high';

export type MissionControlSessionStatus =
  | 'queued'
  | 'starting'
  | 'active'
  | 'waiting_approval'
  | 'waiting_input'
  | 'blocked'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stopped';

export type MissionControlTaskStatus =
  | 'inbox'
  | 'ready'
  | 'assigned'
  | 'in_progress'
  | 'review'
  | 'done'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export type MissionControlBlockedReason =
  | 'approval_wait'
  | 'idle'
  | 'missing_context'
  | 'tool_failure'
  | 'operator_pause'
  | 'unknown';

export type MissionControlApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'superseded';

export type MissionControlApprovalRisk = 'low' | 'medium' | 'high';

export type MissionControlApprovalScope =
  | 'workspace_write'
  | 'external_write'
  | 'network'
  | 'destructive'
  | 'unknown';

export type MissionControlArtifactType =
  | 'file'
  | 'command'
  | 'delegation'
  | 'approval'
  | 'summary'
  | 'note';

export type MissionControlEventSource = 'hook' | 'ui' | 'system';

export type MissionControlBriefingScope = 'project' | 'task' | 'session';

export type MissionControlWorkspaceStatus =
  | 'requested'
  | 'provisioning'
  | 'ready'
  | 'dirty'
  | 'merge_pending'
  | 'merged'
  | 'abandoned';

export interface MissionControlTaskBudget {
  maxTurns?: number;
  maxApprovals?: number;
  maxRuntimeMs?: number;
}

export interface MissionControlTokenUsage {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  source: 'hook';
  lastUpdatedAt: string;
}

export interface MissionControlArtifact {
  id: string;
  type: MissionControlArtifactType;
  title: string;
  uri?: string;
  value?: string;
  producedByEventId: string;
  createdAt: string;
}

export interface MissionControlRunEvent {
  id: string;
  sessionId: string;
  taskId?: string;
  seq: number;
  timestamp: string;
  eventType: string;
  source: MissionControlEventSource;
  summary: string;
  artifactRefs: string[];
  payload?: Record<string, unknown>;
}

export interface MissionControlApprovalRequest {
  id: string;
  sessionId: string;
  taskId?: string;
  riskType: MissionControlApprovalRisk;
  scope: MissionControlApprovalScope;
  actionSummary: string;
  toolName?: string;
  command?: string;
  justification?: string;
  status: MissionControlApprovalStatus;
  requestedAt: string;
  decidedAt?: string;
  decisionSummary?: string;
}

export interface MissionControlWorkspaceAssignment {
  id: string;
  repoRoot: string;
  branchName?: string;
  worktreePath: string;
  baseBranch?: string;
  status: MissionControlWorkspaceStatus;
  assignedSessionId?: string;
  updatedAt: string;
}

export interface MissionControlBriefing {
  id: string;
  scope: MissionControlBriefingScope;
  summary: string;
  constraints: string[];
  artifactRefs: string[];
  freshness: 'fresh' | 'stale';
  taskId?: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MissionControlTask {
  id: string;
  title: string;
  goal: string;
  status: MissionControlTaskStatus;
  priority: MissionControlPriority;
  ownerSessionId?: string;
  ownerAgentId?: number;
  dependencies: string[];
  expectedArtifacts: string[];
  acceptanceCriteria: string[];
  constraints: string[];
  briefingId?: string;
  workspaceAssignmentId?: string;
  budget?: MissionControlTaskBudget;
  blockedReason?: MissionControlBlockedReason;
  latestUpdate?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface MissionControlAgentSession {
  id: string;
  agentId: number;
  provider: string;
  sessionId?: string;
  isExternal?: boolean;
  taskId?: string;
  parentSessionId?: string;
  status: MissionControlSessionStatus;
  cwd?: string;
  projectDir?: string;
  lastTool?: string;
  currentTool?: string;
  lastActionSummary?: string;
  blockerReason?: string;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  approvalCount: number;
  artifactCount: number;
  workspaceAssignmentId?: string;
  tokenUsage?: MissionControlTokenUsage;
}

export interface MissionControlSnapshot {
  schemaVersion: typeof MISSION_CONTROL_SCHEMA_VERSION;
  generatedAt: string;
  sessions: MissionControlAgentSession[];
  tasks: MissionControlTask[];
  approvals: MissionControlApprovalRequest[];
  events: MissionControlRunEvent[];
  artifacts: MissionControlArtifact[];
  workspaces: MissionControlWorkspaceAssignment[];
  briefings: MissionControlBriefing[];
  activeSessionByAgentId: Record<number, string>;
}

export interface CreateMissionControlTaskInput {
  title?: string;
  goal: string;
  priority?: MissionControlPriority;
  acceptanceCriteria?: string[];
  constraints?: string[];
  expectedArtifacts?: string[];
}

export interface SubmitMissionControlTaskInput extends CreateMissionControlTaskInput {
  agentId: number;
}
