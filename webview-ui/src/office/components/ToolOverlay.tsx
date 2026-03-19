import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { INSPECTOR_TOOL_WIDTH_WINDOW_MS } from '../../constants.js';
import type { AgentStatusInfo, SubagentCharacter } from '../../hooks/useExtensionMessages.js';
import type { OfficeState } from '../engine/officeState.js';
import type { ToolActivity } from '../types.js';
import { TILE_SIZE } from '../types.js';

interface ToolOverlayProps {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  agentToolHistory: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, AgentStatusInfo>;
  subagentCharacters: SubagentCharacter[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  onCloseAgent: (id: number) => void;
  onFocusAgent: (id: number) => void;
  alwaysShowOverlay: boolean;
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
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
        color: accent === 'high' ? '#fff' : 'var(--pixel-text-dim)',
      }}
    >
      <span style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontWeight: accent === 'high' ? 'bold' : 'normal' }}>{value}</span>
    </div>
  );
}

export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  agentToolHistory,
  agentStatuses,
  subagentCharacters,
  containerRef,
  zoom,
  panRef,
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

  const layout = officeState.getLayout();
  const el = containerRef.current;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const canvasW = Math.round(rect.width * dpr);
  const canvasH = Math.round(rect.height * dpr);
  const mapW = layout.cols * TILE_SIZE * zoom;
  const mapH = layout.rows * TILE_SIZE * zoom;
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x);
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y);

  const character = officeState.characters.get(targetId);
  if (!character) return null;

  const tools = agentTools[targetId] || [];
  const activeTool = [...tools].reverse().find((t) => !t.done);
  // Merge past history with current active tools, dedup by toolId, show latest 5
  const pastHistory = agentToolHistory[targetId] || [];
  const activeToolIds = new Set(tools.map((t) => t.toolId));
  const merged = [...pastHistory.filter((t) => !activeToolIds.has(t.toolId)), ...tools];
  const history = merged.slice(-5).reverse();
  const statusInfo = agentStatuses[targetId];
  const status = statusInfo?.status ?? 'active';

  const subagents = subagentCharacters.filter((s) => s.parentAgentId === targetId);

  const positionHint = {
    left: (deviceOffsetX + character.x * zoom) / dpr,
    top: (deviceOffsetY + character.y * zoom) / dpr,
  };
  const panelStyle: CSSProperties = {
    position: 'absolute',
    left: Math.max(160, Math.min(positionHint.left, rect.width - 160)),
    top: Math.max(positionHint.top - 200, 18),
    transform: 'translateX(-50%)',
    background: 'rgba(10,10,20,0.9)',
    border: '2px solid var(--pixel-border)',
    padding: 16,
    boxShadow: 'var(--pixel-shadow)',
    width: 320,
    zIndex: 80,
    pointerEvents: 'auto',
  };

  const activeBadgeColor =
    status === 'waiting'
      ? 'var(--pixel-status-permission)'
      : activeTool
        ? 'var(--pixel-status-active)'
        : 'var(--pixel-text-dim)';

  const confidenceColor =
    activeTool?.confidence === 'high'
      ? '#50d890'
      : activeTool?.confidence === 'low'
        ? '#f2a63c'
        : '#9da4ff';

  const renderToolRow = (tool: ToolActivity, indent = 0) => {
    const duration = tool.done ? (tool.durationMs ?? 0) : now - tool.startTime;
    const width = Math.min(240, Math.max(64, (duration / INSPECTOR_TOOL_WIDTH_WINDOW_MS) * 240));
    const toolLabel = `${tool.statusText}${tool.target ? ` · ${tool.target}` : ''}`;
    return (
      <div
        key={`${tool.toolId}-${tool.parentToolId ?? 'self'}`}
        style={{
          marginLeft: indent,
          marginBottom: 6,
          display: 'flex',
          gap: 6,
          alignItems: 'center',
        }}
      >
        <div
          style={{
            width,
            background: tool.permissionState === 'pending' ? '#f2c14e' : '#4d5bff',
            opacity: tool.done ? 0.6 : 1,
            borderRadius: 0,
            padding: '4px 6px',
            flexGrow: 1,
            color: '#fff',
            fontSize: 13,
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.25)',
          }}
        >
          {toolLabel}
        </div>
        <span
          style={{
            fontSize: 12,
            color: 'var(--pixel-text-dim)',
            minWidth: 60,
            textAlign: 'right',
          }}
        >
          {formatDuration(duration)}
        </span>
      </div>
    );
  };

  return (
    <div style={panelStyle} className="pixel-agents-inspector">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 'bold', color: '#fff' }}>Agent #{targetId}</div>
          {character.folderName && (
            <div style={{ fontSize: 14, color: 'var(--pixel-text-dim)' }}>
              {character.folderName}
            </div>
          )}
        </div>
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: activeBadgeColor,
            marginTop: 6,
          }}
        />
      </div>
      <div
        style={{
          marginTop: 10,
          padding: '8px 10px',
          background: '#131431',
          borderRadius: 0,
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <SummaryLine
          label="Status"
          value={`${status.toUpperCase()}${statusInfo?.inferred ? ' (heuristic)' : ''}`}
        />
        <SummaryLine label="Current" value={activeTool?.statusText ?? 'Idle'} accent="high" />
        {activeTool?.target && (
          <SummaryLine label="Target" value={activeTool.target} accent="dim" />
        )}
        {activeTool?.command && (
          <SummaryLine label="Command" value={activeTool.command} accent="dim" />
        )}
        <SummaryLine
          label="Confidence"
          value={activeTool ? activeTool.confidence : 'unknown'}
          accent="high"
        />
        <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: confidenceColor,
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--pixel-text-dim)' }}>
            {activeTool?.permissionState === 'pending'
              ? `Needs approval${activeTool.inferred ? ' (estimated)' : ''}`
              : activeTool?.permissionState === 'granted'
                ? 'Permission granted'
                : activeTool?.source === 'heuristic'
                  ? 'Auto (estimated)'
                  : 'Auto'}
          </span>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 'bold', color: '#fff', marginBottom: 6 }}>
          Recent tools
        </div>
        {history.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--pixel-text-dim)' }}>No activity yet</div>
        )}
        {history.map((tool) => renderToolRow(tool))}
      </div>

      {subagents.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 'bold', color: '#fff', marginBottom: 4 }}>
            Sub-agents
          </div>
          {subagents.map((sub) => (
            <div
              key={sub.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '4px 0',
                color: 'var(--pixel-text-dim)',
                fontSize: 13,
              }}
            >
              <span>{sub.label}</span>
              <span>#{sub.id}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button
          onClick={() => onFocusAgent(targetId)}
          style={{
            flex: 1,
            fontSize: 14,
            padding: '6px 0',
            border: 'none',
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
            flex: 0.6,
            fontSize: 14,
            padding: '6px 0',
            border: 'none',
            background: 'transparent',
            color: 'var(--pixel-text)',
            borderTop: '2px solid rgba(255,255,255,0.2)',
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
