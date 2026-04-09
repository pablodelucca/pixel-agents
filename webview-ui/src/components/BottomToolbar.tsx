import { useEffect, useRef, useState } from 'react';

import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import { vscode } from '../vscodeApi.js';
import { Button } from './ui/Button.js';
import { Dropdown, DropdownItem } from './ui/Dropdown.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  onToggleEditMode: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  workspaceFolders: WorkspaceFolder[];
}

type AgentType = 'claude-code' | 'copilot-cli';

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
};

const btnBase: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: '24px',
  color: 'var(--pixel-text)',
  background: 'var(--pixel-btn-bg)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
};

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: 'var(--pixel-active-bg)',
  border: '2px solid var(--pixel-accent)',
};

export function BottomToolbar({
  isEditMode,
  onToggleEditMode,
  isSettingsOpen,
  onToggleSettings,
  workspaceFolders,
}: BottomToolbarProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAgentMenuOpen, setIsAgentMenuOpen] = useState(false);
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [hoveredFolder, setHoveredFolder] = useState<number | null>(null);
  const [hoveredAgentOption, setHoveredAgentOption] = useState<number | null>(null);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const pendingAgentTypeRef = useRef<AgentType>('claude-code');
  const pendingBypassRef = useRef(false);

  // Close menus on outside click
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [isBypassMenuOpen, setIsBypassMenuOpen] = useState(false);
  const folderPickerRef = useRef<HTMLDivElement>(null);
  const pendingBypassRef = useRef(false);
  // Close folder picker / bypass menu on outside click
  useEffect(() => {
    if (!isAgentMenuOpen && !isFolderPickerOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (agentMenuRef.current && !agentMenuRef.current.contains(e.target as Node)) {
        setIsAgentMenuOpen(false);
        setIsFolderPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isAgentMenuOpen, isFolderPickerOpen]);

  const hasMultipleFolders = workspaceFolders.length > 1;

  const launchAgent = (agentType: AgentType, bypassPermissions: boolean, folderPath?: string) => {
    vscode.postMessage({
      type: 'openClaude',
      agentType,
      bypassPermissions,
      folderPath,
    });
  const handleAgentClick = () => {
    setIsBypassMenuOpen(false);
    pendingBypassRef.current = false;
    if (hasMultipleFolders) {
      setIsFolderPickerOpen((v) => !v);
    } else {
      onOpenClaude();
    }
  };

  const handleAgentHover = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(true);
    }
  };

  const handleAgentLeave = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(false);
    }
  };

  const handleAgentClick = () => {
    setIsAgentMenuOpen((v) => !v);
    setIsFolderPickerOpen(false);
  };

  const handleAgentTypeSelect = (agentType: AgentType, bypassPermissions: boolean) => {
    setIsAgentMenuOpen(false);
    if (hasMultipleFolders) {
      pendingAgentTypeRef.current = agentType;
      pendingBypassRef.current = bypassPermissions;
      setIsFolderPickerOpen(true);
    } else {
      launchAgent(agentType, bypassPermissions);
    }
  };

  const handleFolderSelect = (folder: WorkspaceFolder) => {
    setIsFolderPickerOpen(false);
    launchAgent(pendingAgentTypeRef.current, pendingBypassRef.current, folder.path);
  };

  return (
    <div style={panelStyle}>
      <div ref={agentMenuRef} style={{ position: 'relative' }}>
        <button
          onClick={handleAgentClick}
          onMouseEnter={() => setHovered('agent')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...btnBase,
            padding: '5px 12px',
            background:
              hovered === 'agent' || isAgentMenuOpen || isFolderPickerOpen
                ? 'var(--pixel-agent-hover-bg)'
                : 'var(--pixel-agent-bg)',
            border: '2px solid var(--pixel-agent-border)',
            color: 'var(--pixel-agent-text)',
          }}
        >
          + Agent
        </button>
        {isAgentMenuOpen && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              marginBottom: 4,
              background: 'var(--pixel-bg)',
              border: '2px solid var(--pixel-border)',
              borderRadius: 0,
              padding: 4,
              boxShadow: 'var(--pixel-shadow)',
              minWidth: 200,
              zIndex: 'var(--pixel-controls-z)',
            }}
          >
            <button
              onClick={() => handleAgentTypeSelect('claude-code', false)}
              onMouseEnter={() => setHoveredAgentOption(0)}
              onMouseLeave={() => setHoveredAgentOption(null)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                fontSize: '24px',
                color: 'var(--pixel-text)',
                background: hoveredAgentOption === 0 ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                border: 'none',
                borderRadius: 0,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Claude Code
            </button>
            <button
              onClick={() => handleAgentTypeSelect('claude-code', true)}
              onMouseEnter={() => setHoveredAgentOption(1)}
              onMouseLeave={() => setHoveredAgentOption(null)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                fontSize: '24px',
                color: 'var(--pixel-warning-text)',
                background: hoveredAgentOption === 1 ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                border: 'none',
                borderRadius: 0,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ fontSize: '16px' }}>⚡</span> Claude Code (Bypass)
            </button>
            <div style={{ height: 1, margin: '4px 0', background: 'var(--pixel-border)' }} />
            <button
              onClick={() => handleAgentTypeSelect('copilot-cli', false)}
              onMouseEnter={() => setHoveredAgentOption(2)}
              onMouseLeave={() => setHoveredAgentOption(null)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                fontSize: '24px',
                color: 'var(--pixel-text)',
                background: hoveredAgentOption === 2 ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                border: 'none',
                borderRadius: 0,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Copilot CLI
            </button>
          </div>
        )}
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
    <div className="absolute bottom-10 left-10 z-20 flex items-center gap-4 pixel-panel p-4">
      <div
        ref={folderPickerRef}
        className="relative"
        onMouseEnter={handleAgentHover}
        onMouseLeave={handleAgentLeave}
      >
        <Button
          variant="accent"
          onClick={handleAgentClick}
          className={
            isFolderPickerOpen || isBypassMenuOpen
              ? 'bg-accent-bright'
              : 'bg-accent hover:bg-accent-bright'
          }
        >
          + Agent
        </Button>
        <Dropdown isOpen={isBypassMenuOpen}>
          <DropdownItem onClick={() => handleBypassSelect(true)}>
            Skip permissions mode <span className="text-2xs text-warning">⚠</span>
          </DropdownItem>
        </Dropdown>
        <Dropdown isOpen={isFolderPickerOpen} className="min-w-128">
          {workspaceFolders.map((folder) => (
            <DropdownItem
              key={folder.path}
              onClick={() => handleFolderSelect(folder)}
              className="text-base"
            >
              {folder.name}
            </DropdownItem>
          ))}
        </Dropdown>
      </div>
      <Button
        variant={isEditMode ? 'active' : 'default'}
        onClick={onToggleEditMode}
        title="Edit office layout"
      >
        Layout
      </Button>
      <Button
        variant={isSettingsOpen ? 'active' : 'default'}
        onClick={onToggleSettings}
        title="Settings"
      >
        Settings
      </Button>
    </div>
  );
}
