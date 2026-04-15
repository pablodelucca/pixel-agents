import { useEffect, useState } from 'react';

import type {
  MissionControlAgentSession,
  MissionControlSnapshot,
  MissionControlTask,
} from '../../../../shared/missionControl.ts';
import {
  formatTokenUsageSummary,
  getSessionProgressLabel,
  getSessionTaskLabel,
  getSessionTone,
} from '../../components/missionControlUtils.js';
import { Button } from '../../components/ui/Button.js';
import { CHARACTER_SITTING_OFFSET_PX, TOOL_OVERLAY_VERTICAL_OFFSET } from '../../constants.js';
import type { SubagentCharacter } from '../../hooks/useExtensionMessages.js';
import type { OfficeState } from '../engine/officeState.js';
import type { ToolActivity } from '../types.js';
import { CharacterState, TILE_SIZE } from '../types.js';

interface ToolOverlayProps {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  subagentCharacters: SubagentCharacter[];
  missionControl: MissionControlSnapshot;
  isMissionControlOpen: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  onCloseAgent: (id: number) => void;
  alwaysShowOverlay: boolean;
}

function getActivityText(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
): string {
  const tools = agentTools[agentId];
  if (tools && tools.length > 0) {
    // Find the latest non-done tool
    const activeTool = [...tools].reverse().find((t) => !t.done);
    if (activeTool) {
      if (activeTool.permissionWait) return 'Needs approval';
      return activeTool.status;
    }
    // All tools done but agent still active (mid-turn) — keep showing last tool status
    if (isActive) {
      const lastTool = tools[tools.length - 1];
      if (lastTool) return lastTool.status;
    }
  }

  return 'Idle';
}

function getSessionForAgent(
  agentId: number,
  missionControl: MissionControlSnapshot,
): MissionControlAgentSession | undefined {
  const activeSessionId = missionControl.activeSessionByAgentId[agentId];
  const sessions = missionControl.sessions.filter((session) => session.agentId === agentId);
  return (
    sessions.find((session) => session.id === activeSessionId) ??
    [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  );
}

function getTaskForSession(
  session: MissionControlAgentSession | undefined,
  missionControl: MissionControlSnapshot,
): MissionControlTask | undefined {
  if (!session?.taskId) return undefined;
  return missionControl.tasks.find((task) => task.id === session.taskId);
}

function getOverlayDotColor(
  session: MissionControlAgentSession | undefined,
  hasPermission: boolean,
  hasActiveTools: boolean,
  isActive: boolean,
): string | null {
  if (hasPermission) return 'var(--color-status-permission)';
  if (
    session?.status === 'blocked' ||
    session?.status === 'failed' ||
    session?.status === 'stopped'
  ) {
    return 'var(--color-status-error)';
  }
  if (session?.status === 'waiting_approval') return 'var(--color-status-permission)';
  if (session?.status === 'active' || session?.status === 'starting') {
    return 'var(--color-status-active)';
  }
  if (isActive && hasActiveTools) return 'var(--color-status-active)';
  return null;
}

export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  subagentCharacters,
  missionControl,
  isMissionControlOpen,
  containerRef,
  zoom,
  panRef,
  onCloseAgent,
  alwaysShowOverlay,
}: ToolOverlayProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const el = containerRef.current;
  if (isMissionControlOpen) return null;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const canvasW = Math.round(rect.width * dpr);
  const canvasH = Math.round(rect.height * dpr);
  const layout = officeState.getLayout();
  const mapW = layout.cols * TILE_SIZE * zoom;
  const mapH = layout.rows * TILE_SIZE * zoom;
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x);
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y);

  const selectedId = officeState.selectedAgentId;
  const hoveredId = officeState.hoveredAgentId;

  // All character IDs
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch) return null;

        const isSelected = selectedId === id;
        const isHovered = hoveredId === id;
        const isSub = ch.isSubagent;
        const isExpanded = isSelected || isHovered;
        const session = isSub ? undefined : getSessionForAgent(id, missionControl);
        const task = getTaskForSession(session, missionControl);
        const shouldPinOverlay =
          !isSub &&
          !!session &&
          (!!task ||
            session.status === 'active' ||
            session.status === 'starting' ||
            session.status === 'waiting_approval' ||
            session.status === 'blocked' ||
            (!!session.lastActionSummary && session.status === 'waiting_input'));

        // Always keep live mission-control context visible for agents with assigned work.
        if (!alwaysShowOverlay && !isSelected && !isHovered && !shouldPinOverlay) return null;

        // Position above character
        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
        const screenY =
          (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr;

        // Get activity text
        const subHasPermission = isSub && ch.bubbleType === 'permission';
        let titleText: string;
        let activityText: string;
        if (isSub) {
          titleText = 'Subtask';
          if (subHasPermission) {
            activityText = 'Needs approval';
          } else {
            const sub = subagentCharacters.find((s) => s.id === id);
            activityText = sub ? sub.label : 'Subtask';
          }
        } else {
          const toolActivityText = getActivityText(id, agentTools, ch.isActive);
          titleText = getSessionTaskLabel(
            session ?? {
              id: '',
              agentId: id,
              provider: 'codex',
              status: 'queued',
              startedAt: '',
              updatedAt: '',
              approvalCount: 0,
              artifactCount: 0,
            },
            task,
          );
          activityText =
            toolActivityText !== 'Idle'
              ? toolActivityText
              : session
                ? getSessionProgressLabel(session, task)
                : 'Idle';
        }

        // Determine dot color
        const tools = agentTools[id];
        const hasPermission = subHasPermission || tools?.some((t) => t.permissionWait && !t.done);
        const hasActiveTools = tools?.some((t) => !t.done);
        const isActive = ch.isActive;
        const dotColor = getOverlayDotColor(session, !!hasPermission, !!hasActiveTools, isActive);
        const statusTone = session
          ? getSessionTone(session.status)
          : 'text-text-muted border-border';

        return (
          <div
            key={id}
            className="absolute flex flex-col items-center -translate-x-1/2"
            style={{
              left: screenX,
              top: screenY - (ch.folderName ? (isExpanded ? 44 : 36) : isExpanded ? 40 : 32),
              pointerEvents: isSelected ? 'auto' : 'none',
              opacity:
                alwaysShowOverlay && !isSelected && !isHovered && !shouldPinOverlay
                  ? isSub
                    ? 0.5
                    : 0.75
                  : 1,
              zIndex: isSelected ? 42 : 41,
            }}
          >
            <div
              className={`pixel-panel border-border bg-bg/92 ${
                isExpanded ? 'max-w-[260px] px-8 pb-6 pt-5' : 'max-w-[200px] px-7 pb-4 pt-4'
              }`}
            >
              <div className="flex items-start gap-5 min-w-0 flex-1">
                {dotColor && (
                  <span
                    className={`mt-1 shrink-0 rounded-full ${
                      isExpanded ? 'h-6 w-6' : 'h-5 w-5'
                    } ${isActive && !hasPermission ? 'pixel-pulse' : ''}`}
                    style={{ background: dotColor }}
                  />
                )}
                <div className="flex flex-col gap-2 overflow-hidden min-w-0">
                  {!isSub && session && isExpanded && (
                    <span
                      className={`border px-4 py-1 text-2xs uppercase leading-none w-fit ${statusTone}`}
                    >
                      {session.status.replace(/_/g, ' ')}
                    </span>
                  )}
                  <span
                    className="overflow-hidden text-ellipsis block leading-none text-white"
                    style={{
                      fontSize: isSub ? '20px' : isExpanded ? '22px' : '20px',
                      fontStyle: isSub ? 'italic' : undefined,
                    }}
                  >
                    {isSub ? activityText : titleText}
                  </span>
                  {!isSub && isExpanded && (
                    <span className="text-2xs leading-snug overflow-hidden text-ellipsis block text-text-muted">
                      {activityText}
                    </span>
                  )}
                  {!isSub && session && isExpanded && (
                    <div className="flex flex-wrap gap-3 text-2xs text-text-muted">
                      <span className="border border-border px-4 py-1">
                        {formatTokenUsageSummary(session.tokenUsage)}
                      </span>
                      {ch.folderName && (
                        <span className="border border-border px-4 py-1">{ch.folderName}</span>
                      )}
                    </div>
                  )}
                  {ch.folderName && (
                    <span
                      className={`leading-none overflow-hidden text-ellipsis block ${
                        isExpanded ? 'hidden' : 'text-2xs'
                      }`}
                    >
                      {ch.folderName}
                    </span>
                  )}
                </div>
              </div>
              {isSelected && !isSub && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseAgent(id);
                  }}
                  title="Close agent"
                  className="ml-2 shrink-0 leading-none"
                >
                  ×
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
