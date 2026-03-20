import { useEffect, useMemo, useState } from 'react';

import {
  AGENT_VIS_BG_WARNING,
  AGENT_VIS_BORDER,
  AGENT_VIS_BORDER_FAINT,
  AGENT_VIS_COLOR_ACTIVE,
  AGENT_VIS_COLOR_PENDING,
  AGENT_VIS_LABEL_BG,
  AGENT_VIS_LABEL_BG_SECONDARY,
  AGENT_VIS_TEXT,
  AGENT_VIS_TEXT_WARNING,
} from '../constants.js';
import type { AgentStatusInfo, SubagentCharacter } from '../hooks/useExtensionMessages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { CharacterState, TILE_SIZE, type ToolActivity } from '../office/types.js';

interface AgentLabelsProps {
  officeState: OfficeState;
  agents: number[];
  agentStatuses: Record<number, AgentStatusInfo>;
  agentTools: Record<number, ToolActivity[]>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  subagentCharacters: SubagentCharacter[];
}

function getActiveToolSummary(tools: ToolActivity[]): string | null {
  const activeTool = [...tools].reverse().find((tool) => !tool.done);
  return activeTool?.statusText ?? tools[tools.length - 1]?.statusText ?? null;
}

export function AgentLabels({
  officeState,
  agents,
  agentStatuses,
  agentTools,
  subagentTools,
  containerRef,
  zoom,
  panRef,
  subagentCharacters,
}: AgentLabelsProps) {
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

  const subagentState = useMemo(() => {
    const map = new Map<number, { summary: string | null; waiting: boolean; inferred: boolean }>();
    for (const subagent of subagentCharacters) {
      const tools = subagentTools[subagent.parentAgentId]?.[subagent.parentToolId] ?? [];
      const currentTool = [...tools].reverse().find((tool) => !tool.done);
      map.set(subagent.id, {
        summary: getActiveToolSummary(tools),
        waiting: tools.some((tool) => tool.permissionState === 'pending' && !tool.done),
        inferred: Boolean(currentTool?.inferred || currentTool?.source === 'heuristic'),
      });
    }
    return map;
  }, [subagentCharacters, subagentTools]);

  const el = containerRef.current;
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

  const allIds = [...agents, ...subagentCharacters.map((subagent) => subagent.id)];

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch) return null;

        const sittingOffset = ch.state === CharacterState.TYPE ? 6 : 0;
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
        const screenY = (deviceOffsetY + (ch.y + sittingOffset - 24) * zoom) / dpr;

        const isSub = ch.isSubagent;
        const status = agentStatuses[id];
        const subagentStateForId = isSub ? subagentState.get(id) : undefined;
        const isWaiting = isSub
          ? (subagentStateForId?.waiting ?? false)
          : status?.status === 'waiting';
        const summary = isSub
          ? (subagentStateForId?.summary ?? null)
          : getActiveToolSummary(agentTools[id] ?? []);
        const confidenceHint = isSub
          ? (subagentStateForId?.inferred ?? false)
          : status?.source === 'heuristic' || status?.inferred;

        const dotColor = isWaiting
          ? AGENT_VIS_COLOR_PENDING
          : ch.isActive
            ? AGENT_VIS_COLOR_ACTIVE
            : 'transparent';
        const labelText =
          subagentCharacters.find((subagent) => subagent.id === id)?.label ?? `Agent #${id}`;

        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY - (isSub ? 24 : 30),
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              pointerEvents: 'none',
              zIndex: 42,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: AGENT_VIS_LABEL_BG,
                border: `2px solid ${AGENT_VIS_BORDER}`,
                boxShadow: '2px 2px 0px #0a0a14',
                padding: '2px 4px',
                maxWidth: isSub ? 124 : 154,
              }}
            >
              {dotColor !== 'transparent' && (
                <span
                  className={!isWaiting && ch.isActive ? 'pixel-agents-pulse' : undefined}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: dotColor,
                    flexShrink: 0,
                  }}
                />
              )}
              <span
                style={{
                  fontSize: isSub ? 11 : 12,
                  fontStyle: isSub ? 'italic' : undefined,
                  color: AGENT_VIS_TEXT,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                }}
              >
                {labelText}
              </span>
              {confidenceHint && (
                <span style={{ color: AGENT_VIS_COLOR_PENDING, fontSize: 10, flexShrink: 0 }}>
                  ?
                </span>
              )}
            </div>
            {summary && !isWaiting && (
              <div
                style={{
                  maxWidth: isSub ? 130 : 160,
                  background: AGENT_VIS_LABEL_BG_SECONDARY,
                  border: `2px solid ${AGENT_VIS_BORDER_FAINT}`,
                  boxShadow: '2px 2px 0px #0a0a14',
                  padding: '1px 4px',
                  color: 'var(--pixel-text-dim)',
                  fontSize: 10,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                }}
              >
                {summary}
              </div>
            )}
            {isWaiting && (
              <div
                style={{
                  background: AGENT_VIS_BG_WARNING,
                  border: `2px solid ${AGENT_VIS_COLOR_PENDING}`,
                  boxShadow: '2px 2px 0px #0a0a14',
                  padding: '1px 4px',
                  color: AGENT_VIS_TEXT_WARNING,
                  fontSize: 10,
                  textTransform: 'uppercase',
                }}
              >
                waiting{confidenceHint ? ' ?' : ''}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
