import { useEffect, useState } from 'react';

import type { SubagentCharacter } from '../hooks/useExtensionMessages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { CharacterState, TILE_SIZE } from '../office/types.js';

interface AgentLabelsProps {
  officeState: OfficeState;
  agents: number[];
  agentStatuses: Record<number, string>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  subagentCharacters: SubagentCharacter[];
}

export function AgentLabels({
  officeState,
  agents,
  agentStatuses,
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

  const el = containerRef.current;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  // Compute device pixel offset (same math as renderFrame, including pan)
  const canvasW = Math.round(rect.width * dpr);
  const canvasH = Math.round(rect.height * dpr);
  const layout = officeState.getLayout();
  const mapW = layout.cols * TILE_SIZE * zoom;
  const mapH = layout.rows * TILE_SIZE * zoom;
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x);
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y);

  // Build sub-agent label lookup
  const subLabelMap = new Map<number, string>();
  for (const sub of subagentCharacters) {
    subLabelMap.set(sub.id, sub.label);
  }

  // All character IDs to render labels for (regular agents + sub-agents)
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch) return null;

        // Character position: device pixels → CSS pixels (follow sitting offset)
        const sittingOffset = ch.state === CharacterState.TYPE ? 6 : 0;
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
        const screenY = (deviceOffsetY + (ch.y + sittingOffset - 24) * zoom) / dpr;

        const status = agentStatuses[id];
        const isWaiting = status === 'waiting';
        const isActive = ch.isActive;
        const isSub = ch.isSubagent;

        let dotColor = 'transparent';
        if (isWaiting) {
          dotColor = 'var(--color-status-permission)';
        } else if (isActive) {
          dotColor = 'var(--color-status-active)';
        }

        const labelText = subLabelMap.get(id) || `Agent #${id}`;

        return (
          <div
            key={id}
            className="absolute flex flex-col items-center pointer-events-none z-40 -translate-x-1/2"
            style={{ left: screenX, top: screenY - 16 }}
          >
            {dotColor !== 'transparent' && (
              <span
                className={`w-6 h-6 rounded-full mb-2 ${isActive && !isWaiting ? 'pixel-agents-pulse' : ''}`}
                style={{ background: dotColor }}
              />
            )}
            <span
              className={`bg-bg/70 py-[1px] px-4 rounded-[2px] whitespace-nowrap  ${isSub ? 'text-2xs italic overflow-hidden text-ellipsis max-w-[120px]' : 'text-xs'}`}
            >
              {labelText}
            </span>
          </div>
        );
      })}
    </>
  );
}
