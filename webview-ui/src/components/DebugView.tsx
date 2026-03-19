/* eslint-disable pixel-agents/no-inline-colors */
import { useEffect, useMemo, useState } from 'react';

import { DEBUG_TIMELINE_WINDOW_MS } from '../constants.js';
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
const LABEL_WIDTH = 160;
const TIMELINE_TICKS = 4;

function formatDuration(ms?: number) {
  if (ms === undefined) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function mergeToolLists(active: ToolActivity[], history: ToolActivity[]): ToolActivity[] {
  const activeIds = new Set(active.map((tool) => tool.toolId));
  return [...history.filter((tool) => !activeIds.has(tool.toolId)), ...active];
}

function getBarColor(tool: ToolActivity): string {
  if (tool.permissionState === 'pending') return '#f2c14e';
  if (tool.source === 'heuristic') return '#db8bff';
  return tool.done ? '#5a5fff' : '#70d1ff';
}

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
        border: '1px solid rgba(255,255,255,0.08)',
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.015) 100%)',
        overflow: 'hidden',
      }}
    >
      {Array.from({ length: TIMELINE_TICKS + 1 }).map((_, idx) => {
        const left = `${(idx / TIMELINE_TICKS) * 100}%`;
        const deltaMs =
          DEBUG_TIMELINE_WINDOW_MS - (idx / TIMELINE_TICKS) * DEBUG_TIMELINE_WINDOW_MS;
        return (
          <div key={left}>
            <div
              style={{
                position: 'absolute',
                left,
                top: 0,
                bottom: 0,
                width: 1,
                background: 'rgba(255,255,255,0.08)',
              }}
            />
            {idx < TIMELINE_TICKS && (
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
                -{formatDuration(deltaMs)}
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
            background: 'rgba(242,193,78,0.12)',
            borderTop: '1px solid rgba(242,193,78,0.5)',
            borderBottom: '1px solid rgba(242,193,78,0.5)',
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
            title={`${tool.statusText} · ${formatDuration(endTime - tool.startTime)}`}
            style={{
              position: 'absolute',
              left: `${leftPct}%`,
              top: tool.permissionState === 'pending' ? 24 : 16,
              height: 12,
              width: `${widthPct}%`,
              minWidth: 6,
              background: getBarColor(tool),
              border: '1px solid rgba(255,255,255,0.18)',
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
        width: LABEL_WIDTH,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 4,
        background: selected ? 'rgba(90, 140, 255, 0.18)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${selected ? '#5a8cff' : 'rgba(255,255,255,0.08)'}`,
        color: '#fff',
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
            background: waiting ? '#f2c14e' : '#70d1ff',
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
            gridTemplateColumns: `${LABEL_WIDTH}px 1fr auto`,
            gap: 10,
            alignItems: 'center',
            color: 'var(--pixel-text-dim)',
            fontSize: 11,
            textTransform: 'uppercase',
          }}
        >
          <span>Agent / Sub-agent</span>
          <span>Timeline rail ({formatDuration(DEBUG_TIMELINE_WINDOW_MS)} window)</span>
          <span>Actions</span>
        </div>

        {agents.map((id) => {
          const mergedTools = mergeToolLists(agentTools[id] ?? [], agentToolHistory[id] ?? []);
          const statusInfo = agentStatuses[id];
          const waiting = statusInfo?.status === 'waiting';
          const latestTool = mergedTools[mergedTools.length - 1];
          const subagents = subagentsByParent.get(id) ?? [];

          return (
            <div
              key={id}
              style={{
                border: `2px solid ${selectedAgent === id ? '#5a8cff' : 'rgba(255,255,255,0.08)'}`,
                background:
                  selectedAgent === id ? 'rgba(90,140,255,0.06)' : 'rgba(255,255,255,0.02)',
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `${LABEL_WIDTH}px 1fr auto`,
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
                      border: '1px solid rgba(255,255,255,0.08)',
                      background: '#2b2b45',
                      color: '#fff',
                      padding: '6px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    Focus
                  </button>
                  <button
                    onClick={() => vscode.postMessage({ type: 'closeAgent', id })}
                    style={{
                      border: '1px solid rgba(255,255,255,0.08)',
                      background: 'transparent',
                      color: '#fff',
                      padding: '6px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>

              {subagents.map((subagent) => {
                const subMerged = mergeToolLists(
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
                      gridTemplateColumns: `${LABEL_WIDTH}px 1fr auto`,
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
                          borderTop: '1px solid rgba(157,164,255,0.45)',
                        }}
                      />
                      <TimelineRail tools={subMerged} now={now} waiting={waitingSub} />
                    </div>
                    <span style={{ color: 'var(--pixel-text-dim)', fontSize: 11 }}>
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
