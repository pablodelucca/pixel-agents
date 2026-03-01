import { useState, useEffect, useRef } from 'react'
import { SettingsModal } from './SettingsModal.js'
import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js'
import { vscode } from '../vscodeApi.js'

type AgentTypeOption = {
  type: string
  label: string
  description: string
}

const AGENT_TYPES: AgentTypeOption[] = [
  { type: 'claude-code', label: 'Claude Code', description: 'Claude Code CLI agent with full tool tracking' },
  { type: 'opencode', label: 'Opencode', description: 'Opencode AI coding assistant' },
  { type: 'vscode-terminal', label: 'VS Code Terminal', description: 'Connect any terminal as an agent' },
  { type: 'adopt-terminal', label: 'Adopt Existing Terminal', description: 'Pick a running terminal to connect' },
]

interface BottomToolbarProps {
  isEditMode: boolean
  onOpenAgent: (agentType: string) => void
  onToggleEditMode: () => void
  isDebugMode: boolean
  onToggleDebugMode: () => void
  workspaceFolders: WorkspaceFolder[]
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 10,
  left: 10,
  zIndex: 'var(--pixel-controls-z)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  padding: '4px 6px',
  boxShadow: 'var(--pixel-shadow)',
}

const btnBase: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: '24px',
  color: 'var(--pixel-text)',
  background: 'var(--pixel-btn-bg)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
}

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: 'var(--pixel-active-bg)',
  border: '2px solid var(--pixel-accent)',
}


export function BottomToolbar({
  isEditMode,
  onOpenAgent,
  onToggleEditMode,
  isDebugMode,
  onToggleDebugMode,
  workspaceFolders,
}: BottomToolbarProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAgentPickerOpen, setIsAgentPickerOpen] = useState(false)
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false)
  const [hoveredFolder, setHoveredFolder] = useState<number | null>(null)
  const [hoveredAgentType, setHoveredAgentType] = useState<number | null>(null)
  const [pendingAgentType, setPendingAgentType] = useState<string | null>(null)
  const folderPickerRef = useRef<HTMLDivElement>(null)
  const agentPickerRef = useRef<HTMLDivElement>(null)

  // Close pickers on outside click
  useEffect(() => {
    if (!isFolderPickerOpen && !isAgentPickerOpen) return
    const handleClick = (e: MouseEvent) => {
      if (isFolderPickerOpen && folderPickerRef.current && !folderPickerRef.current.contains(e.target as Node)) {
        setIsFolderPickerOpen(false)
        setPendingAgentType(null)
      }
      if (isAgentPickerOpen && agentPickerRef.current && !agentPickerRef.current.contains(e.target as Node)) {
        setIsAgentPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isFolderPickerOpen, isAgentPickerOpen])

  const hasMultipleFolders = workspaceFolders.length > 1

  const handleAgentClick = () => {
    setIsAgentPickerOpen((v) => !v)
    setIsFolderPickerOpen(false)
    setPendingAgentType(null)
  }

  const handleAgentTypeSelect = (agentType: string) => {
    if (agentType === 'adopt-terminal') {
      // Adopt existing terminal — no folder selection needed
      setIsAgentPickerOpen(false)
      vscode.postMessage({ type: 'adoptTerminal' })
      return
    }

    if (hasMultipleFolders && agentType !== 'vscode-terminal') {
      // Show folder picker for non-terminal agents in multi-root workspace
      setPendingAgentType(agentType)
      setIsAgentPickerOpen(false)
      setIsFolderPickerOpen(true)
    } else {
      setIsAgentPickerOpen(false)
      onOpenAgent(agentType)
    }
  }

  const handleFolderSelect = (folder: WorkspaceFolder) => {
    setIsFolderPickerOpen(false)
    const agentType = pendingAgentType || 'claude-code'
    setPendingAgentType(null)
    vscode.postMessage({ type: 'openClaude', agentType, folderPath: folder.path })
  }

  return (
    <div style={panelStyle}>
      <div ref={agentPickerRef} style={{ position: 'relative' }}>
        <button
          onClick={handleAgentClick}
          onMouseEnter={() => setHovered('agent')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...btnBase,
            padding: '5px 12px',
            background:
              hovered === 'agent' || isAgentPickerOpen
                ? 'var(--pixel-agent-hover-bg)'
                : 'var(--pixel-agent-bg)',
            border: '2px solid var(--pixel-agent-border)',
            color: 'var(--pixel-agent-text)',
          }}
        >
          + Agent
        </button>
        {isAgentPickerOpen && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              marginBottom: 4,
              background: 'var(--pixel-bg)',
              border: '2px solid var(--pixel-border)',
              borderRadius: 0,
              boxShadow: 'var(--pixel-shadow)',
              minWidth: 220,
              zIndex: 'var(--pixel-controls-z)',
            }}
          >
            <div style={{ padding: '4px 10px', fontSize: '18px', color: 'var(--pixel-text-dim)', borderBottom: '1px solid var(--pixel-border)' }}>
              Choose agent type
            </div>
            {AGENT_TYPES.map((at, i) => (
              <button
                key={at.type}
                onClick={() => handleAgentTypeSelect(at.type)}
                onMouseEnter={() => setHoveredAgentType(i)}
                onMouseLeave={() => setHoveredAgentType(null)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  fontSize: '22px',
                  color: 'var(--pixel-text)',
                  background: hoveredAgentType === i ? 'var(--pixel-btn-hover-bg)' : 'transparent',
                  border: 'none',
                  borderRadius: 0,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                title={at.description}
              >
                {at.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Folder picker for multi-root workspaces */}
      {isFolderPickerOpen && (
        <div
          ref={folderPickerRef}
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 10,
            marginBottom: 4,
            background: 'var(--pixel-bg)',
            border: '2px solid var(--pixel-border)',
            borderRadius: 0,
            boxShadow: 'var(--pixel-shadow)',
            minWidth: 160,
            zIndex: 'var(--pixel-controls-z)',
          }}
        >
          <div style={{ padding: '4px 10px', fontSize: '18px', color: 'var(--pixel-text-dim)', borderBottom: '1px solid var(--pixel-border)' }}>
            Choose workspace folder
          </div>
          {workspaceFolders.map((folder, i) => (
            <button
              key={folder.path}
              onClick={() => handleFolderSelect(folder)}
              onMouseEnter={() => setHoveredFolder(i)}
              onMouseLeave={() => setHoveredFolder(null)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                fontSize: '22px',
                color: 'var(--pixel-text)',
                background: hoveredFolder === i ? 'var(--pixel-btn-hover-bg)' : 'transparent',
                border: 'none',
                borderRadius: 0,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {folder.name}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={onToggleEditMode}
        onMouseEnter={() => setHovered('edit')}
        onMouseLeave={() => setHovered(null)}
        style={
          isEditMode
            ? { ...btnActive }
            : {
                ...btnBase,
                background: hovered === 'edit' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
              }
        }
        title="Edit office layout"
      >
        Layout
      </button>
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setIsSettingsOpen((v) => !v)}
          onMouseEnter={() => setHovered('settings')}
          onMouseLeave={() => setHovered(null)}
          style={
            isSettingsOpen
              ? { ...btnActive }
              : {
                  ...btnBase,
                  background: hovered === 'settings' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
                }
          }
          title="Settings"
        >
          Settings
        </button>
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          isDebugMode={isDebugMode}
          onToggleDebugMode={onToggleDebugMode}
        />
      </div>
    </div>
  )
}
