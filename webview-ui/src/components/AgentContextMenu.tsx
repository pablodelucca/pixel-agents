import { useEffect, useRef } from 'react'

export interface ContextMenuAction {
  label: string
  onClick: () => void
  disabled?: boolean
}

interface AgentContextMenuProps {
  x: number
  y: number
  actions: ContextMenuAction[]
  onClose: () => void
}

const menuStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 9999,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  boxShadow: 'var(--pixel-shadow)',
  padding: '4px 0',
  minWidth: 140,
}

const itemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '6px 14px',
  fontSize: '22px',
  background: 'none',
  border: 'none',
  borderRadius: 0,
  color: 'var(--vscode-foreground)',
  textAlign: 'left',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const itemDisabledStyle: React.CSSProperties = {
  ...itemStyle,
  opacity: 0.4,
  cursor: 'default',
}

export function AgentContextMenu({ x, y, actions, onClose }: AgentContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Delay to avoid the same right-click closing the menu
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [onClose])

  return (
    <div ref={ref} style={{ ...menuStyle, left: x, top: y }}>
      {actions.map((action) => (
        <button
          key={action.label}
          style={action.disabled ? itemDisabledStyle : itemStyle}
          onClick={() => {
            if (!action.disabled) {
              action.onClick()
              onClose()
            }
          }}
          onMouseEnter={(e) => {
            if (!action.disabled) {
              (e.currentTarget as HTMLElement).style.background = 'var(--pixel-btn-bg)'
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'none'
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
