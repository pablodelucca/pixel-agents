import { useEffect, useMemo, useState } from 'react';

import type {
  MissionControlAgentSession,
  MissionControlSnapshot,
} from '../../../shared/missionControl.ts';
import { vscode } from '../vscodeApi.js';
import { getSessionProgressLabel, getSessionTaskLabel, humanize } from './missionControlUtils.js';
import { Button } from './ui/Button.js';

interface MissionControlDispatchPanelProps {
  agents: number[];
  selectedAgentId: number | null;
  missionControl: MissionControlSnapshot;
  onInspectAgent: (agentId: number) => void;
}

const fieldClassName =
  'w-full bg-bg-dark/90 border-2 border-border px-8 py-6 text-sm text-text placeholder:text-text-muted outline-none';

function parseList(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function MissionControlDispatchPanel({
  agents,
  selectedAgentId,
  missionControl,
  onInspectAgent,
}: MissionControlDispatchPanelProps) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [selectedAgentIdForSubmit, setSelectedAgentIdForSubmit] = useState<string>('');
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [constraints, setConstraints] = useState('');
  const [expectedArtifacts, setExpectedArtifacts] = useState('');

  const sessionsById = useMemo(
    () => new Map(missionControl.sessions.map((session) => [session.id, session] as const)),
    [missionControl.sessions],
  );

  const dispatchableSessions = useMemo(
    () =>
      agents
        .map((agentId) => missionControl.activeSessionByAgentId[agentId])
        .map((sessionId) => (sessionId ? sessionsById.get(sessionId) : undefined))
        .filter(
          (session): session is MissionControlAgentSession => !!session && !session.isExternal,
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [agents, missionControl.activeSessionByAgentId, sessionsById],
  );

  useEffect(() => {
    if (dispatchableSessions.length === 0) {
      setSelectedAgentIdForSubmit('');
      return;
    }

    const stillExists = dispatchableSessions.some(
      (session) => session.agentId.toString() === selectedAgentIdForSubmit,
    );
    if (!stillExists) {
      const preferredSession =
        (selectedAgentId !== null &&
          dispatchableSessions.find((session) => session.agentId === selectedAgentId)) ||
        dispatchableSessions[0];
      setSelectedAgentIdForSubmit(preferredSession.agentId.toString());
    }
  }, [dispatchableSessions, selectedAgentId, selectedAgentIdForSubmit]);

  const handleSubmitTask = () => {
    const agentId = Number(selectedAgentIdForSubmit);
    if (!goal.trim() || !Number.isFinite(agentId)) return;

    vscode.postMessage({
      type: 'submitMissionTask',
      agentId,
      title: title.trim() || undefined,
      goal: goal.trim(),
      acceptanceCriteria: parseList(acceptanceCriteria),
      constraints: parseList(constraints),
      expectedArtifacts: parseList(expectedArtifacts),
    });

    setTitle('');
    setGoal('');
    setAcceptanceCriteria('');
    setConstraints('');
    setExpectedArtifacts('');
    setShowAdvancedFields(false);
  };

  return (
    <div className="h-full overflow-y-auto px-12 py-12">
      <section className="pixel-panel bg-bg-dark/55 px-10 py-10">
        <div className="flex items-start justify-between gap-8">
          <div>
            <div className="text-lg text-white">Dispatch Work</div>
            <div className="mt-2 text-2xs leading-relaxed text-text-muted">
              Pick one agent, give it a short title and a clear goal, then dispatch.
            </div>
          </div>
          <span className="border border-border px-6 py-2 text-2xs uppercase text-text-muted">
            {dispatchableSessions.length} dispatchable
          </span>
        </div>

        <div className="mt-8 grid gap-6">
          <select
            className={fieldClassName}
            value={selectedAgentIdForSubmit}
            onChange={(event) => setSelectedAgentIdForSubmit(event.target.value)}
            disabled={dispatchableSessions.length === 0}
          >
            <option value="">
              {dispatchableSessions.length === 0 ? 'No dispatchable agents' : 'Assign to agent'}
            </option>
            {dispatchableSessions.map((session) => (
              <option key={session.id} value={session.agentId.toString()}>
                Agent #{session.agentId} · {session.cwd ?? session.projectDir ?? 'Unknown dir'}
              </option>
            ))}
          </select>
          <input
            className={fieldClassName}
            placeholder="Task title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <textarea
            className={`${fieldClassName} min-h-[124px]`}
            placeholder="Goal: what should this agent do?"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
          />

          {showAdvancedFields ? (
            <div className="grid gap-6">
              <textarea
                className={`${fieldClassName} min-h-[82px] text-2xs`}
                placeholder="Acceptance criteria, one per line"
                value={acceptanceCriteria}
                onChange={(event) => setAcceptanceCriteria(event.target.value)}
              />
              <textarea
                className={`${fieldClassName} min-h-[82px] text-2xs`}
                placeholder="Constraints, one per line"
                value={constraints}
                onChange={(event) => setConstraints(event.target.value)}
              />
              <textarea
                className={`${fieldClassName} min-h-[82px] text-2xs`}
                placeholder="Expected artifacts, one per line"
                value={expectedArtifacts}
                onChange={(event) => setExpectedArtifacts(event.target.value)}
              />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-6">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowAdvancedFields((value) => !value)}
            >
              {showAdvancedFields ? 'Hide details' : 'Add details'}
            </Button>
            <Button
              variant="accent"
              onClick={handleSubmitTask}
              disabled={!goal.trim() || !selectedAgentIdForSubmit}
            >
              Dispatch
            </Button>
          </div>
        </div>
      </section>

      <section className="mt-12">
        <div className="mb-6 flex items-center justify-between gap-6">
          <div>
            <div className="text-lg text-white">Available Agents</div>
            <div className="mt-2 text-2xs text-text-muted">
              Choose an agent that already has the right workspace and context.
            </div>
          </div>
          <span className="border border-border px-6 py-2 text-2xs uppercase text-text-muted">
            Ready pool
          </span>
        </div>
        <div className="space-y-6">
          {dispatchableSessions.length > 0 ? (
            dispatchableSessions.map((session) => (
              <button
                key={session.id}
                className="w-full rounded-none border-2 border-border bg-bg-dark/55 px-10 py-8 text-left transition-colors hover:bg-bg-dark/80"
                onClick={() => onInspectAgent(session.agentId)}
              >
                <div className="flex items-start justify-between gap-8">
                  <div className="min-w-0">
                    <div className="text-sm uppercase text-text-muted">
                      Agent #{session.agentId}
                    </div>
                    <div className="mt-3 truncate text-lg text-white">
                      {getSessionTaskLabel(
                        session,
                        session.taskId
                          ? missionControl.tasks.find((task) => task.id === session.taskId)
                          : undefined,
                      )}
                    </div>
                  </div>
                  <span className="border border-border px-6 py-2 text-2xs uppercase text-text-muted">
                    {humanize(session.status)}
                  </span>
                </div>
                <div className="mt-4 text-2xs leading-relaxed text-text-muted">
                  {getSessionProgressLabel(
                    session,
                    session.taskId
                      ? missionControl.tasks.find((task) => task.id === session.taskId)
                      : undefined,
                  )}
                </div>
              </button>
            ))
          ) : (
            <div className="pixel-panel bg-bg-dark/55 px-10 py-10 text-sm text-text-muted">
              No managed agents are available for dispatch.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
