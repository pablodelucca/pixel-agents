import { useMemo } from 'react';

import type {
  MissionControlAgentSession,
  MissionControlApprovalRequest,
  MissionControlSnapshot,
} from '../../../shared/missionControl.ts';
import { vscode } from '../vscodeApi.js';
import {
  formatDuration,
  formatRelativeTime,
  formatTokenUsageSummary,
  getSessionProgressLabel,
  getSessionTaskLabel,
  getSessionTone,
  humanize,
} from './missionControlUtils.js';
import { Button } from './ui/Button.js';

interface MissionControlPanelProps {
  agents: number[];
  selectedAgentId: number | null;
  missionControl: MissionControlSnapshot;
  onInspectAgent: (agentId: number) => void;
}

function getPendingApproval(
  sessionId: string,
  approvals: MissionControlApprovalRequest[],
): MissionControlApprovalRequest | undefined {
  return approvals.find(
    (approval) => approval.sessionId === sessionId && approval.status === 'pending',
  );
}

function getNextActionLabel(
  session: MissionControlAgentSession,
  pendingApproval: MissionControlApprovalRequest | undefined,
): string {
  if (pendingApproval) return 'Approve or reject';
  if (session.status === 'blocked') return 'Open blocker context';
  if (session.status === 'waiting_input') return 'Send follow-up';
  if (session.status === 'active' || session.status === 'starting') return 'Monitor';
  return 'Inspect';
}

function getAttentionReason(
  session: MissionControlAgentSession,
  pendingApproval: MissionControlApprovalRequest | undefined,
): string {
  if (pendingApproval) return pendingApproval.actionSummary;
  if (session.blockerReason) return session.blockerReason;
  if (session.status === 'waiting_input') return 'Waiting for more direction';
  return 'Needs inspection';
}

export function MissionControlPanel({
  agents,
  selectedAgentId,
  missionControl,
  onInspectAgent,
}: MissionControlPanelProps) {
  const sessionsById = useMemo(
    () => new Map(missionControl.sessions.map((session) => [session.id, session] as const)),
    [missionControl.sessions],
  );
  const tasksById = useMemo(
    () => new Map(missionControl.tasks.map((task) => [task.id, task] as const)),
    [missionControl.tasks],
  );

  const liveSessions = useMemo(
    () =>
      agents
        .map((agentId) => missionControl.activeSessionByAgentId[agentId])
        .map((sessionId) => (sessionId ? sessionsById.get(sessionId) : undefined))
        .filter((session): session is MissionControlAgentSession => !!session)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [agents, missionControl.activeSessionByAgentId, sessionsById],
  );

  const pendingApprovals = missionControl.approvals.filter(
    (approval) => approval.status === 'pending',
  );

  const attentionSessions = liveSessions.filter((session) => {
    const pendingApproval = getPendingApproval(session.id, pendingApprovals);
    return (
      !!pendingApproval ||
      session.status === 'blocked' ||
      session.status === 'waiting_input' ||
      session.status === 'waiting_approval'
    );
  });

  const renderSessionCard = (
    session: MissionControlAgentSession,
    options?: { attention?: boolean },
  ) => {
    const task = session.taskId ? tasksById.get(session.taskId) : undefined;
    const pendingApproval = getPendingApproval(session.id, pendingApprovals);
    const isSelected = selectedAgentId === session.agentId;
    const taskLabel = getSessionTaskLabel(session, task);
    const progressLabel = getSessionProgressLabel(session, task);
    const nextAction = getNextActionLabel(session, pendingApproval);

    return (
      <div
        key={session.id}
        role="button"
        tabIndex={0}
        className={`w-full rounded-none border-2 px-10 py-8 text-left transition-colors ${
          isSelected
            ? 'border-accent bg-active-bg/75'
            : options?.attention
              ? 'border-status-permission/40 bg-status-permission/8'
              : 'border-border bg-bg-dark/55 hover:bg-bg-dark/80'
        }`}
        onClick={() => onInspectAgent(session.agentId)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onInspectAgent(session.agentId);
          }
        }}
      >
        <div className="flex items-start justify-between gap-8">
          <div className="min-w-0">
            <div className="text-sm uppercase text-text-muted">
              Agent #{session.agentId}
              {session.isExternal ? ' · external' : ''}
            </div>
            <div className="mt-3 truncate text-lg text-white">{taskLabel}</div>
          </div>
          <span
            className={`shrink-0 border px-6 py-2 text-2xs uppercase ${getSessionTone(session.status)}`}
          >
            {humanize(session.status)}
          </span>
        </div>

        <div className="mt-5 text-2xs leading-relaxed text-text-muted">{progressLabel}</div>

        {options?.attention && (
          <div className="mt-6 border border-status-permission/40 bg-black/15 px-6 py-5">
            <div className="text-2xs uppercase text-status-permission">Needs you</div>
            <div className="mt-2 text-2xs leading-relaxed text-text">
              {getAttentionReason(session, pendingApproval)}
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-4 text-2xs text-text-muted">
          <span className="border border-border px-5 py-2">
            Runtime {formatDuration(session.startedAt, session.endedAt)}
          </span>
          <span className="border border-border px-5 py-2">
            Tokens {formatTokenUsageSummary(session.tokenUsage)}
          </span>
          <span className="border border-border px-5 py-2">Next: {nextAction}</span>
          {session.approvalCount > 0 && (
            <span className="border border-border px-5 py-2">
              Approvals {session.approvalCount}
            </span>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-4">
          {pendingApproval ? (
            <>
              <Button
                size="sm"
                variant="accent"
                onClick={(event) => {
                  event.stopPropagation();
                  vscode.postMessage({
                    type: 'resolveApprovalRequest',
                    approvalId: pendingApproval.id,
                    status: 'approved',
                    decisionSummary: 'Approved from Mission Control list',
                  });
                }}
              >
                Approve
              </Button>
              <Button
                size="sm"
                onClick={(event) => {
                  event.stopPropagation();
                  vscode.postMessage({
                    type: 'resolveApprovalRequest',
                    approvalId: pendingApproval.id,
                    status: 'rejected',
                    decisionSummary: 'Rejected from Mission Control list',
                  });
                }}
              >
                Reject
              </Button>
            </>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              onInspectAgent(session.agentId);
            }}
          >
            Inspect
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto px-12 py-12">
      <section>
        {attentionSessions.length > 0 ? (
          <div className="mb-6 flex items-center justify-between gap-6">
            <div>
              <div className="text-lg text-white">Needs Attention</div>
              <div className="mt-2 text-2xs text-text-muted">
                These agents are blocked, waiting, or asking for approval.
              </div>
            </div>
            <span className="border border-status-permission/40 px-6 py-2 text-2xs uppercase text-status-permission">
              {attentionSessions.length}
            </span>
          </div>
        ) : (
          <div className="mb-6 flex items-center justify-between gap-6">
            <div>
              <div className="text-lg text-white">Overview</div>
              <div className="mt-2 text-2xs text-text-muted">
                All active agents are healthy. Inspect any agent for details.
              </div>
            </div>
            <span className="border border-status-success/40 px-6 py-2 text-2xs uppercase text-status-success">
              Clear
            </span>
          </div>
        )}
        {attentionSessions.length > 0 ? (
          <div className="space-y-6">
            {attentionSessions.map((session) => renderSessionCard(session, { attention: true }))}
          </div>
        ) : null}
      </section>

      <section className="mt-12">
        <div className="mb-6 flex items-center justify-between gap-6">
          <div>
            <div className="text-lg text-white">Agents</div>
            <div className="mt-2 text-2xs text-text-muted">
              Click any agent to inspect the current task, status, and recent activity.
            </div>
          </div>
          <span className="border border-border px-6 py-2 text-2xs uppercase text-text-muted">
            Snapshot {formatRelativeTime(missionControl.generatedAt)}
          </span>
        </div>

        <div className="space-y-6">
          {liveSessions.length > 0 ? (
            liveSessions.map((session) => renderSessionCard(session))
          ) : (
            <div className="pixel-panel bg-bg-dark/55 px-10 py-10 text-sm text-text-muted">
              Launch an agent to populate Mission Control.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
