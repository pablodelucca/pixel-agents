import { useState, useCallback } from 'react'
import { CLAUDE_CODE_INSTALL_CMD } from '../constants.js'

// Shown over the office canvas when no agents exist yet.
// Guides first-time users through the two-step setup without leaving the panel.
// Disappears naturally once the first agent is created.
export function WelcomeOverlay() {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(CLAUDE_CODE_INSTALL_CMD).then(() => {
      setCopied(true)
      // Reset copy state after a short delay so the button is reusable
      setTimeout(() => setCopied(false), 1500)
    })
  }, [])

  return (
    // Outer div fills the canvas but lets pointer events pass through to the
    // office and toolbar beneath — only the card itself captures interaction
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          boxShadow: '4px 4px 0px #0a0a14',
          padding: '20px 24px',
          maxWidth: 340,
          pointerEvents: 'all',
        }}
      >
        <div
          style={{
            fontSize: '28px',
            color: 'var(--pixel-text)',
            marginBottom: 16,
            fontWeight: 'bold',
          }}
        >
          Welcome to Pixel Agents
        </div>

        <div style={{ fontSize: '22px', color: 'var(--pixel-text-dim)', lineHeight: 1.6 }}>
          {/* Step 1 – install the CLI */}
          <div style={{ marginBottom: 14 }}>
            <span style={{ color: 'var(--pixel-accent)' }}>①</span>
            {' '}Install Claude Code (one-time):
          </div>

          {/* Install command with one-click copy */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(0,0,0,0.3)',
              border: '2px solid var(--pixel-border)',
              padding: '6px 8px',
              marginBottom: 14,
            }}
          >
            <code
              style={{ fontSize: '18px', color: '#9cdcfe', flex: 1, wordBreak: 'break-all' }}
            >
              {CLAUDE_CODE_INSTALL_CMD}
            </code>
            <button
              onClick={handleCopy}
              title="Copy to clipboard"
              style={{
                flexShrink: 0,
                fontSize: '18px',
                padding: '2px 8px',
                background: copied ? 'rgba(90,200,140,0.2)' : 'var(--pixel-btn-bg)',
                color: copied ? 'var(--pixel-green)' : 'var(--pixel-text-dim)',
                border: `2px solid ${copied ? 'var(--pixel-green)' : 'transparent'}`,
                borderRadius: 0,
                cursor: 'pointer',
              }}
            >
              {copied ? '✓' : 'Copy'}
            </button>
          </div>

          {/* Step 2 – authenticate */}
          <div style={{ marginBottom: 6 }}>
            <span style={{ color: 'var(--pixel-accent)' }}>②</span>
            {' '}Run{' '}
            <code style={{ fontSize: '18px', color: '#9cdcfe' }}>claude</code>
            {' '}and sign in
          </div>

          {/* Step 3 – create the first agent */}
          <div>
            <span style={{ color: 'var(--pixel-accent)' }}>③</span>
            {' '}Click{' '}
            <span
              style={{
                color: 'var(--pixel-agent-text)',
                background: 'rgba(90,200,140,0.15)',
                padding: '1px 6px',
                border: '1px solid var(--pixel-agent-border)',
              }}
            >
              + Agent
            </span>
            {' '}below
          </div>
        </div>
      </div>
    </div>
  )
}
