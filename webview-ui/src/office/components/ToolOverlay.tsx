import { useState, useEffect } from 'react'
import type { ToolActivity } from '../types.js'
import type { OfficeState } from '../engine/officeState.js'
import type { SubagentCharacter } from '../../hooks/useExtensionMessages.js'
import { TILE_SIZE, CharacterState } from '../types.js'
import { TOOL_OVERLAY_VERTICAL_OFFSET, CHARACTER_SITTING_OFFSET_PX } from '../../constants.js'

interface ToolOverlayProps {
  officeState: OfficeState
  agents: number[]
  agentTools: Record<number, ToolActivity[]>
  agentMessages: Record<number, string>
  subagentCharacters: SubagentCharacter[]
  containerRef: React.RefObject<HTMLDivElement | null>
  zoom: number
  panRef: React.RefObject<{ x: number; y: number }>
  onCloseAgent: (id: number) => void
  isAutoModeActive: boolean
  autoModeResponderId: number | null
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '...'
}

/** Derive a short human-readable activity string from tools/status */
function getActivityText(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
  autoModeTarget: number | null,
  isAutoModeResponder: boolean,
): string {
  const tools = agentTools[agentId]
  if (tools && tools.length > 0) {
    // Find the latest non-done tool
    const activeTool = [...tools].reverse().find((t) => !t.done)
    if (activeTool) {
      if (activeTool.permissionWait) return 'Needs approval'
      return activeTool.status
    }
    // All tools done but agent still active (mid-turn) — keep showing last tool status
    if (isActive) {
      const lastTool = tools[tools.length - 1]
      if (lastTool) return lastTool.status
    }
  }

  // Auto mode: show conversation status instead of Idle
  if (autoModeTarget !== null) {
    if (isActive && isAutoModeResponder) return 'Talking...'
    return 'Listening...'
  }

  return 'Idle'
}

export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  agentMessages,
  subagentCharacters,
  containerRef,
  zoom,
  panRef,
  onCloseAgent,
  isAutoModeActive,
  autoModeResponderId,
}: ToolOverlayProps) {
  const [, setTick] = useState(0)
  useEffect(() => {
    let rafId = 0
    const tick = () => {
      setTick((n) => n + 1)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  const el = containerRef.current
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const canvasW = Math.round(rect.width * dpr)
  const canvasH = Math.round(rect.height * dpr)
  const layout = officeState.getLayout()
  const mapW = layout.cols * TILE_SIZE * zoom
  const mapH = layout.rows * TILE_SIZE * zoom
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x)
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y)

  const selectedId = officeState.selectedAgentId
  const hoveredId = officeState.hoveredAgentId

  // All character IDs
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)]

  return (
    <>
      {/* Emote text badges — visible for any character with an active emote */}
      {Array.from(officeState.characters.values()).map((ch) => {
        if (!ch.emoteBadge || ch.emoteTimer <= 0) return null

        // Fade out in last 0.5s
        const fadeSec = 0.5
        const alpha = ch.emoteTimer < fadeSec ? ch.emoteTimer / fadeSec : 1.0
        if (alpha <= 0) return null

        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr
        const screenY = (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr

        return (
          <div
            key={`emote-${ch.id}`}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY - 52,
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              zIndex: 'var(--pixel-overlay-z)',
              opacity: alpha,
            }}
          >
            <div
              style={{
                background: 'rgba(0, 0, 0, 0.65)',
                border: '2px solid var(--pixel-border)',
                padding: '2px 6px',
                whiteSpace: 'nowrap',
                fontSize: '18px',
                color: '#EEEEFF',
                fontFamily: 'var(--pixel-font, monospace)',
                letterSpacing: '0.5px',
                boxShadow: 'var(--pixel-shadow)',
              }}
            >
              {ch.emoteBadge}
            </div>
          </div>
        )
      })}

      {allIds.map((id) => {
        const ch = officeState.characters.get(id)
        if (!ch) return null

        const isSelected = selectedId === id
        const isHovered = hoveredId === id
        const isSub = ch.isSubagent

        // Only show for hovered or selected agents
        if (!isSelected && !isHovered) return null

        // Position above character
        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr
        const screenY = (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr

        // Get activity text
        const subHasPermission = isSub && ch.bubbleType === 'permission'
        let activityText: string
        let isAutoModeStatus = false
        if (isSub) {
          if (subHasPermission) {
            activityText = 'Needs approval'
          } else {
            const sub = subagentCharacters.find((s) => s.id === id)
            activityText = sub ? sub.label : 'Subtask'
          }
        } else {
          activityText = getActivityText(id, agentTools, ch.isActive, ch.autoModeTarget, isAutoModeActive && autoModeResponderId === id)
          isAutoModeStatus = ch.autoModeTarget !== null && (activityText === 'Talking...' || activityText === 'Listening...')
        }

        // Determine dot color
        const tools = agentTools[id]
        const hasPermission = subHasPermission || tools?.some((t) => t.permissionWait && !t.done)
        const hasActiveTools = tools?.some((t) => !t.done)
        const isActive = ch.isActive

        let dotColor: string | null = null
        if (hasPermission) {
          dotColor = 'var(--pixel-status-permission)'
        } else if (isActive && hasActiveTools) {
          dotColor = 'var(--pixel-status-active)'
        }

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
              pointerEvents: isSelected ? 'auto' : 'none',
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
                <span
                  style={{
                    fontSize: isSub ? '20px' : '22px',
                    fontStyle: isSub ? 'italic' : undefined,
                    color: isAutoModeStatus ? '#ffffff' : 'var(--vscode-foreground)',
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
                {!isSub && agentMessages[id] && (
                  <span
                    style={{
                      fontSize: '18px',
                      color: 'var(--pixel-text-dim)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: 'block',
                      maxWidth: 180,
                      fontStyle: 'italic',
                    }}
                    title={agentMessages[id]}
                  >
                    {truncateText(agentMessages[id], 100)}
                  </span>
                )}
              </div>
              {isSelected && !isSub && !(isAutoModeActive && ch.autoModeTarget !== null) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseAgent(id)
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
                    (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-hover)'
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-text)'
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}
