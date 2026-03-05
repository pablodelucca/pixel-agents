import { useState, useEffect, useRef, useCallback } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import type { SubagentCharacter } from '../hooks/useServerMessages.js'
import { TILE_SIZE, CharacterState } from '../office/types.js'

interface AgentLabelsProps {
  officeState: OfficeState
  agents: number[]
  agentStatuses: Record<number, string>
  containerRef: React.RefObject<HTMLDivElement | null>
  zoom: number
  panRef: React.RefObject<{ x: number; y: number }>
  subagentCharacters: SubagentCharacter[]
  onRenameAgent?: (id: number, name: string) => void
}

export function AgentLabels({
  officeState,
  agents,
  agentStatuses,
  containerRef,
  zoom,
  panRef,
  subagentCharacters,
  onRenameAgent,
}: AgentLabelsProps) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  const commitEdit = useCallback((id: number) => {
    onRenameAgent?.(id, editValue.trim())
    setEditingId(null)
  }, [editValue, onRenameAgent])

  // Auto-focus + select all when entering edit mode
  useEffect(() => {
    if (editingId !== null && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

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
  // Compute device pixel offset (same math as renderFrame, including pan)
  const canvasW = Math.round(rect.width * dpr)
  const canvasH = Math.round(rect.height * dpr)
  const layout = officeState.getLayout()
  const mapW = layout.cols * TILE_SIZE * zoom
  const mapH = layout.rows * TILE_SIZE * zoom
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x)
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y)

  // Build sub-agent label lookup
  const subLabelMap = new Map<number, string>()
  for (const sub of subagentCharacters) {
    subLabelMap.set(sub.id, sub.label)
  }

  // All character IDs to render labels for (regular agents + sub-agents)
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)]

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id)
        if (!ch) return null

        // Character position: device pixels → CSS pixels (follow sitting offset)
        const sittingOffset = ch.state === CharacterState.TYPE ? 6 : 0
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr
        const screenY = (deviceOffsetY + (ch.y + sittingOffset - 24) * zoom) / dpr

        const status = agentStatuses[id]
        const isWaiting = status === 'waiting'
        const isActive = ch.isActive
        const isSub = ch.isSubagent

        let dotColor = 'transparent'
        if (isWaiting) {
          dotColor = '#cca700'
        } else if (isActive) {
          dotColor = '#3794ff'
        }

        const rawLabel = subLabelMap.get(id) || ch.folderName || `Agent #${id}`
        const colonIdx = rawLabel.indexOf(': ')
        const agentName = colonIdx >= 0 ? rawLabel.slice(colonIdx + 2) : rawLabel
        const peerName = colonIdx >= 0 ? rawLabel.slice(0, colonIdx) : null

        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY - 16,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              pointerEvents: 'none',
              zIndex: 40,
            }}
          >
            {dotColor !== 'transparent' && (
              <span
                className={isActive && !isWaiting ? 'pixel-agents-pulse' : undefined}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: dotColor,
                  marginBottom: 2,
                }}
              />
            )}
            {editingId === id ? (
              <input
                ref={editInputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit(id)
                  if (e.key === 'Escape') setEditingId(null)
                }}
                onBlur={() => commitEdit(id)}
                style={{
                  fontSize: '18px',
                  color: '#fff',
                  background: '#1e1e2e',
                  border: '2px solid var(--pixel-accent)',
                  padding: '1px 4px',
                  borderRadius: 2,
                  whiteSpace: 'nowrap',
                  outline: 'none',
                  width: 120,
                  pointerEvents: 'auto',
                }}
              />
            ) : (
              <span
                onDoubleClick={!isSub && id > 0 ? () => {
                  setEditingId(id)
                  setEditValue(agentName)
                } : undefined}
                style={{
                  fontSize: isSub ? '16px' : '18px',
                  fontStyle: isSub ? 'italic' : undefined,
                  color: '#fff',
                  background: 'rgba(30,30,46,0.7)',
                  padding: '1px 4px',
                  borderRadius: 2,
                  whiteSpace: 'nowrap',
                  maxWidth: isSub ? 120 : undefined,
                  overflow: isSub ? 'hidden' : undefined,
                  textOverflow: isSub ? 'ellipsis' : undefined,
                  cursor: !isSub && id > 0 ? 'text' : undefined,
                  pointerEvents: !isSub && id > 0 ? 'auto' : undefined,
                }}
              >
                {agentName}
              </span>
            )}
            {peerName && !isSub && (
              <span
                style={{
                  fontSize: '14px',
                  color: 'var(--pixel-text-dim)',
                  background: 'rgba(30,30,46,0.7)',
                  padding: '0px 4px',
                  borderRadius: 2,
                  whiteSpace: 'nowrap',
                }}
              >
                {peerName}
              </span>
            )}
          </div>
        )
      })}
    </>
  )
}
