export interface RuntimeLogEntry {
  id: number;
  level: 'info' | 'error';
  message: string;
  at: number;
}

interface RuntimeLogPanelProps {
  isOpen: boolean;
  logs: RuntimeLogEntry[];
  onClose: () => void;
}

function formatTime(value: number): string {
  const date = new Date(value);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function RuntimeLogPanel({ isOpen, logs, onClose }: RuntimeLogPanelProps) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'absolute',
        right: 10,
        top: 58,
        width: 'min(640px, calc(100vw - 20px))',
        maxHeight: 'calc(100vh - 120px)',
        overflow: 'auto',
        zIndex: 95,
        border: '2px solid var(--pixel-border)',
        background: 'rgba(10, 14, 24, 0.94)',
        boxShadow: 'var(--pixel-shadow)',
      }}
    >
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 10px',
          borderBottom: '2px solid var(--pixel-border)',
          background: 'rgba(17, 24, 38, 0.98)',
          color: 'var(--pixel-text)',
          fontSize: '15px',
        }}
      >
        <strong>Runtime Logs</strong>
        <button
          onClick={onClose}
          style={{
            border: '2px solid var(--pixel-border)',
            background: 'rgba(255,255,255,0.06)',
            color: 'var(--pixel-text)',
            fontSize: '13px',
            cursor: 'pointer',
            borderRadius: 0,
            padding: '2px 8px',
          }}
        >
          Close
        </button>
      </div>
      <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {logs.length === 0 && (
          <div style={{ color: 'var(--pixel-text-dim)', fontSize: '14px' }}>Ainda sem logs.</div>
        )}
        {logs.map((entry) => (
          <div
            key={entry.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '70px 1fr',
              gap: 8,
              fontSize: '13px',
              lineHeight: 1.35,
              color: entry.level === 'error' ? '#ffb7b7' : '#d9e8ff',
              borderLeft:
                entry.level === 'error'
                  ? '3px solid rgba(255, 102, 102, 0.7)'
                  : '3px solid rgba(104, 178, 255, 0.6)',
              paddingLeft: 6,
            }}
          >
            <span style={{ opacity: 0.8 }}>{formatTime(entry.at)}</span>
            <span style={{ wordBreak: 'break-word' }}>{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
