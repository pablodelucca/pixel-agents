import type { AgentCharacterState, DbSnapshot } from '../hooks/useExtensionMessages.js';

interface DebugViewProps {
  agents: number[];
  agentStates: Record<number, AgentCharacterState>;
  dbSnapshot: DbSnapshot | null;
}

const DEBUG_Z = 40;

export function DebugView({ agents, agentStates, dbSnapshot }: DebugViewProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'var(--vscode-editor-background)',
        zIndex: DEBUG_Z,
        overflow: 'auto',
      }}
    >
      <div style={{ padding: '12px', fontSize: '22px' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '28px' }}>Wholesale Debug</h3>

        {/* Agent states */}
        <div style={{ marginBottom: 12 }}>
          <b>Agents:</b>
          {agents.map((id) => {
            const state = agentStates[id];
            return (
              <div key={id} style={{ padding: '4px 0', borderBottom: '1px solid #333' }}>
                <span style={{ fontWeight: 'bold' }}>{state?.name ?? `Agent ${id}`}</span>
                {' — '}
                <span style={{ color: state?.processStatus === 'running' ? '#a6e3a1' : '#f38ba8' }}>
                  {state?.processStatus ?? 'unknown'}
                </span>
                {' | '}
                <span>{state?.animState ?? 'unknown'}</span>
                {state?.bubble && (
                  <span style={{ color: '#89b4fa' }}> | Bubble: {state.bubble.text}</span>
                )}
                {state?.lastActivity && (
                  <span style={{ color: '#6c7086' }}> | {state.lastActivity}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* DB snapshot */}
        {dbSnapshot && (
          <div>
            <b>Database:</b>
            <pre style={{ fontSize: '18px', color: '#a6adc8', whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(dbSnapshot, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
