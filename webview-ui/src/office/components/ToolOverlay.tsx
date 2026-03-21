import { useEffect, useState } from 'react';

import {
  formatToolDuration,
  getToolActivityColor,
  mergeToolActivityLists,
} from '../../agentVisibilityUtils.js';
import {
  AGENT_VIS_BG_WARNING,
  AGENT_VIS_BORDER,
  AGENT_VIS_BORDER_FAINT,
  AGENT_VIS_BORDER_STRONG,
  AGENT_VIS_BORDER_SUBAGENT,
  AGENT_VIS_CARD_BG,
  AGENT_VIS_COLOR_ACTIVE,
  AGENT_VIS_COLOR_CONFIDENT,
  AGENT_VIS_COLOR_LOW_CONFIDENCE,
  AGENT_VIS_COLOR_PENDING,
  AGENT_VIS_LABEL_BG,
  AGENT_VIS_PANEL_BG,
  AGENT_VIS_TEXT,
  AGENT_VIS_TEXT_DIM,
  AGENT_VIS_TEXT_MUTED,
  AGENT_VIS_TEXT_WARNING,
  INSPECTOR_TOOL_WIDTH_WINDOW_MS,
} from '../../constants.js';
import type { AgentStatusInfo, SubagentDescriptor } from '../../hooks/useExtensionMessages.js';
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
  subagentDescriptors: Record<number, Record<string, SubagentDescriptor>>;
  onCloseAgent: (id: number) => void;
  onFocusAgent: (id: number) => void;
  alwaysShowOverlay: boolean;
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
        fontSize: 16,
        color: accent === 'high' ? AGENT_VIS_TEXT : 'var(--pixel-text-dim)',
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
        border: `1px solid ${AGENT_VIS_BORDER}`,
        background: AGENT_VIS_CARD_BG,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{
            color: AGENT_VIS_TEXT,
            fontSize: 15,
            fontWeight: 700,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {tool.statusText}
        </span>
        <span style={{ color: 'var(--pixel-text-dim)', fontSize: 14 }}>
          {formatToolDuration(duration)}
        </span>
      </div>
      {(tool.target || tool.command) && (
        <div
          style={{
            color: 'var(--pixel-text-dim)',
            fontSize: 13,
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
              background: badge === 'approval' ? AGENT_VIS_BG_WARNING : AGENT_VIS_BORDER,
              color: badge === 'approval' ? AGENT_VIS_TEXT_WARNING : 'var(--pixel-text-dim)',
              border: `1px solid ${badge === 'approval' ? AGENT_VIS_COLOR_PENDING : AGENT_VIS_BORDER}`,
              padding: '2px 6px',
              fontSize: 12,
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
          background: AGENT_VIS_BORDER_FAINT,
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
            background: getToolActivityColor(tool),
          }}
        />
      </div>
    </div>
  );
}

function SubagentSection({
  now,
  descriptor,
  activeTools,
  historyTools,
}: {
  now: number;
  descriptor: SubagentDescriptor;
  activeTools: ToolActivity[];
  historyTools: ToolActivity[];
}) {
  const merged = mergeToolActivityLists(activeTools, historyTools);
  const current = [...merged].reverse().find((tool) => !tool.done) ?? merged[merged.length - 1];
  const recent = merged.slice(-3).reverse();
  return (
    <div
      style={{
        borderLeft: `2px solid ${AGENT_VIS_BORDER_SUBAGENT}`,
        paddingLeft: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        opacity: descriptor.isActive ? 1 : 0.88,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ color: AGENT_VIS_TEXT, fontSize: 15 }}>{descriptor.label}</div>
          <div style={{ color: 'var(--pixel-text-dim)', fontSize: 13 }}>
            #{descriptor.lastKnownSubagentId ?? '—'}
          </div>
        </div>
        <span style={{ color: AGENT_VIS_TEXT_MUTED, fontSize: 13, textTransform: 'uppercase' }}>
          {descriptor.isActive ? (current?.statusText ?? 'active') : 'completed'}
        </span>
      </div>
      {recent.length === 0 ? (
        <span style={{ color: 'var(--pixel-text-dim)', fontSize: 14 }}>
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
  subagentDescriptors,
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
  const mergedTools = mergeToolActivityLists(activeTools, historyTools);
  const activeTool = [...mergedTools].reverse().find((tool) => !tool.done);
  const history = mergedTools.slice(-5).reverse();
  const statusInfo = agentStatuses[targetId];

  const confidenceColor =
    activeTool?.confidence === 'high'
      ? AGENT_VIS_COLOR_CONFIDENT
      : activeTool?.confidence === 'low'
        ? AGENT_VIS_COLOR_LOW_CONFIDENCE
        : AGENT_VIS_TEXT_MUTED;
  const statusColor =
    statusInfo?.status === 'waiting'
      ? AGENT_VIS_COLOR_PENDING
      : activeTool?.permissionState === 'pending'
        ? AGENT_VIS_COLOR_PENDING
        : activeTool
          ? AGENT_VIS_COLOR_ACTIVE
          : AGENT_VIS_TEXT_DIM;
  const currentDuration = activeTool ? now - activeTool.startTime : undefined;
  const subagentSections = Object.values(subagentDescriptors[targetId] ?? {})
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map((descriptor) => ({
      descriptor,
      activeTools: subagentTools[targetId]?.[descriptor.parentToolId] ?? [],
      historyTools: subagentToolHistory[targetId]?.[descriptor.parentToolId] ?? [],
    }))
    .filter(({ descriptor, activeTools, historyTools }) => {
      if (descriptor.isActive) return true;
      if (activeTools.length > 0) return true;
      return historyTools.length > 0;
    });

  return (
    <div
      className="pixel-agents-inspector"
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        width: 'min(440px, calc(100% - 24px))',
        maxHeight: 'calc(100% - 24px)',
        overflow: 'auto',
        background: AGENT_VIS_PANEL_BG,
        border: '2px solid var(--pixel-border)',
        padding: 18,
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
          <div style={{ fontSize: 26, fontWeight: 700, color: AGENT_VIS_TEXT }}>
            Agent #{targetId}
          </div>
          <div style={{ fontSize: 14, color: 'var(--pixel-text-dim)' }}>
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
          <span style={{ color: 'var(--pixel-text-dim)', fontSize: 14 }}>
            {getStatusText(statusInfo)}
          </span>
        </div>
      </div>

      <div
        style={{
          padding: '10px 12px',
          background: AGENT_VIS_LABEL_BG,
          border: `1px solid ${AGENT_VIS_BORDER}`,
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
          value={activeTool ? formatToolDuration(currentDuration) : '—'}
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
            style={{ color: 'var(--pixel-text-dim)', fontSize: 14, textTransform: 'uppercase' }}
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
            <span style={{ color: AGENT_VIS_TEXT, fontSize: 15 }}>
              {activeTool?.confidence ?? 'unknown'}
              {activeTool?.inferred ? ' · estimated' : ''}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          <span
            style={{
              fontSize: 12,
              padding: '2px 6px',
              border: `1px solid ${AGENT_VIS_BORDER}`,
              color: 'var(--pixel-text-dim)',
              textTransform: 'uppercase',
            }}
          >
            source: {activeTool?.source ?? statusInfo?.source ?? 'transcript'}
          </span>
          {statusInfo?.inferred && (
            <span
              style={{
                fontSize: 12,
                padding: '2px 6px',
                border: `1px solid ${AGENT_VIS_COLOR_PENDING}`,
                color: AGENT_VIS_TEXT_WARNING,
                textTransform: 'uppercase',
              }}
            >
              inferred waiting
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: AGENT_VIS_TEXT,
            textTransform: 'uppercase',
          }}
        >
          Recent actions
        </div>
        {history.length === 0 ? (
          <div style={{ fontSize: 14, color: 'var(--pixel-text-dim)' }}>No activity yet</div>
        ) : (
          history.map((tool) => <ToolHistoryRow key={tool.toolId} tool={tool} now={now} />)
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: AGENT_VIS_TEXT,
            textTransform: 'uppercase',
          }}
        >
          Sub-agent tree
        </div>
        {subagentSections.length === 0 ? (
          <div style={{ fontSize: 14, color: 'var(--pixel-text-dim)' }}>
            No sub-agent activity yet
          </div>
        ) : (
          subagentSections.map(
            ({ descriptor, activeTools: subActiveTools, historyTools: subHistoryTools }) => (
              <SubagentSection
                key={`${descriptor.parentAgentId}-${descriptor.parentToolId}`}
                now={now}
                descriptor={descriptor}
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
            fontSize: 16,
            padding: '9px 0',
            border: '2px solid var(--pixel-accent)',
            background: 'var(--pixel-accent)',
            color: AGENT_VIS_TEXT,
            boxShadow: 'var(--pixel-shadow)',
            cursor: 'pointer',
          }}
        >
          Focus Terminal
        </button>
        <button
          onClick={() => onCloseAgent(targetId)}
          style={{
            width: 100,
            fontSize: 16,
            padding: '9px 0',
            border: `2px solid ${AGENT_VIS_BORDER_STRONG}`,
            background: 'transparent',
            color: 'var(--pixel-text)',
            boxShadow: 'var(--pixel-shadow)',
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
