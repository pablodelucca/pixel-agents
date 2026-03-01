import { useEffect, useRef, useState } from 'react'
import type { ConversationEntry } from '../hooks/useExtensionMessages.js'
import { vscode } from '../vscodeApi.js'
import { ExpandableText } from './ExpandableText.js'
import {
  PANEL_FONT,
  PANEL_FONT_SIZE_MIN,
  PANEL_FONT_SIZE_MAX,
  PANEL_FONT_SIZE_DEFAULT,
  PANEL_FONT_SIZE_STEP,
  PANEL_FONT_SIZE_STORAGE_KEY,
} from './panelStyles.js'

// Agent palette colors for color-coding messages
const AGENT_COLORS = [
  '#5a8cff', // blue
  '#ff6b6b', // red
  '#51cf66', // green
  '#ffd43b', // yellow
  '#cc5de8', // purple
  '#ff922b', // orange
  '#20c997', // teal
  '#f06595', // pink
]

function getAgentColor(agentId: number, allAgentIds: number[]): string {
  const idx = allAgentIds.indexOf(agentId)
  return AGENT_COLORS[idx >= 0 ? idx % AGENT_COLORS.length : 0]
}

function getAgentLabel(agentId: number, allAgentIds: number[]): string {
  const idx = allAgentIds.indexOf(agentId)
  return `Agent #${idx >= 0 ? idx + 1 : agentId}`
}

interface ConversationPanelProps {
  isOpen: boolean
  onClose: () => void
  entries: ConversationEntry[]
  agentIds: number[]
  isAutoModeActive: boolean
  onStopAutoMode: () => void
}

const TIMEOUT_OPTIONS = [
  { label: '1 min', ms: 60_000 },
  { label: '3 min', ms: 180_000 },
  { label: '5 min', ms: 300_000 },
  { label: '10 min', ms: 600_000 },
  { label: 'Unlimited', ms: 0 },
]

function loadPanelFontSize(): number {
  try {
    const stored = localStorage.getItem(PANEL_FONT_SIZE_STORAGE_KEY)
    if (stored) {
      const n = Number(stored)
      if (n >= PANEL_FONT_SIZE_MIN && n <= PANEL_FONT_SIZE_MAX) return n
    }
  } catch { /* ignore */ }
  return PANEL_FONT_SIZE_DEFAULT
}

export function ConversationPanel({ isOpen, onClose, entries, agentIds, isAutoModeActive, onStopAutoMode }: ConversationPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [timeoutMs, setTimeoutMs] = useState(300_000) // default 5 min
  const [fontSize, setFontSize] = useState(loadPanelFontSize)

  // Persist font size changes
  useEffect(() => {
    try { localStorage.setItem(PANEL_FONT_SIZE_STORAGE_KEY, String(fontSize)) } catch { /* ignore */ }
  }, [fontSize])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries.length])

  const headerSize = `${fontSize + 4}px`
  const controlSize = `${fontSize + 2}px`
  const labelSize = `${fontSize + 2}px`
  const messageSize = `${fontSize + 1}px`

  const handleZoomIn = () => setFontSize((s) => Math.min(s + PANEL_FONT_SIZE_STEP, PANEL_FONT_SIZE_MAX))
  const handleZoomOut = () => setFontSize((s) => Math.max(s - PANEL_FONT_SIZE_STEP, PANEL_FONT_SIZE_MIN))

  return (
    <div
      className="pixel-panel"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 320,
        maxWidth: '90vw',
        height: '100%',
        zIndex: 48,
        background: 'var(--pixel-bg)',
        borderLeft: '2px solid var(--pixel-border)',
        boxShadow: '-4px 0 12px rgba(0, 0, 0, 0.3)',
        display: 'flex',
        flexDirection: 'column',
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.2s ease-in-out',
        pointerEvents: isOpen ? 'auto' : 'none',
        fontSize: `${fontSize}px`,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          borderBottom: '1px solid var(--pixel-border)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: headerSize, fontFamily: PANEL_FONT, color: 'rgba(255, 255, 255, 0.9)' }}>Conversation</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={handleZoomOut}
            disabled={fontSize <= PANEL_FONT_SIZE_MIN}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: 0,
              color: fontSize <= PANEL_FONT_SIZE_MIN ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.6)',
              fontSize: '14px',
              fontFamily: PANEL_FONT,
              cursor: fontSize <= PANEL_FONT_SIZE_MIN ? 'default' : 'pointer',
              padding: '0 4px',
              lineHeight: 1,
              width: 22,
              height: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Decrease font size"
          >
            -
          </button>
          <button
            onClick={handleZoomIn}
            disabled={fontSize >= PANEL_FONT_SIZE_MAX}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: 0,
              color: fontSize >= PANEL_FONT_SIZE_MAX ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.6)',
              fontSize: '14px',
              fontFamily: PANEL_FONT,
              cursor: fontSize >= PANEL_FONT_SIZE_MAX ? 'default' : 'pointer',
              padding: '0 4px',
              lineHeight: 1,
              width: 22,
              height: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Increase font size"
          >
            +
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: 0,
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: headerSize,
              fontFamily: PANEL_FONT,
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            X
          </button>
        </div>
      </div>

      {/* Controls bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderBottom: '1px solid var(--pixel-border)',
          flexShrink: 0,
        }}
      >
        <select
          value={timeoutMs}
          disabled={!isAutoModeActive}
          onChange={(e) => {
            const ms = Number(e.target.value)
            setTimeoutMs(ms)
            vscode.postMessage({ type: 'setAutoModeTimeout', durationMs: ms })
          }}
          style={{
            background: 'var(--pixel-btn-bg)',
            color: 'var(--pixel-text)',
            border: '2px solid var(--pixel-border)',
            borderRadius: 0,
            fontSize: controlSize,
            padding: '2px 4px',
            cursor: isAutoModeActive ? 'pointer' : 'default',
            opacity: isAutoModeActive ? 1 : 0.5,
            fontFamily: PANEL_FONT,
          }}
        >
          {TIMEOUT_OPTIONS.map((opt) => (
            <option key={opt.ms} value={opt.ms}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          onClick={onStopAutoMode}
          disabled={!isAutoModeActive}
          style={{
            background: isAutoModeActive ? 'var(--pixel-danger-bg, #c0392b)' : 'var(--pixel-btn-bg)',
            color: isAutoModeActive ? '#fff' : 'var(--pixel-text-dim)',
            border: '2px solid var(--pixel-border)',
            borderRadius: 0,
            fontSize: controlSize,
            padding: '2px 8px',
            cursor: isAutoModeActive ? 'pointer' : 'default',
            opacity: isAutoModeActive ? 1 : 0.5,
            fontFamily: PANEL_FONT,
          }}
        >
          Stop
        </button>
      </div>

      {/* Message list */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '6px 8px',
        }}
      >
        {entries.length === 0 ? (
          <div style={{ fontSize: messageSize, fontFamily: PANEL_FONT, color: 'rgba(255, 255, 255, 0.4)', textAlign: 'center', marginTop: 20 }}>
            Waiting for conversation...
          </div>
        ) : (
          entries.map((entry, i) => {
            const color = getAgentColor(entry.agentId, agentIds)
            const label = getAgentLabel(entry.agentId, agentIds)
            return (
              <div key={i} style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: labelSize, fontFamily: PANEL_FONT, color, fontWeight: 'bold', marginBottom: '2px' }}>
                  {label}
                </div>
                <ExpandableText
                  text={entry.text}
                  previewLength={500}
                  style={{
                    fontSize: messageSize,
                    fontFamily: PANEL_FONT,
                    color: 'rgba(255, 255, 255, 0.75)',
                    lineHeight: 1.3,
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                  }}
                />
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
