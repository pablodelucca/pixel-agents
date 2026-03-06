import { useState } from 'react'
import { vscode } from '../vscodeApi.js'

interface WelcomeModalProps {
  initialServerUrl: string
  initialUserName: string
  onDone: (opts?: { guestMode?: boolean }) => void
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: '22px',
  background: 'rgba(0, 0, 0, 0.3)',
  border: '2px solid rgba(255, 255, 255, 0.2)',
  borderRadius: 0,
  color: '#e0e0e0',
  fontFamily: '"FS Pixel Sans", monospace',
  boxSizing: 'border-box',
}

const btnBase: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: '24px',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
  fontFamily: '"FS Pixel Sans", monospace',
}

export function WelcomeModal({ initialServerUrl, initialUserName, onDone }: WelcomeModalProps) {
  const [nick, setNick] = useState(initialUserName)
  const [serverUrl, setServerUrl] = useState(initialServerUrl || 'ws://localhost:4200')
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null)

  const handleConnect = () => {
    const name = nick.trim() || 'Anonymous'
    vscode.postMessage({ type: 'setUserName', name })
    vscode.postMessage({ type: 'setServerUrl', url: serverUrl.trim() })
    vscode.postMessage({ type: 'setGuestMode', enabled: false })
    onDone({ guestMode: false })
  }

  const handleGuest = () => {
    vscode.postMessage({ type: 'setUserName', name: 'Guest' })
    vscode.postMessage({ type: 'setServerUrl', url: serverUrl.trim() })
    vscode.postMessage({ type: 'setGuestMode', enabled: true })
    onDone({ guestMode: true })
  }

  const handleOffline = () => {
    const name = nick.trim() || 'Anonymous'
    vscode.postMessage({ type: 'setUserName', name })
    vscode.postMessage({ type: 'setServerUrl', url: '' })
    vscode.postMessage({ type: 'setGuestMode', enabled: false })
    onDone({ guestMode: false })
  }

  const connectDisabled = !serverUrl.trim()

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.7)',
          zIndex: 100,
        }}
      />
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 101,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '16px 20px',
          boxShadow: 'var(--pixel-shadow)',
          minWidth: 280,
          maxWidth: 360,
        }}
      >
        <div style={{ fontSize: '28px', color: 'rgba(255, 255, 255, 0.9)', marginBottom: 16, textAlign: 'center' }}>
          Pixel Agents
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: '20px', color: 'rgba(255, 255, 255, 0.7)', display: 'block', marginBottom: 4 }}>
            Your Name
          </label>
          <input
            type="text"
            value={nick}
            placeholder="Anonymous"
            onChange={(e) => setNick(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConnect()
            }}
            style={inputStyle}
            autoFocus
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: '20px', color: 'rgba(255, 255, 255, 0.7)', display: 'block', marginBottom: 4 }}>
            Server URL
          </label>
          <input
            type="text"
            value={serverUrl}
            placeholder="ws://localhost:4200"
            onChange={(e) => setServerUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConnect()
            }}
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button
            onClick={handleConnect}
            onMouseEnter={() => setHoveredBtn('connect')}
            onMouseLeave={() => setHoveredBtn(null)}
            disabled={connectDisabled}
            style={{
              ...btnBase,
              background: connectDisabled
                ? 'rgba(90, 200, 140, 0.15)'
                : hoveredBtn === 'connect'
                  ? 'rgba(90, 200, 140, 0.4)'
                  : 'rgba(90, 200, 140, 0.25)',
              border: '2px solid #5ac88c',
              color: connectDisabled ? 'rgba(200, 255, 220, 0.4)' : 'rgba(200, 255, 220, 0.95)',
              cursor: connectDisabled ? 'default' : 'pointer',
            }}
          >
            Connect
          </button>
          <button
            onClick={handleGuest}
            onMouseEnter={() => setHoveredBtn('guest')}
            onMouseLeave={() => setHoveredBtn(null)}
            disabled={connectDisabled}
            style={{
              ...btnBase,
              background: connectDisabled
                ? 'rgba(180, 160, 255, 0.15)'
                : hoveredBtn === 'guest'
                  ? 'rgba(180, 160, 255, 0.4)'
                  : 'rgba(180, 160, 255, 0.25)',
              border: '2px solid #a090e0',
              color: connectDisabled ? 'rgba(220, 210, 255, 0.4)' : 'rgba(220, 210, 255, 0.95)',
              cursor: connectDisabled ? 'default' : 'pointer',
            }}
          >
            Guest
          </button>
          <button
            onClick={handleOffline}
            onMouseEnter={() => setHoveredBtn('offline')}
            onMouseLeave={() => setHoveredBtn(null)}
            style={{
              ...btnBase,
              background: hoveredBtn === 'offline' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.08)',
              border: '2px solid var(--pixel-border)',
              color: 'var(--pixel-text)',
            }}
          >
            Offline
          </button>
        </div>
      </div>
    </>
  )
}
