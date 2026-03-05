import { useState } from 'react'
import { SettingsModal } from './SettingsModal.js'

interface BottomToolbarProps {
  isEditMode: boolean
  onToggleEditMode: () => void
  isDebugMode: boolean
  onToggleDebugMode: () => void
  isTokenDashboardOpen: boolean
  onToggleTokenDashboard: () => void
  isChatOpen: boolean
  onToggleChat: () => void
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 10,
  left: 10,
  zIndex: 'var(--pixel-controls-z)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  padding: '4px 6px',
  boxShadow: 'var(--pixel-shadow)',
}

const btnBase: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: '24px',
  color: 'var(--pixel-text)',
  background: 'var(--pixel-btn-bg)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
}

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: 'var(--pixel-active-bg)',
  border: '2px solid var(--pixel-accent)',
}


export function BottomToolbar({
  isEditMode,
  onToggleEditMode,
  isDebugMode,
  onToggleDebugMode,
  isTokenDashboardOpen,
  onToggleTokenDashboard,
  isChatOpen,
  onToggleChat,
}: BottomToolbarProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  return (
    <div style={panelStyle}>
      <button
        onClick={onToggleTokenDashboard}
        onMouseEnter={() => setHovered('tokens')}
        onMouseLeave={() => setHovered(null)}
        style={
          isTokenDashboardOpen
            ? { ...btnActive }
            : {
                ...btnBase,
                background: hovered === 'tokens' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
              }
        }
        title="Token usage dashboard"
      >
        Tokens
      </button>
      <button
        onClick={onToggleChat}
        onMouseEnter={() => setHovered('chat')}
        onMouseLeave={() => setHovered(null)}
        style={
          isChatOpen
            ? { ...btnActive }
            : {
                ...btnBase,
                background: hovered === 'chat' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
              }
        }
        title="Agent chat"
      >
        Chat
      </button>
      <button
        onClick={onToggleEditMode}
        onMouseEnter={() => setHovered('edit')}
        onMouseLeave={() => setHovered(null)}
        style={
          isEditMode
            ? { ...btnActive }
            : {
                ...btnBase,
                background: hovered === 'edit' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
              }
        }
        title="Edit office layout"
      >
        Layout
      </button>
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setIsSettingsOpen((v) => !v)}
          onMouseEnter={() => setHovered('settings')}
          onMouseLeave={() => setHovered(null)}
          style={
            isSettingsOpen
              ? { ...btnActive }
              : {
                  ...btnBase,
                  background: hovered === 'settings' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
                }
          }
          title="Settings"
        >
          Settings
        </button>
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          isDebugMode={isDebugMode}
          onToggleDebugMode={onToggleDebugMode}
        />
      </div>
    </div>
  )
}
