import { useState, useEffect, useRef } from 'react'
import { SettingsModal } from './SettingsModal.js'
import type { WorkspaceFolder, DetectedProvider, ProviderPreference } from '../hooks/useExtensionMessages.js'
import type { Provider } from '../office/types.js'

interface BottomToolbarProps {
  isEditMode: boolean
  onOpenAgent: (provider?: Provider, folderPath?: string) => void
  onToggleEditMode: () => void
  isDebugMode: boolean
  onToggleDebugMode: () => void
  workspaceFolders: WorkspaceFolder[]
  providers: DetectedProvider[]
  providerPreference: ProviderPreference
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
  providers,
  providerPreference,
}: BottomToolbarProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false)
  const [isProviderPickerOpen, setIsProviderPickerOpen] = useState(false)
  const [pendingFolderPath, setPendingFolderPath] = useState<string | undefined>(undefined)
  const [hoveredFolder, setHoveredFolder] = useState<number | null>(null)
  const [hoveredProvider, setHoveredProvider] = useState<Provider | null>(null)
  const folderPickerRef = useRef<HTMLDivElement>(null)
  const providerPickerRef = useRef<HTMLDivElement>(null)

  // Close pickers on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (isFolderPickerOpen && folderPickerRef.current && !folderPickerRef.current.contains(e.target as Node)) {
        setIsFolderPickerOpen(false)
      }
      if (isProviderPickerOpen && providerPickerRef.current && !providerPickerRef.current.contains(e.target as Node)) {
        setIsProviderPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isFolderPickerOpen, isProviderPickerOpen])

  const hasMultipleFolders = workspaceFolders.length > 1
  const installedProviders = providers.filter((p) => p.installed).map((p) => p.id)

  const getPreferredProvider = (): Provider | undefined => {
    const preferred = providerPreference.defaultProvider
    if (installedProviders.includes(preferred)) return preferred
    if (installedProviders.length > 0) return installedProviders[0]
    return 'claude'
  }

  const launchAgent = (folderPath?: string) => {
    if (providerPreference.askEachTime && installedProviders.length > 1) {
      setPendingFolderPath(folderPath)
      setIsProviderPickerOpen(true)
      return
    }
    onOpenAgent(getPreferredProvider(), folderPath)
  }

  const handleAgentClick = () => {
    if (hasMultipleFolders) {
      setIsFolderPickerOpen((v) => !v)
    } else {
      launchAgent()
    }
  }

  const handleFolderSelect = (folder: WorkspaceFolder) => {
    setIsFolderPickerOpen(false)
    launchAgent(folder.path)
  }

  const handleProviderSelect = (provider: Provider) => {
    setIsProviderPickerOpen(false)
    const folderPath = pendingFolderPath
    setPendingFolderPath(undefined)
    onOpenAgent(provider, folderPath)
  }

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', gap: 0 }}>
        <div ref={folderPickerRef} style={{ position: 'relative' }}>
          <button
            onClick={handleAgentClick}
            onMouseEnter={() => setHovered('agent')}
            onMouseLeave={() => setHovered(null)}
            style={{
              ...btnBase,
              padding: '5px 12px',
              background:
                hovered === 'agent' || isFolderPickerOpen
                  ? 'var(--pixel-agent-hover-bg)'
                  : 'var(--pixel-agent-bg)',
              border: '2px solid var(--pixel-agent-border)',
              color: 'var(--pixel-agent-text)',
              borderRight: '1px solid var(--pixel-agent-border)',
            }}
          >
            + Agent
          </button>
          {isFolderPickerOpen && (
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
                minWidth: 160,
                zIndex: 'var(--pixel-controls-z)',
              }}
            >
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
        </div>
        
        <div ref={providerPickerRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setIsProviderPickerOpen((v) => !v)}
            onMouseEnter={() => setHovered('provider-picker')}
            onMouseLeave={() => setHovered(null)}
            style={{
              ...btnBase,
              padding: '5px 6px',
              fontSize: '18px',
              background:
                hovered === 'provider-picker' || isProviderPickerOpen
                  ? 'var(--pixel-agent-hover-bg)'
                  : 'var(--pixel-agent-bg)',
              border: '2px solid var(--pixel-agent-border)',
              borderLeft: '1px solid var(--pixel-agent-border)',
              color: 'var(--pixel-agent-text)',
            }}
            title="Choose provider"
          >
            ▼
          </button>
          {isProviderPickerOpen && (
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
                minWidth: 120,
                zIndex: 'var(--pixel-controls-z)',
              }}
            >
              {providers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleProviderSelect(p.id)}
                  onMouseEnter={() => setHoveredProvider(p.id)}
                  onMouseLeave={() => setHoveredProvider(null)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 10px',
                    fontSize: '22px',
                    color: 'var(--pixel-text)',
                    background: hoveredProvider === p.id ? 'var(--pixel-btn-hover-bg)' : 'transparent',
                    border: 'none',
                    borderRadius: 0,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    opacity: p.installed ? 1 : 0.5,
                  }}
                  disabled={!p.installed}
                >
                  {p.id.charAt(0).toUpperCase() + p.id.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

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
          providers={providers}
          providerPreference={providerPreference}
        />
      </div>
    </div>
  )
}
