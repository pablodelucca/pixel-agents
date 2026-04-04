interface AgentDockProps {
  agents: number[];
  selectedAgent: number | null;
  statuses: Record<number, string>;
  onSelectAgent: (id: number) => void;
}

const MAX_SLOTS = 11;

function getStatusColor(status: string | undefined): string {
  if (status === 'waiting') return '#f6c36a';
  if (status === 'active') return '#76d4a6';
  return '#66738a';
}

export function AgentDock({ agents, selectedAgent, statuses, onSelectAgent }: AgentDockProps) {
  const sorted = [...agents].sort((a, b) => a - b);
  const visible = sorted.slice(0, MAX_SLOTS);
  const overflow = Math.max(0, sorted.length - MAX_SLOTS);

  return (
    <div
      style={{
        position: 'absolute',
        right: 12,
        bottom: 10,
        zIndex: 'var(--pixel-controls-z)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        border: '2px solid var(--pixel-border)',
        background: 'var(--pixel-bg)',
        boxShadow: 'var(--pixel-shadow)',
      }}
    >
      {Array.from({ length: MAX_SLOTS }).map((_, index) => {
        const agentId = visible[index];
        const isSelected = agentId !== undefined && selectedAgent === agentId;
        return (
          <button
            key={index}
            disabled={agentId === undefined}
            onClick={() => {
              if (agentId !== undefined) onSelectAgent(agentId);
            }}
            style={{
              width: 38,
              height: 32,
              borderRadius: 0,
              border: isSelected ? '2px solid #9fd2ff' : '2px solid var(--pixel-border)',
              background:
                agentId === undefined
                  ? 'rgba(255,255,255,0.03)'
                  : isSelected
                    ? 'rgba(86, 153, 255, 0.2)'
                    : 'rgba(255,255,255,0.07)',
              color: 'var(--pixel-text)',
              fontSize: 13,
              cursor: agentId === undefined ? 'default' : 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              opacity: agentId === undefined ? 0.35 : 1,
            }}
            title={agentId === undefined ? `Slot ${index + 1}` : `Agent ${agentId}`}
          >
            <span style={{ lineHeight: 1 }}>{agentId === undefined ? '•' : agentId}</span>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 0,
                background: getStatusColor(agentId === undefined ? undefined : statuses[agentId]),
              }}
            />
          </button>
        );
      })}
      {overflow > 0 && (
        <div
          style={{
            marginLeft: 2,
            color: 'var(--pixel-text-dim)',
            fontSize: 12,
            minWidth: 28,
            textAlign: 'center',
          }}
          title={`${overflow} agents hidden`}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
