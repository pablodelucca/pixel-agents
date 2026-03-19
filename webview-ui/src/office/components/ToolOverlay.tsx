/* eslint-disable pixel-agents/no-inline-colors */
import { useEffect, useState } from 'react';

import { INSPECTOR_TOOL_WIDTH_WINDOW_MS } from '../../constants.js';
import type { AgentStatusInfo, SubagentCharacter } from '../../hooks/useExtensionMessages.js';
import type { OfficeState } from '../engine/officeState.js';
import type { ToolActivity } from '../types.js';

interface ToolOverlayProps {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  agentToolHistory: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, AgentStatusInfo>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  subagentToolHistory: Record<number, Record<string, ToolActivity[]>>;
  subagentCharacters: SubagentCharacter[];
  onCloseAgent: (id: number) => void;
  onFocusAgent: (id: number) => void;
  alwaysShowOverlay: boolean;
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function SummaryLine({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'dim' | 'high';
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 8,
        fontSize: 14,
        color: accent === 'high' ? '#fff' : 'var(--pixel-text-dim)',
      }}
    >
      <span style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      <span
        style={{
          fontWeight: accent === 'high' ? 'bold' : 'normal',
          textAlign: 'right',
          maxWidth: 180,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function getPermissionText(tool?: ToolActivity): string {
  if (tool?.permissionState === 'pending') {
    return `Needs approval${tool.inferred ? ' (estimated)' : ''}`;
  }
  if (tool?.permissionState === 'granted') {
    return 'Permission granted';
  }
  if (tool?.source === 'heuristic') {
    return 'Auto (estimated)';
  }
  return 'Auto';
}

function getStatusText(statusInfo?: AgentStatusInfo): string {
  if (!statusInfo) return 'ACTIVE';
  const suffix = statusInfo.inferred ? ' (estimated)' : '';
  return `${statusInfo.status.toUpperCase()}${suffix}`;
}

function mergeToolLists(active: ToolActivity[], history: ToolActivity[]): ToolActivity[] {
  const activeIds = new Set(active.map((tool) => tool.toolId));
  return [...history.filter((tool) => !activeIds.has(tool.toolId)), ...active];
}

function getToolColor(tool: ToolActivity): string {
  if (tool.permissionState === 'pending') return '#f2c14e';
  if (tool.source === 'heuristic') return '#db8bff';
  return tool.done ? '#4d5bff' : '#70d1ff';
}

function ToolHistoryRow({ tool, now }: { tool: ToolActivity; now: number }) {
  const duration = tool.done ? (tool.durationMs ?? 0) : now - tool.startTime;
  const badges = [
    tool.permissionState === 'pending' ? 'approval' : null,
    tool.source === 'heuristic' ? 'heuristic' : null,
    tool.inferred ? 'estimated' : null,
    tool.done ? 'done' : 'active',
  ].filter(Boolean);
  return (
    <div
      style={{
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.03)',
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {tool.statusText}
        </span>
        <span style={{ color: 'var(--pixel-text-dim)', fontSize: 12 }}>
          {formatDuration(duration)}
        </span>
      </div>
      {(tool.target || tool.command) && (
        <div
          style={{
            color: 'var(--pixel-text-dim)',
            fontSize: 12,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {tool.target ?? tool.command}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {badges.map((badge) => (
          <span
            key={badge}
            style={{
              background: badge === 'approval' ? '#6a5318' : 'rgba(255,255,255,0.08)',
              color: badge === 'approval' ? '#ffd979' : 'var(--pixel-text-dim)',
              border: `1px solid ${badge === 'approval' ? '#f2c14e' : 'rgba(255,255,255,0.08)'}`,
              padding: '1px 4px',
              fontSize: 11,
              textTransform: 'uppercase',
            }}
          >
            {badge}
          </span>
        ))}
      </div>
      <div
        style={{
          height: 4,
          background: 'rgba(255,255,255,0.06)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.min(
              100,
              Math.max(14, (duration / INSPECTOR_TOOL_WIDTH_WINDOW_MS) * 100),
            )}%`,
            height: '100%',
            background: getToolColor(tool),
          }}
        />
      </div>
    </div>
  );
}

function SubagentSection({
  now,
  subagent,
  activeTools,
  historyTools,
}: {
  now: number;
  subagent: SubagentCharacter;
  activeTools: ToolActivity[];
  historyTools: ToolActivity[];
}) {
  const merged = mergeToolLists(activeTools, historyTools);
  const current = [...merged].reverse().find((tool) => !tool.done) ?? merged[merged.length - 1];
  const recent = merged.slice(-3).reverse();
  return (
    <div
      style={{
        borderLeft: '2px solid rgba(157,164,255,0.45)',
        paddingLeft: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ color: '#fff', fontSize: 13 }}>{subagent.label}</div>
          <div style={{ color: 'var(--pixel-text-dim)', fontSize: 11 }}>#{subagent.id}</div>
        </div>
        <span style={{ color: '#9da4ff', fontSize: 11, textTransform: 'uppercase' }}>
          {current?.statusText ?? 'idle'}
        </span>
      </div>
      {recent.length === 0 ? (
        <span style={{ color: 'var(--pixel-text-dim)', fontSize: 12 }}>
          No sub-agent activity yet
        </span>
      ) : (
        recent.map((tool) => <ToolHistoryRow key={tool.toolId} tool={tool} now={now} />)
      )}
    </div>
  );
}

export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  agentToolHistory,
  agentStatuses,
  subagentTools,
  subagentToolHistory,
  subagentCharacters,
  onCloseAgent,
  onFocusAgent,
  alwaysShowOverlay,
}: ToolOverlayProps) {
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

  const selectedId = officeState.selectedAgentId;
  if (!selectedId && !alwaysShowOverlay) return null;

  const targetId = selectedId ?? agents[0] ?? null;
  if (!targetId) return null;

  const character = officeState.characters.get(targetId);
  if (!character) return null;

  const activeTools = agentTools[targetId] ?? [];
  const historyTools = agentToolHistory[targetId] ?? [];
  const mergedTools = mergeToolLists(activeTools, historyTools);
  const activeTool = [...mergedTools].reverse().find((tool) => !tool.done);
  const history = mergedTools.slice(-5).reverse();
  const statusInfo = agentStatuses[targetId];

  const confidenceColor =
    activeTool?.confidence === 'high'
      ? '#50d890'
      : activeTool?.confidence === 'low'
        ? '#f2a63c'
        : '#9da4ff';
  const statusColor =
    statusInfo?.status === 'waiting'
      ? '#f2c14e'
      : activeTool?.permissionState === 'pending'
        ? '#f2c14e'
        : activeTool
          ? '#70d1ff'
          : '#8a8fb3';
  const currentDuration = activeTool ? now - activeTool.startTime : undefined;
  const subagents = subagentCharacters.filter((subagent) => subagent.parentAgentId === targetId);

  const subagentSections = subagents.map((subagent) => ({
    subagent,
    activeTools: subagentTools[targetId]?.[subagent.parentToolId] ?? [],
    historyTools: subagentToolHistory[targetId]?.[subagent.parentToolId] ?? [],
  }));

  return (
    <div
      className="pixel-agents-inspector"
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        width: 360,
        maxHeight: 'calc(100% - 24px)',
        overflow: 'auto',
        background: 'rgba(10,10,20,0.94)',
        border: '2px solid var(--pixel-border)',
        padding: 14,
        boxShadow: 'var(--pixel-shadow)',
        zIndex: 85,
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}
      >
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>Agent #{targetId}</div>
          <div style={{ fontSize: 12, color: 'var(--pixel-text-dim)' }}>
            {character.folderName ?? 'workspace root'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: statusColor,
              marginTop: 3,
            }}
          />
          <span style={{ color: 'var(--pixel-text-dim)', fontSize: 12 }}>
            {getStatusText(statusInfo)}
          </span>
        </div>
      </div>

      <div
        style={{
          padding: '10px 12px',
          background: '#131431',
          border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <SummaryLine label="Current" value={activeTool?.statusText ?? 'Idle'} accent="high" />
        {activeTool?.target && <SummaryLine label="Target" value={activeTool.target} />}
        {activeTool?.command && <SummaryLine label="Command" value={activeTool.command} />}
        <SummaryLine
          label="Elapsed"
          value={activeTool ? formatDuration(currentDuration) : '—'}
          accent="high"
        />
        <SummaryLine
          label="Permission"
          value={getPermissionText(activeTool)}
          accent={activeTool?.permissionState === 'pending' ? 'high' : 'dim'}
        />
        <div
          style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}
        >
          <span
            style={{ color: 'var(--pixel-text-dim)', fontSize: 12, textTransform: 'uppercase' }}
          >
            Confidence
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: confidenceColor,
              }}
            />
            <span style={{ color: '#fff', fontSize: 13 }}>
              {activeTool?.confidence ?? 'unknown'}
              {activeTool?.inferred ? ' · estimated' : ''}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          <span
            style={{
              fontSize: 11,
              padding: '1px 4px',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--pixel-text-dim)',
              textTransform: 'uppercase',
            }}
          >
            source: {activeTool?.source ?? statusInfo?.source ?? 'transcript'}
          </span>
          {statusInfo?.inferred && (
            <span
              style={{
                fontSize: 11,
                padding: '1px 4px',
                border: '1px solid #f2c14e',
                color: '#ffd979',
                textTransform: 'uppercase',
              }}
            >
              inferred waiting
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>
          Recent actions
        </div>
        {history.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--pixel-text-dim)' }}>No activity yet</div>
        ) : (
          history.map((tool) => <ToolHistoryRow key={tool.toolId} tool={tool} now={now} />)
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>
          Sub-agent tree
        </div>
        {subagentSections.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--pixel-text-dim)' }}>No active sub-agents</div>
        ) : (
          subagentSections.map(
            ({ subagent, activeTools: subActiveTools, historyTools: subHistoryTools }) => (
              <SubagentSection
                key={subagent.id}
                now={now}
                subagent={subagent}
                activeTools={subActiveTools}
                historyTools={subHistoryTools}
              />
            ),
          )
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onFocusAgent(targetId)}
          style={{
            flex: 1,
            fontSize: 14,
            padding: '7px 0',
            border: '1px solid var(--pixel-accent)',
            background: 'var(--pixel-accent)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Focus Terminal
        </button>
        <button
          onClick={() => onCloseAgent(targetId)}
          style={{
            width: 92,
            fontSize: 14,
            padding: '7px 0',
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'transparent',
            color: 'var(--pixel-text)',
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
