/**
 * ReplayPanel — Overlay UI for EAM session replay controls.
 *
 * Shows a session list, play/stop buttons, speed selector, and
 * status indicator during active replay.
 */

import type { ReplaySessionSummary, ReplayState } from '../hooks/useReplay.js'

interface ReplayPanelProps {
  sessions: ReplaySessionSummary[]
  activeReplay: ReplayState | null
  playbackSpeed: number
  onPlay: (filename: string) => void
  onStop: () => void
  onSpeedChange: (speed: number) => void
  onRefresh: () => void
}

const SPEEDS = [0.5, 1, 2]

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 12,
  width: 280,
  maxHeight: '60vh',
  background: 'rgba(20, 20, 35, 0.92)',
  border: '1px solid #444',
  fontFamily: 'monospace',
  fontSize: '12px',
  color: '#ccc',
  zIndex: 50,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const headerStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid #333',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  color: '#8af',
  fontWeight: 'bold',
  fontSize: '13px',
  flexShrink: 0,
}

const listStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '4px 0',
}

const itemStyle: React.CSSProperties = {
  padding: '6px 10px',
  cursor: 'pointer',
  borderBottom: '1px solid #2a2a3a',
}

const itemHoverBg = 'rgba(100, 140, 255, 0.12)'

const controlsStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderTop: '1px solid #333',
  display: 'flex',
  gap: '6px',
  alignItems: 'center',
  flexShrink: 0,
}

const buttonStyle: React.CSSProperties = {
  background: '#334',
  border: '1px solid #556',
  color: '#aaf',
  padding: '3px 8px',
  fontFamily: 'monospace',
  fontSize: '11px',
  cursor: 'pointer',
}

const activeButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#446',
  borderColor: '#88a',
  color: '#fff',
}

export function ReplayPanel({
  sessions,
  activeReplay,
  playbackSpeed,
  onPlay,
  onStop,
  onSpeedChange,
  onRefresh,
}: ReplayPanelProps) {
  const isPlaying = activeReplay !== null

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span>EAM Replay</span>
        <button
          style={{ ...buttonStyle, padding: '2px 6px' }}
          onClick={onRefresh}
          title="Refresh session list"
        >
          Refresh
        </button>
      </div>

      {/* Active replay status */}
      {activeReplay && (
        <div style={{
          padding: '6px 10px',
          background: 'rgba(60, 120, 255, 0.15)',
          borderBottom: '1px solid #333',
          flexShrink: 0,
        }}>
          <div style={{ color: '#8cf', marginBottom: 2 }}>
            Replaying... ({activeReplay.phase})
          </div>
          <div style={{ color: '#999', fontSize: '11px' }}>
            {activeReplay.session.epic ?? activeReplay.session.filename}
          </div>
          {activeReplay.session.constructs.length > 0 && (
            <div style={{ color: '#aaa', fontSize: '11px', marginTop: 2 }}>
              {activeReplay.session.constructs.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Session list */}
      <div style={listStyle}>
        {sessions.length === 0 && (
          <div style={{ padding: '12px 10px', color: '#666', textAlign: 'center' }}>
            No sessions found. Click Refresh.
          </div>
        )}
        {sessions.map(s => (
          <div
            key={s.filename}
            style={itemStyle}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = itemHoverBg }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
            onClick={() => { if (!isPlaying) onPlay(s.filename) }}
            title={s.anchor ?? s.filename}
          >
            <div style={{ color: '#ddd', marginBottom: 2 }}>
              {s.filename.replace(/\.md$/, '')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', fontSize: '10px' }}>
              <span>{s.date ?? '—'}</span>
              <span>{s.constructs.length > 0 ? s.constructs.join(', ') : 'no constructs'}</span>
            </div>
            {s.epic && (
              <div style={{ color: '#77a', fontSize: '10px', marginTop: 1 }}>{s.epic}</div>
            )}
          </div>
        ))}
      </div>

      {/* Controls */}
      <div style={controlsStyle}>
        {isPlaying ? (
          <button style={{ ...buttonStyle, background: '#633', borderColor: '#a55', color: '#faa' }} onClick={onStop}>
            Stop
          </button>
        ) : (
          <span style={{ color: '#666', fontSize: '10px' }}>Select a session to replay</span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '3px' }}>
          {SPEEDS.map(spd => (
            <button
              key={spd}
              style={playbackSpeed === spd ? activeButtonStyle : buttonStyle}
              onClick={() => onSpeedChange(spd)}
            >
              {spd}x
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
