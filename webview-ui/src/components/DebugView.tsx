import { useEffect, useState } from 'react';

import type { ToolActivity } from '../office/types.js';
import { vscode } from '../vscodeApi.js';

interface DebugViewProps {
  agents: number[];
  selectedAgent: number | null;
  agentTools: Record<number, ToolActivity[]>;
  agentToolHistory: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, string>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  subagentToolHistory: Record<number, Record<string, ToolActivity[]>>;
  onSelectAgent: (id: number) => void;
}

const DEBUG_Z = 40;
const TIMELINE_WINDOW_MS = 8000;

function formatDuration(ms?: number) {
  if (ms === undefined) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function renderToolChip(tool: ToolActivity, now: number) {
  const duration = tool.done ? (tool.durationMs ?? 0) : now - tool.startTime;
  const width = Math.min(220, Math.max(48, (duration / TIMELINE_WINDOW_MS) * 220));
  const color = tool.permissionState === 'pending' ? '#f7c04f' : tool.done ? '#5a5fff' : '#70d1ff';
  return (
    <div
      key={`${tool.toolId}-${tool.parentToolId ?? 'self'}`}
      style={{
        width,
        borderRadius: 4,
        background: color,
        padding: '3px 6px',
        fontSize: 12,
        color: '#030312',
        fontWeight: 600,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)',
        marginBottom: 4,
        textOverflow: 'ellipsis',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      {tool.statusText} · {formatDuration(duration)}
    </div>
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
  onSelectAgent,
}: DebugViewProps) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setNow(Date.now());
      rafId = requestAnimationFrame(tick);
    };
    setNow(Date.now());
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'var(--vscode-editor-background)',
        zIndex: DEBUG_Z,
        overflow: 'auto',
      }}
    >
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {agents.map((id) => {
          const isSelected = selectedAgent === id;
          const activeTools = agentTools[id] ?? [];
          const pastTools = agentToolHistory[id] ?? [];
          const activeIds = new Set(activeTools.map((t) => t.toolId));
          const tools = [...pastTools.filter((t) => !activeIds.has(t.toolId)), ...activeTools];
          const activeSubs = subagentTools[id] ?? {};
          const pastSubs = subagentToolHistory[id] ?? {};
          // Merge sub-agent tools with history
          const allSubKeys = new Set([...Object.keys(activeSubs), ...Object.keys(pastSubs)]);
          const subs: Record<string, ToolActivity[]> = {};
          for (const key of allSubKeys) {
            const active = activeSubs[key] ?? [];
            const past = pastSubs[key] ?? [];
            const ids = new Set(active.map((t) => t.toolId));
            subs[key] = [...past.filter((t) => !ids.has(t.toolId)), ...active];
          }
          const status = agentStatuses[id];
          return (
            <div
              key={id}
              style={{
                border: `2px solid ${isSelected ? '#5a8cff' : '#3c3c5a'}`,
                borderRadius: 4,
                padding: 12,
                background: isSelected ? 'rgba(90, 140, 255, 0.08)' : 'rgba(255,255,255,0.02)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <button
                  onClick={() => onSelectAgent(id)}
                  style={{
                    background: isSelected ? '#5a8cff' : '#2b2b45',
                    border: 'none',
                    color: '#fff',
                    fontSize: 18,
                    cursor: 'pointer',
                    padding: '4px 10px',
                  }}
                >
                  Agent #{id}
                </button>
                <span
                  style={{
                    alignSelf: 'center',
                    fontSize: 14,
                    textTransform: 'uppercase',
                    color: status === 'waiting' ? '#f7c04f' : '#8a8fb3',
                  }}
                >
                  {status || 'active'}
                </span>
                <button
                  onClick={() => vscode.postMessage({ type: 'closeAgent', id })}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#fff',
                    fontSize: 18,
                    cursor: 'pointer',
                    opacity: 0.7,
                  }}
                >
                  ✕
                </button>
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  minHeight: 40,
                }}
              >
                {tools.length === 0 && (
                  <span style={{ color: '#8a8fb3', fontSize: 13 }}>No recorded tools yet</span>
                )}
                {tools.map((tool) => renderToolChip(tool, now))}
              </div>
              {Object.entries(subs).map(([parentId, toolList]) => (
                <div
                  key={`${id}-${parentId}`}
                  style={{
                    padding: '8px 10px',
                    background: '#151536',
                    borderRadius: 4,
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      color: '#9da4ff',
                      marginBottom: 4,
                      textTransform: 'uppercase',
                    }}
                  >
                    Subtasks from {parentId}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {toolList.map((tool) => renderToolChip(tool, now))}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
