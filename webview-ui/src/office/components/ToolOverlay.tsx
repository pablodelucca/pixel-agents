import { useEffect, useState } from 'react';

import { CHARACTER_SITTING_OFFSET_PX, TOOL_OVERLAY_VERTICAL_OFFSET } from '../../constants.js';
import type { SubagentCharacter } from '../../hooks/useExtensionMessages.js';
import type { OfficeState } from '../engine/officeState.js';
import type { ToolActivity } from '../types.js';
import { CharacterState, TILE_SIZE } from '../types.js';

interface ToolOverlayProps {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  agentNames: Record<number, string>;
  agentTitles: Record<number, string>;
  subagentCharacters: SubagentCharacter[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  onCloseAgent: (id: number) => void;
  onSetAgentName: (id: number, name: string) => void;
}

/** Derive a short human-readable activity string from tools/status */
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

export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  agentNames,
  agentTitles,
  subagentCharacters,
  containerRef,
  zoom,
  panRef,
  onCloseAgent,
  onSetAgentName,
}: ToolOverlayProps) {
  const [, setTick] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [pinnedId, setPinnedId] = useState<number | null>(null);

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

  const commitEdit = (id: number) => {
    onSetAgentName(id, editValue.trim());
    setEditingId(null);
  };

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch) return null;

        const isSelected = selectedId === id;
        const isHovered = hoveredId === id;
        const isSub = ch.isSubagent;

        const isPinned = pinnedId === id;

        // Only show for hovered, pinned, or selected agents
        if (!isSelected && !isHovered && !isPinned) return null;

        // Position above character
        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
        const screenY =
          (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr;

        // Get activity text
        const subHasPermission = isSub && ch.bubbleType === 'permission';
        let activityText: string;
        if (isSub) {
          if (subHasPermission) {
            activityText = 'Needs approval';
          } else {
            const sub = subagentCharacters.find((s) => s.id === id);
            activityText = sub ? sub.label : 'Subtask';
          }
        } else {
          activityText = getActivityText(id, agentTools, ch.isActive);
        }

        // Determine dot color
        const tools = agentTools[id];
        const hasPermission = subHasPermission || tools?.some((t) => t.permissionWait && !t.done);
        const hasActiveTools = tools?.some((t) => !t.done);
        const isActive = ch.isActive;

        let dotColor: string | null = null;
        if (hasPermission) {
          dotColor = 'var(--pixel-status-permission)';
        } else if (isActive && hasActiveTools) {
          dotColor = 'var(--pixel-status-active)';
        }

        const customName = !isSub ? agentNames[id] : undefined;
        const jobTitle = !isSub ? agentTitles[id] : undefined;
        const isEditing = editingId === id;

        return (
          <div
            key={id}
            onMouseEnter={() => setPinnedId(id)}
            onMouseLeave={() => setPinnedId(null)}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY - 24,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              pointerEvents: isSelected || isHovered || isPinned ? 'auto' : 'none',
              zIndex: isSelected ? 'var(--pixel-overlay-selected-z)' : 'var(--pixel-overlay-z)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: 'var(--pixel-bg)',
                border: isSelected
                  ? '2px solid var(--pixel-border-light)'
                  : '2px solid var(--pixel-border)',
                borderRadius: 0,
                padding: isSelected ? '3px 6px 3px 8px' : '3px 8px',
                boxShadow: 'var(--pixel-shadow)',
                whiteSpace: 'nowrap',
                maxWidth: 220,
              }}
            >
              {dotColor && (
                <span
                  className={isActive && !hasPermission ? 'pixel-agents-pulse' : undefined}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: dotColor,
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ overflow: 'hidden' }}>
                {!isSub &&
                  (isEditing ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => commitEdit(id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit(id);
                        if (e.key === 'Escape') setEditingId(null);
                        e.stopPropagation();
                      }}
                      placeholder={`Agent #${id}`}
                      style={{
                        fontSize: '22px',
                        background: 'var(--vscode-input-background)',
                        color: 'var(--vscode-input-foreground)',
                        border: '1px solid var(--pixel-accent)',
                        borderRadius: 0,
                        padding: '0 2px',
                        width: 120,
                        outline: 'none',
                        fontFamily: 'inherit',
                        display: 'block',
                        marginBottom: 2,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                        marginBottom: jobTitle ? 0 : 1,
                      }}
                    >
                      <span
                        style={{
                          fontSize: '18px',
                          color: customName ? 'var(--pixel-accent)' : 'var(--pixel-text-dim)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {customName || `Agent #${id}`}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditValue(customName || '');
                          setEditingId(id);
                        }}
                        title="Rename agent"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--pixel-text-dim)',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: '14px',
                          lineHeight: 1,
                          flexShrink: 0,
                          opacity: 0.6,
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.opacity = '1';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.opacity = '0.6';
                        }}
                      >
                        ✎
                      </button>
                    </div>
                  ))}
                {jobTitle && (
                  <span
                    style={{
                      fontSize: '15px',
                      color: 'var(--pixel-text-dim)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: 'block',
                      marginBottom: 1,
                      fontStyle: 'italic',
                    }}
                  >
                    {jobTitle}
                  </span>
                )}
                <span
                  style={{
                    fontSize: isSub ? '20px' : '22px',
                    fontStyle: isSub ? 'italic' : undefined,
                    color: 'var(--vscode-foreground)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'block',
                  }}
                >
                  {activityText}
                </span>
                {ch.folderName && (
                  <span
                    style={{
                      fontSize: '16px',
                      color: 'var(--pixel-text-dim)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: 'block',
                    }}
                  >
                    {ch.folderName}
                  </span>
                )}
              </div>
              {isSelected && !isSub && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseAgent(id);
                  }}
                  title="Close agent"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--pixel-close-text)',
                    cursor: 'pointer',
                    padding: '0 2px',
                    fontSize: '26px',
                    lineHeight: 1,
                    marginLeft: 2,
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-hover)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-text)';
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
