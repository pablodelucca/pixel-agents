import { useState } from 'react'
import { vscode } from '../vscodeApi.js'
import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js'
import type { DetectedProvider, ProviderPreference } from '../hooks/useExtensionMessages.js'
import type { Provider } from '../office/types.js'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  isDebugMode: boolean
  onToggleDebugMode: () => void
  providers: DetectedProvider[]
  providerPreference: ProviderPreference
}

const menuItemBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '6px 10px',
  fontSize: '24px',
  color: 'rgba(255, 255, 255, 0.8)',
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
  cursor: 'pointer',
  textAlign: 'left',
}

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: '20px',
  color: 'var(--pixel-text-dim)',
  padding: '8px 10px 4px',
  textTransform: 'uppercase',
  letterSpacing: '1px',
}

export function SettingsModal({
  isOpen,
  onClose,
  isDebugMode,
  onToggleDebugMode,
  providers,
  providerPreference,
}: SettingsModalProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled)

  if (!isOpen) return null

  const handleProviderChange = (defaultProvider: Provider) => {
    vscode.postMessage({
      type: 'saveProviderPreference',
      defaultProvider,
      askEachTime: providerPreference.askEachTime,
    })
  }

  const handleAskEachTimeToggle = () => {
    vscode.postMessage({
      type: 'saveProviderPreference',
      defaultProvider: providerPreference.defaultProvider,
      askEachTime: !providerPreference.askEachTime,
    })
  }

  return (
    <>
      {/* Dark backdrop — click to close */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 49,
        }}
      />
      {/* Centered modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 50,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '4px',
          boxShadow: 'var(--pixel-shadow)',
          minWidth: 280,
        }}
      >
        {/* Header with title and X button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 10px',
            borderBottom: '1px solid var(--pixel-border)',
            marginBottom: '4px',
          }}
        >
          <span style={{ fontSize: '24px', color: 'rgba(255, 255, 255, 0.9)' }}>Settings</span>
          <button
            onClick={onClose}
            onMouseEnter={() => setHovered('close')}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: hovered === 'close' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              border: 'none',
              borderRadius: 0,
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            X
          </button>
        </div>

        {/* Provider Settings */}
        <div style={sectionHeaderStyle}>AI Providers</div>
        <div style={{ padding: '0 10px 8px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {providers.map((p) => (
              <button
                key={p.id}
                onClick={() => handleProviderChange(p.id)}
                onMouseEnter={() => setHovered(`provider-${p.id}`)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  ...menuItemBase,
                  background:
                    providerPreference.defaultProvider === p.id
                      ? 'var(--pixel-active-bg)'
                      : hovered === `provider-${p.id}`
                      ? 'rgba(255, 255, 255, 0.08)'
                      : 'transparent',
                  border:
                    providerPreference.defaultProvider === p.id
                      ? '2px solid var(--pixel-accent)'
                      : '2px solid transparent',
                  padding: '4px 8px',
                  opacity: p.installed ? 1 : 0.5,
                }}
              >
                <span style={{ textTransform: 'capitalize' }}>{p.id}</span>
                <span style={{ fontSize: '18px', color: p.installed ? 'var(--pixel-success-text)' : 'var(--pixel-danger-text)' }}>
                  {p.installed ? 'Installed' : 'Missing'}
                </span>
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleAskEachTimeToggle}
          onMouseEnter={() => setHovered('askEachTime')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'askEachTime' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: '22px' }}>Ask each time</span>
          <span
            style={{
              width: 14,
              height: 14,
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: 0,
              background: providerPreference.askEachTime ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              lineHeight: 1,
              color: '#fff',
            }}
          >
            {providerPreference.askEachTime ? 'X' : ''}
          </span>
        </button>

        <div style={sectionHeaderStyle}>General</div>

        {/* Menu items */}
        <button
          onClick={() => {
            vscode.postMessage({ type: 'openSessionsFolder' })
            onClose()
          }}
          onMouseEnter={() => setHovered('sessions')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'sessions' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Open Sessions Folder
        </button>
        <button
          onClick={() => {
            vscode.postMessage({ type: 'exportLayout' })
            onClose()
          }}
          onMouseEnter={() => setHovered('export')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'export' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Export Layout
        </button>
        <button
          onClick={() => {
            vscode.postMessage({ type: 'importLayout' })
            onClose()
          }}
          onMouseEnter={() => setHovered('import')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'import' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Import Layout
        </button>
        <button
          onClick={() => {
            const newVal = !isSoundEnabled()
            setSoundEnabled(newVal)
            setSoundLocal(newVal)
            vscode.postMessage({ type: 'setSoundEnabled', enabled: newVal })
          }}
          onMouseEnter={() => setHovered('sound')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'sound' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Sound Notifications</span>
          <span
            style={{
              width: 14,
              height: 14,
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: 0,
              background: soundLocal ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              lineHeight: 1,
              color: '#fff',
            }}
          >
            {soundLocal ? 'X' : ''}
          </span>
        </button>
        <button
          onClick={onToggleDebugMode}
          onMouseEnter={() => setHovered('debug')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'debug' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Debug View</span>
          {isDebugMode && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'rgba(90, 140, 255, 0.8)',
                flexShrink: 0,
              }}
            />
          )}
        </button>
      </div>
    </>
  )
}
