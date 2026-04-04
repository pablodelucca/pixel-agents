import { useEffect, useMemo, useState } from 'react';

import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import { isElectronRuntime } from '../runtime.js';
import { vscode } from '../vscodeApi.js';

interface AgentCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultProviderId: string;
  providerName: string;
  workspaceFolders: WorkspaceFolder[];
  supportsBypassPermissions: boolean;
}

type ProviderId = 'claude' | 'codex' | 'gemini' | 'custom';

const MODAL_TEXT_COLOR = 'rgba(233, 244, 255, 0.95)';

const modalInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  background: 'var(--pixel-bg)',
  color: MODAL_TEXT_COLOR,
  WebkitTextFillColor: MODAL_TEXT_COLOR,
  padding: '8px',
  fontSize: '18px',
};

function isProviderId(value: string): value is ProviderId {
  return value === 'claude' || value === 'codex' || value === 'gemini' || value === 'custom';
}

function normalizeProviderId(value: string): ProviderId {
  return isProviderId(value) ? value : 'claude';
}

export function AgentCreateModal({
  isOpen,
  onClose,
  defaultProviderId,
  providerName,
  workspaceFolders,
  supportsBypassPermissions,
}: AgentCreateModalProps) {
  const fallbackFolder = useMemo(() => workspaceFolders[0]?.path ?? '', [workspaceFolders]);
  const [providerId, setProviderId] = useState<ProviderId>('claude');
  const [projectPath, setProjectPath] = useState('');
  const [bypassPermissions, setBypassPermissions] = useState(false);
  const [rememberAsDefault, setRememberAsDefault] = useState(true);
  const [customName, setCustomName] = useState('');
  const [customCommand, setCustomCommand] = useState('');
  const [customProjectsRoot, setCustomProjectsRoot] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setProviderId(normalizeProviderId(defaultProviderId));
    setProjectPath(fallbackFolder);
    setBypassPermissions(false);
    setRememberAsDefault(true);
    setCustomName('');
    setCustomCommand('');
    setCustomProjectsRoot('');
    setErrorMessage('');
  }, [isOpen, defaultProviderId, fallbackFolder]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: MessageEvent) => {
      const message = event.data as { type?: string; folderPath?: string; message?: string };
      if (message.type === 'projectFolderPicked' && typeof message.folderPath === 'string') {
        setProjectPath(message.folderPath);
      } else if (message.type === 'hostError' && typeof message.message === 'string') {
        setErrorMessage(message.message);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [isOpen]);

  if (!isOpen) return null;

  const canUseBypass = providerId === 'claude' && supportsBypassPermissions;

  const submit = () => {
    const providerOverride =
      providerId === 'custom'
        ? {
            id: 'custom',
            customDisplayName: customName.trim() || undefined,
            customCommand: customCommand.trim() || undefined,
            customProjectsRoot: customProjectsRoot.trim() || undefined,
          }
        : { id: providerId };

    vscode.postMessage({
      type: 'openAgent',
      folderPath: projectPath.trim() || undefined,
      bypassPermissions: canUseBypass ? bypassPermissions : false,
      providerOverride,
      rememberProviderDefault: rememberAsDefault,
    });
    onClose();
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.55)',
          zIndex: 80,
        }}
      />
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(560px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          boxShadow: 'var(--pixel-shadow)',
          zIndex: 81,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          color: MODAL_TEXT_COLOR,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: '26px', color: MODAL_TEXT_COLOR }}>New Agent</strong>
          <button
            style={{ ...modalInputStyle, width: 'auto', padding: '4px 8px' }}
            onClick={onClose}
          >
            X
          </button>
        </div>

        <label style={{ fontSize: '18px', opacity: 0.9, color: MODAL_TEXT_COLOR }}>Provider</label>
        <select
          value={providerId}
          onChange={(event) => setProviderId(normalizeProviderId(event.target.value))}
          style={modalInputStyle}
        >
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
          <option value="gemini">Gemini CLI</option>
          <option value="custom">Custom</option>
        </select>

        {providerId === 'custom' && (
          <>
            <input
              style={modalInputStyle}
              placeholder="Custom display name (optional)"
              value={customName}
              onChange={(event) => setCustomName(event.target.value)}
            />
            <input
              style={modalInputStyle}
              placeholder="Command template (use {sessionId})"
              value={customCommand}
              onChange={(event) => setCustomCommand(event.target.value)}
            />
            <input
              style={modalInputStyle}
              placeholder="Projects root (optional)"
              value={customProjectsRoot}
              onChange={(event) => setCustomProjectsRoot(event.target.value)}
            />
          </>
        )}

        <label style={{ fontSize: '18px', opacity: 0.9, color: MODAL_TEXT_COLOR }}>
          Project Folder
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            style={modalInputStyle}
            value={projectPath}
            placeholder="/path/to/project"
            onChange={(event) => setProjectPath(event.target.value)}
          />
          {isElectronRuntime && (
            <button
              style={{ ...modalInputStyle, width: 'auto', padding: '8px 12px', cursor: 'pointer' }}
              onClick={() => vscode.postMessage({ type: 'pickProjectFolder' })}
            >
              Browse
            </button>
          )}
        </div>

        {canUseBypass && (
          <label
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              fontSize: '18px',
              color: MODAL_TEXT_COLOR,
            }}
          >
            <input
              type="checkbox"
              checked={bypassPermissions}
              onChange={(event) => setBypassPermissions(event.target.checked)}
            />
            Bypass Permissions
          </label>
        )}

        <label
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            fontSize: '18px',
            color: MODAL_TEXT_COLOR,
          }}
        >
          <input
            type="checkbox"
            checked={rememberAsDefault}
            onChange={(event) => setRememberAsDefault(event.target.checked)}
          />
          Remember provider as default ({providerName})
        </label>

        {errorMessage && (
          <div
            style={{
              border: '2px solid #7d2e2e',
              background: '#3b1a1a',
              color: '#f2c2c2',
              padding: '8px',
              fontSize: '16px',
            }}
          >
            {errorMessage}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            style={{ ...modalInputStyle, width: 'auto', cursor: 'pointer' }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            style={{
              ...modalInputStyle,
              width: 'auto',
              cursor: 'pointer',
              background: 'var(--pixel-agent-bg)',
              borderColor: 'var(--pixel-agent-border)',
            }}
            onClick={submit}
          >
            Create Agent
          </button>
        </div>
      </div>
    </>
  );
}
