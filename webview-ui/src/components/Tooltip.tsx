import type { ReactNode } from 'react';

interface TooltipProps {
  title: string;
  onDismiss: () => void;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  children: ReactNode;
}

const positionStyles: Record<string, React.CSSProperties> = {
  'top-right': { top: 8, right: 52 },
  'top-left': { top: 8, left: 8 },
  'bottom-right': { bottom: 8, right: 52 },
  'bottom-left': { bottom: 8, left: 8 },
};

export function Tooltip({ title, onDismiss, position = 'top-right', children }: TooltipProps) {
  return (
    <div
      style={
        {
          position: 'absolute',
          ...positionStyles[position],
          zIndex: 'var(--pixel-controls-z)',
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          boxShadow: 'var(--pixel-shadow)',
          whiteSpace: 'nowrap',
          padding: 0,
        } as React.CSSProperties
      }
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 8px',
          borderBottom: '1px solid var(--pixel-border)',
        }}
      >
        <span
          style={{
            fontSize: '22px',
            color: 'var(--pixel-accent)',
            fontWeight: 'bold',
          }}
        >
          {title}
        </span>
        <button
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--pixel-text-dim)',
            cursor: 'pointer',
            fontSize: '20px',
            padding: '0 2px',
            lineHeight: 1,
          }}
        >
          x
        </button>
      </div>
      {/* Body */}
      <div style={{ padding: '6px 8px' }}>{children}</div>
    </div>
  );
}
