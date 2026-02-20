import type { ToolActivity } from '../office/types.js'
import { vscode } from '../vscodeApi.js'

interface DebugViewProps {
  agents: number[]
  selectedAgent: number | null
  agentTools: Record<number, ToolActivity[]>
  agentStatuses: Record<number, string>
  subagentTools: Record<number, Record<string, ToolActivity[]>>
  onSelectAgent: (id: number) => void
}

/** Z-index just below the floating toolbar (50) so the toolbar stays on top */
const DEBUG_Z = 40

function ToolDot({ tool }: { tool: ToolActivity }) {
  return (
    <span
      className={tool.done ? undefined : 'pixel-agents-pulse'}
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: tool.done
          ? 'var(--vscode-charts-green, #89d185)'
          : tool.permissionWait
            ? 'var(--vscode-charts-yellow, #cca700)'
            : 'var(--vscode-charts-blue, #3794ff)',
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  )
}

function ToolLine({ tool }: { tool: ToolActivity }) {
  return (
    <span
      style={{
        fontSize: '22px',
        opacity: tool.done ? 0.5 : 0.8,
        display: 'flex',
        alignItems: 'center',
        gap: 5,
      }}
    >
      <ToolDot tool={tool} />
      {tool.permissionWait && !tool.done ? 'Needs approval' : tool.status}
    </span>
  )
}

export function DebugView({
  agents,
  selectedAgent,
  agentTools,
  agentStatuses,
  subagentTools,
  onSelectAgent,
}: DebugViewProps) {
  const renderAgentCard = (id: number) => {
    const isSelected = selectedAgent === id
    const tools = agentTools[id] || []
    const subs = subagentTools[id] || {}
    const status = agentStatuses[id]
    const hasActiveTools = tools.some((t) => !t.done)
    return (
      <div
        key={id}
        style={{
          border: `2px solid ${isSelected ? '#5a8cff' : '#4a4a6a'}`,
          borderRadius: 0,
          padding: '6px 8px',
          background: isSelected ? 'var(--vscode-list-activeSelectionBackground, rgba(255,255,255,0.04))' : undefined,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 0 }}>
          <button
            onClick={() => onSelectAgent(id)}
            style={{
              borderRadius: 0,
              padding: '6px 10px',
              fontSize: '26px',
              background: isSelected ? 'rgba(90, 140, 255, 0.25)' : undefined,
              color: isSelected ? '#fff' : undefined,
              fontWeight: isSelected ? 'bold' : undefined,
            }}
          >
            Agent #{id}
          </button>
          <button
            onClick={() => vscode.postMessage({ type: 'closeAgent', id })}
            style={{
              borderRadius: 0,
              padding: '6px 8px',
              fontSize: '26px',
              opacity: 0.7,
              background: isSelected ? 'rgba(90, 140, 255, 0.25)' : undefined,
              color: isSelected ? '#fff' : undefined,
            }}
            title="Close agent"
          >
            ✕
          </button>
        </span>
        {(tools.length > 0 || status === 'waiting') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 4, paddingLeft: 4 }}>
            {tools.map((tool) => (
              <div key={tool.toolId}>
                <ToolLine tool={tool} />
                {subs[tool.toolId] && subs[tool.toolId].length > 0 && (
                  <div
                    style={{
                      borderLeft: '2px solid var(--vscode-widget-border, rgba(255,255,255,0.12))',
                      marginLeft: 3,
                      paddingLeft: 8,
                      marginTop: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                    }}
                  >
                    {subs[tool.toolId].map((subTool) => (
                      <ToolLine key={subTool.toolId} tool={subTool} />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {status === 'waiting' && !hasActiveTools && (
              <span
                style={{
                  fontSize: '22px',
                  opacity: 0.85,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--vscode-charts-yellow, #cca700)',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
                Might be waiting for input
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

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
      {/* Top padding so cards don't overlap the floating toolbar */}
      <div style={{ padding: '12px 12px 12px', fontSize: '28px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {agents.map(renderAgentCard)}
        </div>
      </div>
    </div>
  )
}
