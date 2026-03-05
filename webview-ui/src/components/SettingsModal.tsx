import { useState } from 'react'
import { vscode } from '../vscodeApi.js'
import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  isDebugMode: boolean
  onToggleDebugMode: () => void
  externalSessionsEnabled: boolean
  externalSessionsScope: 'currentProject' | 'allProjects'
  showLabelsAlways: boolean
  onToggleShowLabelsAlways: () => void
  serverUrl: string
  userName: string
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

export function SettingsModal({ isOpen, onClose, isDebugMode, onToggleDebugMode, externalSessionsEnabled, externalSessionsScope, showLabelsAlways, onToggleShowLabelsAlways, serverUrl, userName }: SettingsModalProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled)
  const [extEnabled, setExtEnabled] = useState(externalSessionsEnabled)
  const [extScope, setExtScope] = useState(externalSessionsScope)
  const [serverUrlLocal, setServerUrlLocal] = useState(serverUrl)
  const [userNameLocal, setUserNameLocal] = useState(userName)

  if (!isOpen) return null

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
          minWidth: 200,
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
          onClick={onToggleShowLabelsAlways}
          onMouseEnter={() => setHovered('labels')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'labels' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Always Show Labels</span>
          <span
            style={{
              width: 14,
              height: 14,
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: 0,
              background: showLabelsAlways ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              lineHeight: 1,
              color: '#fff',
            }}
          >
            {showLabelsAlways ? 'X' : ''}
          </span>
        </button>
        <button
          onClick={() => {
            const newVal = !extEnabled
            setExtEnabled(newVal)
            vscode.postMessage({ type: 'setExternalSessionsEnabled', enabled: newVal })
          }}
          onMouseEnter={() => setHovered('external')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'external' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Detect External Sessions</span>
          <span
            style={{
              width: 14,
              height: 14,
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: 0,
              background: extEnabled ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              lineHeight: 1,
              color: '#fff',
            }}
          >
            {extEnabled ? 'X' : ''}
          </span>
        </button>
        {extEnabled && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '4px 10px 4px 24px',
              fontSize: '20px',
              color: 'rgba(255, 255, 255, 0.6)',
            }}
          >
            <span>Scope</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['currentProject', 'allProjects'] as const).map((scope) => (
                <button
                  key={scope}
                  onClick={() => {
                    setExtScope(scope)
                    vscode.postMessage({ type: 'setExternalSessionsScope', scope })
                  }}
                  onMouseEnter={() => setHovered(`scope-${scope}`)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    background: extScope === scope ? 'rgba(90, 140, 255, 0.8)' : hovered === `scope-${scope}` ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.3)',
                    borderRadius: 0,
                    color: extScope === scope ? '#fff' : 'rgba(255, 255, 255, 0.6)',
                    fontSize: '18px',
                    cursor: 'pointer',
                    padding: '2px 6px',
                  }}
                >
                  {scope === 'currentProject' ? 'Project' : 'All'}
                </button>
              ))}
            </div>
          </div>
        )}
        {/* Multiuser section */}
        <div
          style={{
            borderTop: '1px solid var(--pixel-border)',
            marginTop: 4,
            paddingTop: 4,
          }}
        >
          <div style={{ padding: '4px 10px', fontSize: '20px', color: 'rgba(255, 255, 255, 0.5)' }}>
            Multiuser
          </div>
          <div style={{ padding: '4px 10px' }}>
            <label style={{ fontSize: '20px', color: 'rgba(255, 255, 255, 0.7)', display: 'block', marginBottom: 2 }}>
              Server URL
            </label>
            <input
              type="text"
              value={serverUrlLocal}
              placeholder="ws://localhost:4200"
              onChange={(e) => setServerUrlLocal(e.target.value)}
              onBlur={() => {
                vscode.postMessage({ type: 'setServerUrl', url: serverUrlLocal })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  vscode.postMessage({ type: 'setServerUrl', url: serverUrlLocal })
                }
              }}
              style={{
                width: '100%',
                padding: '4px 6px',
                fontSize: '20px',
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: 0,
                color: '#e0e0e0',
                fontFamily: '"FS Pixel Sans", monospace',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ padding: '4px 10px' }}>
            <label style={{ fontSize: '20px', color: 'rgba(255, 255, 255, 0.7)', display: 'block', marginBottom: 2 }}>
              Your Name
            </label>
            <input
              type="text"
              value={userNameLocal}
              placeholder="Anonymous"
              onChange={(e) => setUserNameLocal(e.target.value)}
              onBlur={() => {
                vscode.postMessage({ type: 'setUserName', name: userNameLocal })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  vscode.postMessage({ type: 'setUserName', name: userNameLocal })
                }
              }}
              style={{
                width: '100%',
                padding: '4px 6px',
                fontSize: '20px',
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: 0,
                color: '#e0e0e0',
                fontFamily: '"FS Pixel Sans", monospace',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
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
