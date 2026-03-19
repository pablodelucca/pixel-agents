import { useEffect, useMemo, useState } from 'react';

import {
  formatToolDuration,
  getToolActivityColor,
  mergeToolActivityLists,
} from '../agentVisibilityUtils.js';
import {
  AGENT_VIS_ACCENT_BG,
  AGENT_VIS_ACTION_BG,
  AGENT_VIS_BG_WARNING_SOFT,
  AGENT_VIS_BORDER,
  AGENT_VIS_BORDER_STRONG,
  AGENT_VIS_BORDER_SUBAGENT,
  AGENT_VIS_BORDER_WARNING,
  AGENT_VIS_CARD_BG_DIM,
  AGENT_VIS_CARD_BG_FAINT,
  AGENT_VIS_COLOR_ACTIVE,
  AGENT_VIS_COLOR_PENDING,
  AGENT_VIS_COLOR_SELECTED,
  AGENT_VIS_TEXT,
  AGENT_VIS_TEXT_DIM,
  DEBUG_LABEL_WIDTH,
  DEBUG_TIMELINE_TICKS,
  DEBUG_TIMELINE_WINDOW_MS,
} from '../constants.js';
import type { AgentStatusInfo, SubagentCharacter } from '../hooks/useExtensionMessages.js';
import type { ToolActivity } from '../office/types.js';
import { vscode } from '../vscodeApi.js';

interface DebugViewProps {
  agents: number[];
  selectedAgent: number | null;
  agentTools: Record<number, ToolActivity[]>;
  agentToolHistory: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, AgentStatusInfo>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  subagentToolHistory: Record<number, Record<string, ToolActivity[]>>;
  subagentCharacters: SubagentCharacter[];
  onSelectAgent: (id: number) => void;
}

const DEBUG_Z = 40;

function TimelineRail({
  tools,
  now,
  waiting,
}: {
  tools: ToolActivity[];
  now: number;
  waiting: boolean;
}) {
  const windowStart = now - DEBUG_TIMELINE_WINDOW_MS;

  return (
    <div
      style={{
        position: 'relative',
        height: 44,
        border: `1px solid ${AGENT_VIS_BORDER}`,
        background: `linear-gradient(180deg, ${AGENT_VIS_CARD_BG_DIM} 0%, ${AGENT_VIS_CARD_BG_FAINT} 100%)`,
        overflow: 'hidden',
      }}
    >
      {Array.from({ length: DEBUG_TIMELINE_TICKS + 1 }).map((_, idx) => {
        const left = `${(idx / DEBUG_TIMELINE_TICKS) * 100}%`;
        const deltaMs =
          DEBUG_TIMELINE_WINDOW_MS - (idx / DEBUG_TIMELINE_TICKS) * DEBUG_TIMELINE_WINDOW_MS;
        return (
          <div key={left}>
            <div
              style={{
                position: 'absolute',
                left,
                top: 0,
                bottom: 0,
                width: 1,
                background: AGENT_VIS_BORDER,
              }}
            />
            {idx < DEBUG_TIMELINE_TICKS && (
              <span
                style={{
                  position: 'absolute',
                  left,
                  top: 2,
                  transform: 'translateX(-50%)',
                  color: 'var(--pixel-text-dim)',
                  fontSize: 10,
                }}
              >
                -{formatToolDuration(deltaMs)}
              </span>
            )}
          </div>
        );
      })}

      {waiting && (
        <div
          style={{
            position: 'absolute',
            inset: '0 auto 0 0',
            width: '100%',
            background: AGENT_VIS_BG_WARNING_SOFT,
            borderTop: `1px solid ${AGENT_VIS_BORDER_WARNING}`,
            borderBottom: `1px solid ${AGENT_VIS_BORDER_WARNING}`,
          }}
        />
      )}

      {tools.map((tool) => {
        const endTime = tool.done ? tool.startTime + (tool.durationMs ?? 0) : now;
        if (endTime < windowStart) return null;

        const clampedStart = Math.max(tool.startTime, windowStart);
        const leftPct = ((clampedStart - windowStart) / DEBUG_TIMELINE_WINDOW_MS) * 100;
        const widthPct = Math.max(
          1.5,
          ((Math.max(endTime, clampedStart) - clampedStart) / DEBUG_TIMELINE_WINDOW_MS) * 100,
        );

        return (
          <div
            key={`${tool.parentToolId ?? 'root'}-${tool.toolId}`}
            title={`${tool.statusText} · ${formatToolDuration(endTime - tool.startTime)}`}
            style={{
              position: 'absolute',
              left: `${leftPct}%`,
              top: tool.permissionState === 'pending' ? 24 : 16,
              height: 12,
              width: `${widthPct}%`,
              minWidth: 6,
              background: getToolActivityColor(tool),
              border: `1px solid ${AGENT_VIS_BORDER_STRONG}`,
            }}
          />
        );
      })}
    </div>
  );
}

function RowLabel({
  title,
  subtitle,
  selected,
  waiting,
  onClick,
}: {
  title: string;
  subtitle: string;
  selected?: boolean;
  waiting?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: DEBUG_LABEL_WIDTH,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 4,
        background: selected ? AGENT_VIS_ACCENT_BG : AGENT_VIS_CARD_BG_DIM,
        border: `1px solid ${selected ? AGENT_VIS_COLOR_SELECTED : AGENT_VIS_BORDER}`,
        color: AGENT_VIS_TEXT,
        padding: '8px 10px',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: waiting ? AGENT_VIS_COLOR_PENDING : AGENT_VIS_COLOR_ACTIVE,
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
      </div>
      <span
        style={{
          color: 'var(--pixel-text-dim)',
          fontSize: 11,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          maxWidth: '100%',
        }}
      >
        {subtitle}
      </span>
    </button>
  );
}

export function DebugView({
  agents,
  selectedAgent,
  agentTools,
  agentToolHistory,
  agentStatuses,
  subagentTools,
  subagentToolHistory,
  subagentCharacters,
  onSelectAgent,
}: DebugViewProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setNow(Date.now());
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const subagentsByParent = useMemo(() => {
    const map = new Map<number, SubagentCharacter[]>();
    for (const subagent of subagentCharacters) {
      const current = map.get(subagent.parentAgentId) ?? [];
      current.push(subagent);
      map.set(subagent.parentAgentId, current);
    }
    return map;
  }, [subagentCharacters]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--vscode-editor-background)',
        zIndex: DEBUG_Z,
        overflow: 'auto',
      }}
    >
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${DEBUG_LABEL_WIDTH}px 1fr auto`,
            gap: 10,
            alignItems: 'center',
            color: 'var(--pixel-text-dim)',
            fontSize: 11,
            textTransform: 'uppercase',
          }}
        >
          <span>Agent / Sub-agent</span>
          <span>Timeline rail ({formatToolDuration(DEBUG_TIMELINE_WINDOW_MS)} window)</span>
          <span>Actions</span>
        </div>

        {agents.map((id) => {
          const mergedTools = mergeToolActivityLists(
            agentTools[id] ?? [],
            agentToolHistory[id] ?? [],
          );
          const statusInfo = agentStatuses[id];
          const waiting = statusInfo?.status === 'waiting';
          const latestTool = mergedTools[mergedTools.length - 1];
          const subagents = subagentsByParent.get(id) ?? [];

          return (
            <div
              key={id}
              style={{
                border: `2px solid ${selectedAgent === id ? AGENT_VIS_COLOR_SELECTED : AGENT_VIS_BORDER}`,
                background: selectedAgent === id ? AGENT_VIS_ACCENT_BG : AGENT_VIS_CARD_BG_DIM,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `${DEBUG_LABEL_WIDTH}px 1fr auto`,
                  gap: 10,
                  alignItems: 'center',
                }}
              >
                <RowLabel
                  title={`Agent #${id}`}
                  subtitle={
                    waiting
                      ? `waiting${statusInfo?.inferred ? ' · estimated' : ''}`
                      : (latestTool?.statusText ?? 'idle')
                  }
                  waiting={waiting}
                  selected={selectedAgent === id}
                  onClick={() => onSelectAgent(id)}
                />
                <TimelineRail tools={mergedTools} now={now} waiting={waiting} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => onSelectAgent(id)}
                    style={{
                      border: `1px solid ${AGENT_VIS_BORDER}`,
                      background: AGENT_VIS_ACTION_BG,
                      color: AGENT_VIS_TEXT,
                      padding: '6px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    Focus
                  </button>
                  <button
                    onClick={() => vscode.postMessage({ type: 'closeAgent', id })}
                    style={{
                      border: `1px solid ${AGENT_VIS_BORDER}`,
                      background: 'transparent',
                      color: AGENT_VIS_TEXT,
                      padding: '6px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>

              {subagents.map((subagent) => {
                const subMerged = mergeToolActivityLists(
                  subagentTools[id]?.[subagent.parentToolId] ?? [],
                  subagentToolHistory[id]?.[subagent.parentToolId] ?? [],
                );
                const latestSubTool = subMerged[subMerged.length - 1];
                const waitingSub = subMerged.some((tool) => tool.permissionState === 'pending');

                return (
                  <div
                    key={subagent.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `${DEBUG_LABEL_WIDTH}px 1fr auto`,
                      gap: 10,
                      alignItems: 'center',
                      marginLeft: 18,
                    }}
                  >
                    <RowLabel
                      title={subagent.label}
                      subtitle={latestSubTool?.statusText ?? 'idle'}
                      waiting={waitingSub}
                    />
                    <div style={{ position: 'relative' }}>
                      <div
                        style={{
                          position: 'absolute',
                          left: -18,
                          top: '50%',
                          width: 14,
                          borderTop: `1px solid ${AGENT_VIS_BORDER_SUBAGENT}`,
                        }}
                      />
                      <TimelineRail tools={subMerged} now={now} waiting={waitingSub} />
                    </div>
                    <span style={{ color: AGENT_VIS_TEXT_DIM, fontSize: 11 }}>
                      parent: {subagent.parentToolId}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
