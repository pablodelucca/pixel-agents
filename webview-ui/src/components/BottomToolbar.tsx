import { useEffect, useRef, useState } from 'react';

import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import { vscode } from '../vscodeApi.js';
import { SettingsModal } from './SettingsModal.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  onToggleEditMode: () => void;
  isDebugMode: boolean;
  onToggleDebugMode: () => void;
  alwaysShowOverlay: boolean;
  onToggleAlwaysShowOverlay: () => void;
  workspaceFolders: WorkspaceFolder[];
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

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 'var(--pixel-modal-z)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.5)',
};

const modalStyle: React.CSSProperties = {
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  boxShadow: '4px 4px 0px #0a0a14',
  padding: '16px 20px',
  minWidth: 300,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const labelStyle: React.CSSProperties = {
  fontSize: '18px',
  color: 'var(--pixel-text-dim)',
  display: 'block',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  fontSize: '20px',
  background: 'var(--pixel-input-bg, #2a2a3e)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  color: 'var(--pixel-text)',
  boxSizing: 'border-box',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
};

export function BottomToolbar({
  isEditMode,
  onToggleEditMode,
  isDebugMode,
  onToggleDebugMode,
  alwaysShowOverlay,
  onToggleAlwaysShowOverlay,
  workspaceFolders,
}: BottomToolbarProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Default folder path when modal opens
  const defaultFolder = workspaceFolders[0]?.path ?? '';

  const openModal = () => {
    setAgentName('');
    setFolderPath(defaultFolder);
    setIsAgentModalOpen(true);
  };

  // Focus name input when modal opens
  useEffect(() => {
    if (isAgentModalOpen) {
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [isAgentModalOpen]);

  // Listen for folder chosen from extension
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'agentFolderChosen') {
        setFolderPath(e.data.path as string);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleBrowse = () => {
    vscode.postMessage({ type: 'browseFolderForAgent' });
  };

  const handleSubmit = () => {
    if (!folderPath.trim()) return;
    vscode.postMessage({
      type: 'openClaude',
      folderPath: folderPath.trim(),
      agentName: agentName.trim() || undefined,
    });
    setIsAgentModalOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') setIsAgentModalOpen(false);
  };

  return (
    <div style={panelStyle}>
      <button
        onClick={openModal}
        onMouseEnter={() => setHovered('agent')}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...btnBase,
          padding: '5px 12px',
          background:
            hovered === 'agent' || isAgentModalOpen
              ? 'var(--pixel-agent-hover-bg)'
              : 'var(--pixel-agent-bg)',
          border: '2px solid var(--pixel-agent-border)',
          color: 'var(--pixel-agent-text)',
        }}
      >
        + Agent
      </button>
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
                  background:
                    hovered === 'settings' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
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
          alwaysShowOverlay={alwaysShowOverlay}
          onToggleAlwaysShowOverlay={onToggleAlwaysShowOverlay}
        />
      </div>

      {isAgentModalOpen && (
        <div style={overlayStyle} onMouseDown={() => setIsAgentModalOpen(false)}>
          <div
            style={modalStyle}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
          >
            <div style={{ fontSize: '22px', color: 'var(--pixel-text)', fontWeight: 'bold' }}>
              New Agent
            </div>
            <div>
              <label style={labelStyle}>Name (optional)</label>
              <input
                ref={nameInputRef}
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="e.g. Alice"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Folder</label>
              <div style={rowStyle}>
                <input
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="Select a folder..."
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  onClick={handleBrowse}
                  style={{
                    ...btnBase,
                    padding: '5px 10px',
                    fontSize: '20px',
                    flexShrink: 0,
                  }}
                >
                  Browse
                </button>
              </div>
            </div>
            <div style={{ ...rowStyle, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                onClick={() => setIsAgentModalOpen(false)}
                style={{ ...btnBase, fontSize: '20px' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!folderPath.trim()}
                style={{
                  ...btnBase,
                  fontSize: '20px',
                  background: folderPath.trim() ? 'var(--pixel-agent-bg)' : 'var(--pixel-btn-bg)',
                  border: '2px solid var(--pixel-agent-border)',
                  color: folderPath.trim() ? 'var(--pixel-agent-text)' : 'var(--pixel-text-dim)',
                  cursor: folderPath.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Launch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
