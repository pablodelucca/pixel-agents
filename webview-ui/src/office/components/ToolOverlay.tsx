import { useEffect, useState } from 'react';

import { CHARACTER_SITTING_OFFSET_PX, TOOL_OVERLAY_VERTICAL_OFFSET } from '../../constants.js';
import type { AgentCharacterState } from '../../hooks/useExtensionMessages.js';
import type { OfficeState } from '../engine/officeState.js';
import { CharacterState, TILE_SIZE } from '../types.js';

interface WholesaleToolOverlayProps {
  officeState: OfficeState;
  agents: number[];
  agentNames: Record<number, string>;
  agentStates: Record<number, AgentCharacterState>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

/** Get display text for the overlay label */
function getStatusText(agentState: AgentCharacterState | undefined): string {
  if (!agentState) return 'Idle';
  if (agentState.processStatus === 'not_running') return 'Offline';
  if (agentState.bubble?.text) return agentState.bubble.text;
  if (agentState.lastActivity) return agentState.lastActivity;
  return agentState.animState === 'TYPING' ? 'Working...' : 'Idle';
}

/** Get status dot color */
function getDotColor(agentState: AgentCharacterState | undefined): string | null {
  if (!agentState) return null;
  if (agentState.processStatus === 'not_running') return '#f38ba8'; // red — offline
  if (agentState.animState === 'TYPING') return '#a6e3a1'; // green — active
  if (agentState.bubble?.type === 'sleeping') return '#f9e2af'; // yellow — sleeping
  return '#6c7086'; // grey — idle
}

export function WholesaleToolOverlay({
  officeState,
  agents,
  agentNames,
  agentStates,
  containerRef,
  zoom,
  panRef,
}: WholesaleToolOverlayProps) {
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

  return (
    <>
      {agents.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch) return null;

        const isSelected = selectedId === id;
        const isHovered = hoveredId === id;

        if (!isSelected && !isHovered) return null;

        // Position above character
        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
        const screenY =
          (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr;

        const agentState = agentStates[id];
        const name = agentNames[id] ?? `Agent ${id}`;
        const statusText = getStatusText(agentState);
        const dotColor = getDotColor(agentState);
        const isOffline = agentState?.processStatus === 'not_running';

        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY - 24,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              pointerEvents: 'none',
              zIndex: isSelected ? 'var(--pixel-overlay-selected-z)' : 'var(--pixel-overlay-z)',
              opacity: isOffline ? 0.6 : 1,
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
                padding: '3px 8px',
                boxShadow: 'var(--pixel-shadow)',
                whiteSpace: 'nowrap',
                maxWidth: 220,
              }}
            >
              {dotColor && (
                <span
                  className={agentState?.animState === 'TYPING' ? 'pixel-agents-pulse' : undefined}
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
                <span
                  style={{
                    fontSize: '22px',
                    fontWeight: 'bold',
                    color: 'var(--vscode-foreground)',
                    display: 'block',
                  }}
                >
                  {name}
                </span>
                <span
                  style={{
                    fontSize: '18px',
                    color: 'var(--pixel-text-dim)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'block',
                  }}
                >
                  {statusText}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
