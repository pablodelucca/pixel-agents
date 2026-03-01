import { useState } from 'react'

const PRESET_TOPICS = [
  { label: 'Random (surprise me)', value: '' },
  { label: 'Monorepos vs Polyrepos', value: 'I believe monorepos are strictly superior to polyrepos for any team with more than 5 engineers. The tooling advantages and atomic commits alone make it a no-brainer. Change my mind.' },
  { label: 'Redux in 2024', value: 'I think Redux is dead weight in 2024. Between React Server Components, signals, and Zustand, there is no reason to use Redux in a new project. Convince me otherwise.' },
  { label: 'GraphQL vs REST', value: 'I am firmly in the GraphQL camp. REST APIs are a relic of a simpler time -- they lead to over-fetching, under-fetching, and endpoint sprawl. Defend REST if you can.' },
  { label: 'Testing Pyramid', value: 'I believe the testing pyramid is outdated. Integration tests give you far more confidence per dollar than unit tests. Most unit tests are testing implementation details. Argue against this.' },
  { label: 'Kubernetes Adoption', value: 'I think Kubernetes is massively over-adopted. Most teams would be better off with a simple PaaS like Railway or Fly.io. The operational overhead of K8s is not worth it for 90% of companies. Disagree?' },
  { label: 'Microservices vs Monolith', value: 'I believe microservices should only be adopted after a monolith has proven insufficient. Starting with microservices is premature optimization that kills early-stage velocity. Push back.' },
  { label: 'Static Typing Overhead', value: 'I think strict static typing slows teams down significantly in the prototyping phase and the safety benefits are overstated for most web apps. Convince me I am wrong.' },
  { label: 'Observability vs Testing', value: 'I believe comprehensive observability is more important than comprehensive testing. You can ship with fewer tests if you have great observability. Argue against this.' },
]

interface AutoModeConfigDialogProps {
  isOpen: boolean
  onClose: () => void
  onStart: (config: { agentCount: number; topic?: string; timeoutMs?: number }) => void
}

const TIMEOUT_OPTIONS = [
  { label: '1 min', ms: 60_000 },
  { label: '3 min', ms: 180_000 },
  { label: '5 min', ms: 300_000 },
  { label: '10 min', ms: 600_000 },
  { label: 'Unlimited', ms: 0 },
]

export function AutoModeConfigDialog({ isOpen, onClose, onStart }: AutoModeConfigDialogProps) {
  const [agentCount, setAgentCount] = useState(2)
  const [presetIndex, setPresetIndex] = useState(0)
  const [customTopic, setCustomTopic] = useState('')
  const [timeoutMs, setTimeoutMs] = useState(300_000)
  const [hovered, setHovered] = useState<string | null>(null)

  if (!isOpen) return null

  const handleStart = () => {
    const topic = customTopic.trim() || PRESET_TOPICS[presetIndex].value || undefined
    onStart({ agentCount, topic, timeoutMs })
  }

  return (
    <>
      {/* Dark backdrop */}
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
      {/* Centered dialog */}
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
          minWidth: 300,
          maxWidth: '90vw',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 10px',
            borderBottom: '1px solid var(--pixel-border)',
            marginBottom: '8px',
          }}
        >
          <span style={{ fontSize: '24px', color: 'rgba(255, 255, 255, 0.9)' }}>Auto Mode</span>
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

        {/* Body */}
        <div style={{ padding: '4px 10px 10px' }}>
          {/* Agent count stepper */}
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', fontSize: '20px', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '4px' }}>
              Number of Agents
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                onClick={() => setAgentCount((c) => Math.max(2, c - 1))}
                onMouseEnter={() => setHovered('minus')}
                onMouseLeave={() => setHovered(null)}
                style={{
                  width: 28,
                  height: 28,
                  fontSize: '22px',
                  background: hovered === 'minus' ? 'rgba(255, 255, 255, 0.12)' : 'var(--pixel-btn-bg)',
                  color: 'var(--pixel-text)',
                  border: '2px solid var(--pixel-border)',
                  borderRadius: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                -
              </button>
              <span style={{ fontSize: '24px', color: '#fff', minWidth: 24, textAlign: 'center' }}>
                {agentCount}
              </span>
              <button
                onClick={() => setAgentCount((c) => Math.min(8, c + 1))}
                onMouseEnter={() => setHovered('plus')}
                onMouseLeave={() => setHovered(null)}
                style={{
                  width: 28,
                  height: 28,
                  fontSize: '22px',
                  background: hovered === 'plus' ? 'rgba(255, 255, 255, 0.12)' : 'var(--pixel-btn-bg)',
                  color: 'var(--pixel-text)',
                  border: '2px solid var(--pixel-border)',
                  borderRadius: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                +
              </button>
            </div>
          </div>

          {/* Topic preset dropdown */}
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', fontSize: '20px', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '4px' }}>
              Topic
            </label>
            <select
              value={presetIndex}
              onChange={(e) => setPresetIndex(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '4px 6px',
                fontSize: '20px',
                background: 'var(--pixel-btn-bg)',
                color: 'var(--pixel-text)',
                border: '2px solid var(--pixel-border)',
                borderRadius: 0,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {PRESET_TOPICS.map((t, i) => (
                <option key={i} value={i}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Custom topic input */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '20px', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '4px' }}>
              Custom Topic (overrides preset)
            </label>
            <input
              type="text"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="Type a debate topic..."
              style={{
                width: '100%',
                padding: '4px 6px',
                fontSize: '20px',
                background: 'var(--pixel-btn-bg)',
                color: 'var(--pixel-text)',
                border: '2px solid var(--pixel-border)',
                borderRadius: 0,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Timeout selector */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '20px', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '4px' }}>
              Duration
            </label>
            <select
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '4px 6px',
                fontSize: '20px',
                background: 'var(--pixel-btn-bg)',
                color: 'var(--pixel-text)',
                border: '2px solid var(--pixel-border)',
                borderRadius: 0,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {TIMEOUT_OPTIONS.map((opt) => (
                <option key={opt.ms} value={opt.ms}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              onClick={onClose}
              onMouseEnter={() => setHovered('cancel')}
              onMouseLeave={() => setHovered(null)}
              style={{
                padding: '5px 14px',
                fontSize: '22px',
                background: hovered === 'cancel' ? 'rgba(255, 255, 255, 0.12)' : 'var(--pixel-btn-bg)',
                color: 'var(--pixel-text)',
                border: '2px solid var(--pixel-border)',
                borderRadius: 0,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleStart}
              onMouseEnter={() => setHovered('start')}
              onMouseLeave={() => setHovered(null)}
              style={{
                padding: '5px 14px',
                fontSize: '22px',
                background: hovered === 'start' ? 'var(--pixel-agent-hover-bg)' : 'var(--pixel-agent-bg)',
                color: 'var(--pixel-agent-text)',
                border: '2px solid var(--pixel-agent-border)',
                borderRadius: 0,
                cursor: 'pointer',
              }}
            >
              Start
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
