import { useState, useEffect } from 'react'
import type { ConversationEntry } from '../hooks/useExtensionMessages.js'
import { ExpandableText } from './ExpandableText.js'
import {
  PANEL_FONT,
  PANEL_FONT_SIZE_MIN,
  PANEL_FONT_SIZE_MAX,
  PANEL_FONT_SIZE_DEFAULT,
  PANEL_FONT_SIZE_STEP,
  PANEL_FONT_SIZE_STORAGE_KEY,
} from './panelStyles.js'

// Agent palette colors (same as ConversationPanel)
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

interface AgentInfoPanelProps {
  isOpen: boolean
  onClose: () => void
  agentId: number | null
  agentIds: number[]
  personaNames: Record<number, string>
  modelName: string | null
  conversationLog: ConversationEntry[]
  isAutoModeActive: boolean
  autoModeAgentIds: number[]
  onCloseAgent: (id: number) => void
}

export function AgentInfoPanel({
  isOpen,
  onClose,
  agentId,
  agentIds,
  personaNames,
  modelName,
  conversationLog,
  isAutoModeActive,
  autoModeAgentIds,
  onCloseAgent,
}: AgentInfoPanelProps) {
  const [fontSize, setFontSize] = useState(loadPanelFontSize)

  // Persist font size changes
  useEffect(() => {
    try { localStorage.setItem(PANEL_FONT_SIZE_STORAGE_KEY, String(fontSize)) } catch { /* ignore */ }
  }, [fontSize])

  if (agentId === null) return null

  const idx = agentIds.indexOf(agentId)
  const label = `Agent #${idx >= 0 ? idx + 1 : agentId}`
  const color = getAgentColor(agentId, agentIds)
  const personaName = personaNames[agentId] || null
  const isInAutoMode = isAutoModeActive && autoModeAgentIds.includes(agentId)

  // Get last 5 messages from this agent
  const agentMessages = conversationLog
    .filter((e) => e.agentId === agentId)
    .slice(-5)

  // Derived sizes scaled from base fontSize
  const labelSize = `${fontSize - 1}px`
  const valueSize = `${fontSize + 1}px`
  const headerSize = `${fontSize + 2}px`

  const handleZoomIn = () => setFontSize((s) => Math.min(s + PANEL_FONT_SIZE_STEP, PANEL_FONT_SIZE_MAX))
  const handleZoomOut = () => setFontSize((s) => Math.max(s - PANEL_FONT_SIZE_STEP, PANEL_FONT_SIZE_MIN))

  return (
    <div
      className="pixel-panel"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 300,
        maxWidth: '90vw',
        height: '100%',
        zIndex: 55,
        background: 'var(--pixel-bg)',
        borderRight: '2px solid var(--pixel-border)',
        boxShadow: '4px 0 12px rgba(0, 0, 0, 0.3)',
        display: 'flex',
        flexDirection: 'column',
        transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
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
          padding: '10px 14px',
          borderBottom: '1px solid var(--pixel-border)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: headerSize, fontWeight: 'bold', color }}>
          {label}
        </span>
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
              fontSize: '18px',
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

      {/* Agent details */}
      <div style={{ padding: '10px 14px', flexShrink: 0, borderBottom: '1px solid var(--pixel-border)' }}>
        {personaName && (
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: labelSize, color: 'rgba(255, 255, 255, 0.5)', fontFamily: PANEL_FONT }}>Persona</span>
            <div style={{ fontSize: valueSize, color: 'rgba(255, 255, 255, 0.9)', fontFamily: PANEL_FONT, marginTop: 2 }}>{personaName}</div>
          </div>
        )}
        {modelName && (
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: labelSize, color: 'rgba(255, 255, 255, 0.5)', fontFamily: PANEL_FONT }}>Model</span>
            <div style={{ fontSize: valueSize, color: 'rgba(255, 255, 255, 0.9)', fontFamily: PANEL_FONT, marginTop: 2 }}>{modelName}</div>
          </div>
        )}
        <div style={{ marginBottom: 4 }}>
          <span style={{ fontSize: labelSize, color: 'rgba(255, 255, 255, 0.5)', fontFamily: PANEL_FONT }}>Status</span>
          <div style={{
            fontSize: valueSize,
            fontFamily: PANEL_FONT,
            color: isInAutoMode ? '#51cf66' : 'rgba(255, 255, 255, 0.9)',
            fontWeight: isInAutoMode ? 'bold' : 'normal',
            marginTop: 2,
          }}>
            {isInAutoMode ? 'In conversation' : 'Idle'}
          </div>
        </div>
      </div>

      {/* Recent messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
        <div style={{ fontSize: labelSize, color: 'rgba(255, 255, 255, 0.5)', fontFamily: PANEL_FONT, marginBottom: 8 }}>
          Recent messages
        </div>
        {agentMessages.length === 0 ? (
          <div style={{ fontSize: `${fontSize}px`, color: 'rgba(255, 255, 255, 0.3)', textAlign: 'center', marginTop: 14, fontFamily: PANEL_FONT }}>
            No messages yet
          </div>
        ) : (
          agentMessages.map((entry, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <ExpandableText
                text={entry.text}
                previewLength={300}
                style={{
                  fontSize: `${fontSize}px`,
                  fontFamily: PANEL_FONT,
                  color: 'rgba(255, 255, 255, 0.8)',
                  lineHeight: 1.4,
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                }}
              />
            </div>
          ))
        )}
      </div>

      {/* Close agent button */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--pixel-border)', flexShrink: 0 }}>
        <button
          onClick={() => {
            onCloseAgent(agentId)
            onClose()
          }}
          disabled={isInAutoMode}
          style={{
            width: '100%',
            padding: '8px 12px',
            fontSize: `${fontSize}px`,
            fontFamily: PANEL_FONT,
            background: isInAutoMode ? 'rgba(255, 255, 255, 0.05)' : 'var(--pixel-danger-bg, #c0392b)',
            color: isInAutoMode ? 'rgba(255, 255, 255, 0.3)' : '#fff',
            border: '2px solid var(--pixel-border)',
            borderRadius: 0,
            cursor: isInAutoMode ? 'not-allowed' : 'pointer',
          }}
          title={isInAutoMode ? 'Cannot close agent during active conversation' : 'Close this agent'}
        >
          {isInAutoMode ? 'Close Agent (in conversation)' : 'Close Agent'}
        </button>
      </div>
    </div>
  )
}
