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
  subagentCharacters: SubagentCharacter[]
  containerRef: React.RefObject<HTMLDivElement | null>
  zoom: number
  panRef: React.RefObject<{ x: number; y: number }>
  onCloseAgent: (id: number) => void
  onFocusAgent: (id: number) => void
  onUpdateAgentRole: (id: number, role: string, taskNote: string, isBlocked: boolean) => void
}

/** Derive a short human-readable activity string from tools/status */
function getActivityText(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
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

  return 'Idle'
}

interface RoleEditSectionProps {
  id: number
  role: string
  taskNote: string
  isBlocked: boolean
  onUpdateAgentRole: (id: number, role: string, taskNote: string, isBlocked: boolean) => void
}

function RoleEditSection({ id, role, taskNote, isBlocked, onUpdateAgentRole }: RoleEditSectionProps) {
  const [editingField, setEditingField] = useState<'role' | 'note' | null>(null)
  const [draftRole, setDraftRole] = useState(role)
  const [draftNote, setDraftNote] = useState(taskNote)

  // Sync drafts when props change (e.g. restored from persistence)
  useEffect(() => { setDraftRole(role) }, [role])
  useEffect(() => { setDraftNote(taskNote) }, [taskNote])

  const commitRole = () => {
    setEditingField(null)
    onUpdateAgentRole(id, draftRole, taskNote, isBlocked)
  }

  const commitNote = () => {
    setEditingField(null)
    onUpdateAgentRole(id, role, draftNote, isBlocked)
  }

  const toggleBlocked = () => {
    onUpdateAgentRole(id, role, taskNote, !isBlocked)
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--pixel-bg)',
    color: 'var(--vscode-foreground)',
    border: '2px solid var(--pixel-accent)',
    borderRadius: 0,
    fontSize: '20px',
    padding: '2px 4px',
    outline: 'none',
    width: 140,
    fontFamily: 'inherit',
  }

  const iconBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: 'var(--pixel-text-dim)',
    cursor: 'pointer',
    padding: '0 2px',
    fontSize: '18px',
    lineHeight: 1,
    flexShrink: 0,
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderTop: 'none',
        padding: '4px 6px',
        gap: 3,
        minWidth: 160,
        boxShadow: 'var(--pixel-shadow)',
      }}
    >
      {/* Role row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {editingField === 'role' ? (
          <>
            <input
              autoFocus
              value={draftRole}
              onChange={(e) => setDraftRole(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRole()
                if (e.key === 'Escape') { setDraftRole(role); setEditingField(null) }
              }}
              onBlur={commitRole}
              placeholder="Role name…"
              style={inputStyle}
            />
            <button style={iconBtnStyle} onMouseDown={(e) => { e.preventDefault(); commitRole() }} title="Confirm">✓</button>
          </>
        ) : (
          <>
            <span
              style={{
                fontSize: '20px',
                color: role ? 'var(--pixel-accent)' : 'var(--pixel-text-dim)',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {role || 'Set role…'}
            </span>
            <button
              style={iconBtnStyle}
              onClick={() => { setDraftRole(role); setEditingField('role') }}
              title="Edit role"
            >
              ✏
            </button>
          </>
        )}
      </div>

      {/* Task note row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {editingField === 'note' ? (
          <>
            <input
              autoFocus
              value={draftNote}
              onChange={(e) => setDraftNote(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNote()
                if (e.key === 'Escape') { setDraftNote(taskNote); setEditingField(null) }
              }}
              onBlur={commitNote}
              placeholder="Task note…"
              style={inputStyle}
            />
            <button style={iconBtnStyle} onMouseDown={(e) => { e.preventDefault(); commitNote() }} title="Confirm">✓</button>
          </>
        ) : (
          <>
            <span
              style={{
                fontSize: '18px',
                color: 'var(--pixel-text-dim)',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontStyle: 'italic',
              }}
            >
              {taskNote || 'Add note…'}
            </span>
            <button
              style={iconBtnStyle}
              onClick={() => { setDraftNote(taskNote); setEditingField('note') }}
              title="Edit task note"
            >
              ✏
            </button>
          </>
        )}
      </div>

      {/* Blocked toggle */}
      <button
        onClick={toggleBlocked}
        title={isBlocked ? 'Clear blocked status' : 'Mark as blocked'}
        style={{
          background: isBlocked ? 'rgba(255, 160, 50, 0.15)' : 'none',
          border: isBlocked ? '2px solid rgba(255, 160, 50, 0.6)' : '2px solid transparent',
          borderRadius: 0,
          color: isBlocked ? '#ffa032' : 'var(--pixel-text-dim)',
          cursor: 'pointer',
          fontSize: '18px',
          padding: '2px 6px',
          textAlign: 'left',
          fontFamily: 'inherit',
        }}
      >
        {isBlocked ? '⊗ Blocked' : '○ Blocked'}
      </button>
    </div>
  )
}

export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  subagentCharacters,
  containerRef,
  zoom,
  panRef,
  onCloseAgent,
  onFocusAgent,
  onUpdateAgentRole,
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
        if (isSub) {
          if (subHasPermission) {
            activityText = 'Needs approval'
          } else {
            const sub = subagentCharacters.find((s) => s.id === id)
            activityText = sub ? sub.label : 'Subtask'
          }
        } else {
          activityText = getActivityText(id, agentTools, ch.isActive)
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

        const isBlocked = ch.isBlocked ?? false

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
              {isBlocked && (
                <span style={{ fontSize: '20px', color: '#ffa032', flexShrink: 0 }}>⊗</span>
              )}
              {dotColor && !isBlocked && (
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
              <span
                style={{
                  fontSize: isSub ? '20px' : '22px',
                  fontStyle: isSub ? 'italic' : undefined,
                  color: isBlocked ? '#ffa032' : 'var(--vscode-foreground)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {isBlocked ? `Blocked · ${activityText}` : activityText}
              </span>
              {isSelected && !isSub && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onFocusAgent(id)
                    }}
                    title="Focus terminal"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--pixel-text-dim)',
                      cursor: 'pointer',
                      padding: '0 2px',
                      fontSize: '18px',
                      lineHeight: 1,
                      marginLeft: 2,
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.color = 'var(--vscode-foreground)'
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.color = 'var(--pixel-text-dim)'
                    }}
                  >
                    ⌨
                  </button>
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
                </>
              )}
            </div>

            {/* Role/note/blocked edit section — only when selected, non-subagent */}
            {isSelected && !isSub && (
              <RoleEditSection
                id={id}
                role={ch.role ?? ''}
                taskNote={ch.taskNote ?? ''}
                isBlocked={isBlocked}
                onUpdateAgentRole={onUpdateAgentRole}
              />
            )}
          </div>
        )
      })}
    </>
  )
}
