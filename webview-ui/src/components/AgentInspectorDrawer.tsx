import type {
  MissionControlApprovalRequest,
  MissionControlArtifact,
  MissionControlRunEvent,
  MissionControlSnapshot,
  MissionControlTask,
} from '../../../shared/missionControl.ts';
import { vscode } from '../vscodeApi.js';
import {
  formatDuration,
  formatRelativeTime,
  formatTimestamp,
  formatTokenUsageDetails,
  formatTokenUsageSummary,
  getApprovalTone,
  getSessionProgressLabel,
  getSessionTaskLabel,
  getSessionTone,
  getTaskTone,
  humanize,
} from './missionControlUtils.js';
import { Button } from './ui/Button.js';

interface AgentInspectorDrawerProps {
  agentId: number | null;
  missionControl: MissionControlSnapshot;
}

function renderLines(values: string[]) {
  return values.map((value) => <div key={value}>{value}</div>);
}

function getPendingApproval(
  approvals: MissionControlApprovalRequest[],
): MissionControlApprovalRequest | undefined {
  return approvals.find((approval) => approval.status === 'pending');
}

function getNextAction(
  pendingApproval: MissionControlApprovalRequest | undefined,
  sessionStatus: string,
  task: MissionControlTask | undefined,
): string {
  if (pendingApproval) return 'Approve or reject the pending action.';
  if (sessionStatus === 'waiting_input') return 'Send a follow-up instruction or clarify the task.';
  if (sessionStatus === 'blocked')
    return 'Inspect the blocker and decide whether to re-route or interrupt.';
  if (task?.status === 'review') return 'Review the result and either accept it or ask for rework.';
  if (sessionStatus === 'active' || sessionStatus === 'starting') {
    return 'Monitor the run. No operator action is required right now.';
  }
  return 'Inspect the recent activity to decide the next instruction.';
}

function getRecentArtifacts(
  artifacts: MissionControlArtifact[],
  events: MissionControlRunEvent[],
): MissionControlArtifact[] {
  const eventIds = new Set(events.flatMap((event) => event.artifactRefs));
  return artifacts
    .filter((artifact) => eventIds.has(artifact.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);
}

export function AgentInspectorDrawer({ agentId, missionControl }: AgentInspectorDrawerProps) {
  if (agentId === null) {
    return (
      <div className="flex h-full items-center justify-center px-12 text-sm text-text-muted">
        Select an agent to see the task, live progress, blockers, and next action.
      </div>
    );
  }

  const sessions = missionControl.sessions.filter((session) => session.agentId === agentId);
  const activeSessionId = missionControl.activeSessionByAgentId[agentId];
  const session =
    sessions.find((candidate) => candidate.id === activeSessionId) ??
    [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center px-12 text-sm text-text-muted">
        No session data is available for Agent #{agentId}.
      </div>
    );
  }

  const task = session.taskId
    ? missionControl.tasks.find((candidate) => candidate.id === session.taskId)
    : undefined;
  const workspace = session.workspaceAssignmentId
    ? missionControl.workspaces.find((candidate) => candidate.id === session.workspaceAssignmentId)
    : undefined;
  const approvals = missionControl.approvals
    .filter((approval) => approval.sessionId === session.id)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const pendingApproval = getPendingApproval(approvals);
  const events = missionControl.events
    .filter((event) => event.sessionId === session.id)
    .sort((a, b) => {
      if (a.timestamp === b.timestamp) return b.seq - a.seq;
      return b.timestamp.localeCompare(a.timestamp);
    });
  const recentEvents = events.slice(0, 8);
  const artifacts = getRecentArtifacts(missionControl.artifacts, events);
  const nextAction = getNextAction(pendingApproval, session.status, task);
  const progressLabel = getSessionProgressLabel(session, task);

  const taskAction = (status: MissionControlTask['status'], latestUpdate: string) => {
    if (!task) return;
    vscode.postMessage({
      type: 'updateMissionTaskStatus',
      taskId: task.id,
      status,
      latestUpdate,
    });
  };

  return (
    <div className="h-full overflow-y-auto px-12 py-12">
      <section className="mission-control-hero pixel-panel px-10 py-10">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="min-w-0">
            <div className="text-sm uppercase text-text-muted">Agent #{agentId}</div>
            <div className="mt-3 text-2xl text-white">{getSessionTaskLabel(session, task)}</div>
            <div className="mt-3 text-2xs leading-relaxed text-text-muted">
              {task?.goal ?? progressLabel}
            </div>
          </div>
          <span className={`border px-6 py-2 text-2xs uppercase ${getSessionTone(session.status)}`}>
            {humanize(session.status)}
          </span>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="border border-border bg-black/10 px-8 py-6">
            <div className="text-2xs uppercase text-text-muted">Current step</div>
            <div className="mt-2 text-sm text-white">{progressLabel}</div>
          </div>
          <div className="border border-border bg-black/10 px-8 py-6">
            <div className="text-2xs uppercase text-text-muted">Next operator action</div>
            <div className="mt-2 text-sm text-white">{nextAction}</div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-4">
          <Button
            size="sm"
            variant="accent"
            onClick={() => vscode.postMessage({ type: 'openAgentTerminal', id: agentId })}
          >
            Open Terminal
          </Button>
          <Button
            size="sm"
            onClick={() => vscode.postMessage({ type: 'interruptAgent', id: agentId })}
          >
            Interrupt
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => vscode.postMessage({ type: 'closeAgent', id: agentId })}
          >
            Close Agent
          </Button>
        </div>
      </section>

      <section className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <div className="pixel-panel bg-bg-dark/55 px-8 py-8">
          <div className="text-2xs uppercase text-text-muted">Runtime</div>
          <div className="mt-3 text-lg text-white">
            {formatDuration(session.startedAt, session.endedAt)}
          </div>
          <div className="mt-2 text-2xs text-text-muted">
            Updated {formatRelativeTime(session.updatedAt)}
          </div>
        </div>
        <div className="pixel-panel bg-bg-dark/55 px-8 py-8">
          <div className="text-2xs uppercase text-text-muted">Tokens</div>
          <div className="mt-3 text-lg text-white">
            {formatTokenUsageSummary(session.tokenUsage)}
          </div>
          <div className="mt-2 grid gap-1 text-2xs text-text-muted">
            {renderLines(formatTokenUsageDetails(session.tokenUsage))}
          </div>
        </div>
        <div className="pixel-panel bg-bg-dark/55 px-8 py-8">
          <div className="text-2xs uppercase text-text-muted">Workspace</div>
          <div className="mt-3 text-sm text-white">{workspace?.branchName ?? 'Unknown branch'}</div>
          <div className="mt-2 break-all text-2xs text-text-muted">
            {workspace?.worktreePath ?? session.cwd ?? session.projectDir ?? 'Unknown directory'}
          </div>
        </div>
        <div className="pixel-panel bg-bg-dark/55 px-8 py-8">
          <div className="text-2xs uppercase text-text-muted">Run facts</div>
          <div className="mt-3 grid gap-2 text-2xs text-text-muted">
            <div>Provider: {session.provider}</div>
            <div>Approvals: {session.approvalCount}</div>
            <div>Artifacts: {session.artifactCount}</div>
            <div>Last tool: {session.lastTool ?? 'None'}</div>
          </div>
        </div>
      </section>

      {pendingApproval ? (
        <section className="mt-12 pixel-panel bg-status-permission/10 px-10 py-10">
          <div className="flex flex-wrap items-start justify-between gap-8">
            <div className="min-w-0">
              <div className="text-sm uppercase text-status-permission">Pending approval</div>
              <div className="mt-3 text-lg text-white">{pendingApproval.actionSummary}</div>
              <div className="mt-3 grid gap-2 text-2xs text-text-muted">
                <div>Requested {formatTimestamp(pendingApproval.requestedAt)}</div>
                <div>Scope: {humanize(pendingApproval.scope)}</div>
                {pendingApproval.command ? (
                  <div className="break-all">Command: {pendingApproval.command}</div>
                ) : null}
                {pendingApproval.justification ? (
                  <div>Why: {pendingApproval.justification}</div>
                ) : null}
              </div>
            </div>
            <span
              className={`border px-6 py-2 text-2xs uppercase ${getApprovalTone(pendingApproval.riskType)}`}
            >
              {pendingApproval.riskType}
            </span>
          </div>
          <div className="mt-8 flex flex-wrap gap-4">
            <Button
              size="sm"
              variant="accent"
              onClick={() =>
                vscode.postMessage({
                  type: 'resolveApprovalRequest',
                  approvalId: pendingApproval.id,
                  status: 'approved',
                  decisionSummary: 'Approved from inspector',
                })
              }
            >
              Approve
            </Button>
            <Button
              size="sm"
              onClick={() =>
                vscode.postMessage({
                  type: 'resolveApprovalRequest',
                  approvalId: pendingApproval.id,
                  status: 'rejected',
                  decisionSummary: 'Rejected from inspector',
                })
              }
            >
              Reject
            </Button>
          </div>
        </section>
      ) : null}

      {task ? (
        <section className="mt-12 pixel-panel bg-bg-dark/55 px-10 py-10">
          <div className="flex flex-wrap items-start justify-between gap-8">
            <div>
              <div className="text-lg text-white">Task brief</div>
              <div className="mt-3 text-sm text-white">{task.title}</div>
              <div className="mt-2 text-2xs leading-relaxed text-text-muted">{task.goal}</div>
            </div>
            <span className={`border px-6 py-2 text-2xs uppercase ${getTaskTone(task.status)}`}>
              {humanize(task.status)}
            </span>
          </div>

          <div className="mt-8 grid gap-8 lg:grid-cols-3">
            <div>
              <div className="text-2xs uppercase text-text-muted">Acceptance criteria</div>
              <div className="mt-3 grid gap-2 text-2xs text-text">
                {task.acceptanceCriteria.length > 0 ? (
                  task.acceptanceCriteria.map((item) => <div key={item}>• {item}</div>)
                ) : (
                  <div className="text-text-muted">None provided.</div>
                )}
              </div>
            </div>
            <div>
              <div className="text-2xs uppercase text-text-muted">Constraints</div>
              <div className="mt-3 grid gap-2 text-2xs text-text">
                {task.constraints.length > 0 ? (
                  task.constraints.map((item) => <div key={item}>• {item}</div>)
                ) : (
                  <div className="text-text-muted">None provided.</div>
                )}
              </div>
            </div>
            <div>
              <div className="text-2xs uppercase text-text-muted">Expected artifacts</div>
              <div className="mt-3 grid gap-2 text-2xs text-text">
                {task.expectedArtifacts.length > 0 ? (
                  task.expectedArtifacts.map((item) => <div key={item}>• {item}</div>)
                ) : (
                  <div className="text-text-muted">None provided.</div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-4">
            <Button
              size="sm"
              onClick={() => taskAction('in_progress', 'Marked active from inspector')}
            >
              Mark Active
            </Button>
            <Button size="sm" onClick={() => taskAction('review', 'Marked ready for review')}>
              Review
            </Button>
            <Button
              size="sm"
              variant="accent"
              onClick={() => taskAction('done', 'Marked done from inspector')}
            >
              Done
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => taskAction('blocked', 'Marked blocked from inspector')}
            >
              Blocked
            </Button>
          </div>
        </section>
      ) : null}

      <section className="mt-12 grid gap-6 xl:grid-cols-[minmax(0,0.72fr)_minmax(260px,0.28fr)]">
        <div className="pixel-panel bg-bg-dark/55 px-10 py-10">
          <div className="flex items-center justify-between gap-8">
            <div className="text-lg text-white">Recent activity</div>
            <div className="text-2xs text-text-muted">{recentEvents.length} items</div>
          </div>
          <div className="mt-8 space-y-4">
            {recentEvents.length > 0 ? (
              recentEvents.map((event) => (
                <div key={event.id} className="border border-border bg-black/10 px-8 py-6">
                  <div className="flex items-start justify-between gap-8">
                    <div className="min-w-0">
                      <div className="text-sm text-white">{event.summary}</div>
                      <div className="mt-2 text-2xs text-text-muted">
                        {humanize(event.eventType)} · {formatTimestamp(event.timestamp)}
                      </div>
                    </div>
                    <div className="text-2xs text-text-muted">#{event.seq}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-text-muted">No recent activity recorded yet.</div>
            )}
          </div>
        </div>

        <div className="pixel-panel bg-bg-dark/55 px-10 py-10">
          <div className="text-lg text-white">Captured artifacts</div>
          <div className="mt-8 space-y-4">
            {artifacts.length > 0 ? (
              artifacts.map((artifact) => (
                <div key={artifact.id} className="border border-border bg-black/10 px-8 py-6">
                  <div className="text-sm text-white">{artifact.title}</div>
                  <div className="mt-2 break-all text-2xs text-text-muted">
                    {artifact.uri ?? artifact.value ?? 'No value captured'}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-text-muted">No artifacts captured yet.</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
