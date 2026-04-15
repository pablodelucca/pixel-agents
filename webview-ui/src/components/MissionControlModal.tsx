import { useEffect, useMemo, useState } from 'react';

import type { MissionControlSnapshot } from '../../../shared/missionControl.ts';
import { AgentInspectorDrawer } from './AgentInspectorDrawer.js';
import { MissionControlDispatchPanel } from './MissionControlDispatchPanel.js';
import { MissionControlPanel } from './MissionControlPanel.js';
import { Button } from './ui/Button.js';

export type MissionControlView = 'overview' | 'dispatch' | 'agent';

interface MissionControlModalProps {
  isOpen: boolean;
  onClose: () => void;
  agents: number[];
  selectedAgentId: number | null;
  missionControl: MissionControlSnapshot;
  onInspectAgent: (agentId: number) => void;
  initialView?: MissionControlView;
}

function getToneClass(kind: 'active' | 'attention' | 'approval'): string {
  if (kind === 'attention') return 'border-status-error/50 text-status-error';
  if (kind === 'approval') return 'border-status-permission/50 text-status-permission';
  return 'border-status-active/50 text-status-active';
}

export function MissionControlModal({
  isOpen,
  onClose,
  agents,
  selectedAgentId,
  missionControl,
  onInspectAgent,
  initialView = 'overview',
}: MissionControlModalProps) {
  const [activeView, setActiveView] = useState<MissionControlView>(initialView);

  useEffect(() => {
    if (!isOpen) return;
    setActiveView(initialView);
  }, [initialView, isOpen]);

  const selectedSession = useMemo(() => {
    if (selectedAgentId !== null) return selectedAgentId;
    const firstLiveAgent = agents.find((agentId) => missionControl.activeSessionByAgentId[agentId]);
    return firstLiveAgent ?? null;
  }, [agents, missionControl.activeSessionByAgentId, selectedAgentId]);

  const liveSessions = useMemo(
    () =>
      agents
        .map((agentId) => missionControl.activeSessionByAgentId[agentId])
        .map((sessionId) =>
          sessionId
            ? missionControl.sessions.find((session) => session.id === sessionId)
            : undefined,
        )
        .filter((session): session is MissionControlSnapshot['sessions'][number] => !!session),
    [agents, missionControl.activeSessionByAgentId, missionControl.sessions],
  );

  const activeCount = liveSessions.filter(
    (session) => session.status === 'active' || session.status === 'starting',
  ).length;
  const attentionCount = liveSessions.filter(
    (session) =>
      session.status === 'blocked' ||
      session.status === 'waiting_approval' ||
      session.status === 'waiting_input',
  ).length;
  const approvalCount = missionControl.approvals.filter(
    (approval) => approval.status === 'pending',
  ).length;

  const handleInspectAgent = (agentId: number) => {
    onInspectAgent(agentId);
    setActiveView('agent');
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60" style={{ zIndex: 30 }} onClick={onClose} />
      <div
        className="mission-control-shell fixed inset-8 pixel-panel overflow-hidden"
        style={{ zIndex: 31 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-8 border-b-2 border-border px-14 py-12">
          <div className="min-w-0">
            <div className="text-3xl text-white">Mission Control</div>
            <div className="mt-3 max-w-[720px] text-xs leading-relaxed text-text-muted">
              See what each agent is doing now, what is blocked, and what needs your input next.
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-4">
            <div className={`border px-8 py-4 text-2xs uppercase ${getToneClass('active')}`}>
              {activeCount} active
            </div>
            <div className={`border px-8 py-4 text-2xs uppercase ${getToneClass('attention')}`}>
              {attentionCount} need attention
            </div>
            <div className={`border px-8 py-4 text-2xs uppercase ${getToneClass('approval')}`}>
              {approvalCount} approvals
            </div>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        <div className="border-b-2 border-border px-14 py-8">
          <div className="flex flex-wrap gap-4">
            <Button
              size="sm"
              variant={activeView === 'overview' ? 'active' : 'default'}
              onClick={() => setActiveView('overview')}
            >
              Overview
            </Button>
            <Button
              size="sm"
              variant={activeView === 'dispatch' ? 'active' : 'default'}
              onClick={() => setActiveView('dispatch')}
            >
              Dispatch
            </Button>
            <Button
              size="sm"
              variant={activeView === 'agent' ? 'active' : 'default'}
              onClick={() => setActiveView('agent')}
            >
              {selectedSession !== null ? `Agent #${selectedSession}` : 'Agent Detail'}
            </Button>
          </div>
        </div>

        <div className="h-[calc(100%-152px)] min-h-0">
          {activeView === 'overview' ? (
            <MissionControlPanel
              agents={agents}
              selectedAgentId={selectedSession}
              missionControl={missionControl}
              onInspectAgent={handleInspectAgent}
            />
          ) : null}
          {activeView === 'dispatch' ? (
            <MissionControlDispatchPanel
              agents={agents}
              selectedAgentId={selectedSession}
              missionControl={missionControl}
              onInspectAgent={handleInspectAgent}
            />
          ) : null}
          {activeView === 'agent' ? (
            <AgentInspectorDrawer agentId={selectedSession} missionControl={missionControl} />
          ) : null}
        </div>
      </div>
    </>
  );
}
