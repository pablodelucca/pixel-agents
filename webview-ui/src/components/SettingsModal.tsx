import { useState } from 'react';

import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js';
import { vscode } from '../vscodeApi.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDebugMode: boolean;
  onToggleDebugMode: () => void;
  provider: 'copilot' | 'claude';
  onSetProvider: (p: 'copilot' | 'claude') => void;
}

const menuItemBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '6px 10px',
  fontSize: '24px',
  color: 'rgba(255, 255, 255, 0.8)',
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
  cursor: 'pointer',
  textAlign: 'left',
};

export function SettingsModal({
  isOpen,
  onClose,
  isDebugMode,
  onToggleDebugMode,
  provider,
  onSetProvider,
}: SettingsModalProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled);

  if (!isOpen) return null;

  return (
    <>
      {/* Dark backdrop — click to close */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 49,
        }}
      />
      {/* Centered modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 50,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '4px',
          boxShadow: 'var(--pixel-shadow)',
          minWidth: 200,
        }}
      >
        {/* Header with title and X button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 10px',
            borderBottom: '1px solid var(--pixel-border)',
            marginBottom: '4px',
          }}
        >
          <span style={{ fontSize: '24px', color: 'rgba(255, 255, 255, 0.9)' }}>Settings</span>
          <button
            onClick={onClose}
            onMouseEnter={() => setHovered('close')}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: hovered === 'close' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              border: 'none',
              borderRadius: 0,
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            X
          </button>
        </div>

        {/* Agent Provider toggle — Claude first */}
        <div
          style={{
            padding: '6px 10px',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            marginBottom: '2px',
          }}
        >
          <div style={{ fontSize: '20px', color: 'rgba(255,255,255,0.5)', marginBottom: '6px' }}>
            Agent Provider
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['claude', 'copilot'] as const).map((p) => {
              const active = provider === p;
              const hovKey = `provider-${p}`;
              return (
                <button
                  key={p}
                  onClick={() => {
                    onSetProvider(p);
                    vscode.postMessage({ type: 'setAgentProvider', provider: p });
                  }}
                  onMouseEnter={() => setHovered(hovKey)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    fontSize: '20px',
                    color: active ? '#fff' : 'rgba(255,255,255,0.5)',
                    background: active
                      ? 'rgba(90, 140, 255, 0.25)'
                      : hovered === hovKey
                        ? 'rgba(255,255,255,0.08)'
                        : 'transparent',
                    border: `2px solid ${active ? 'rgba(90,140,255,0.8)' : 'rgba(255,255,255,0.2)'}`,
                    borderRadius: 0,
                    cursor: 'pointer',
                    textAlign: 'center',
                  }}
                >
                  {p === 'copilot' ? 'Copilot' : 'Claude'}
                </button>
              );
            })}
          </div>
        </div>

        {/* Menu items */}
        <button
          onClick={() => {
            vscode.postMessage({ type: 'openSessionsFolder' });
            onClose();
          }}
          onMouseEnter={() => setHovered('sessions')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'sessions' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Open Sessions Folder
        </button>
        <button
          onClick={() => {
            vscode.postMessage({ type: 'exportLayout' });
            onClose();
          }}
          onMouseEnter={() => setHovered('export')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'export' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Export Layout
        </button>
        <button
          onClick={() => {
            vscode.postMessage({ type: 'importLayout' });
            onClose();
          }}
          onMouseEnter={() => setHovered('import')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'import' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Import Layout
        </button>
        <button
          onClick={() => {
            const newVal = !isSoundEnabled();
            setSoundEnabled(newVal);
            setSoundLocal(newVal);
            vscode.postMessage({ type: 'setSoundEnabled', enabled: newVal });
          }}
          onMouseEnter={() => setHovered('sound')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'sound' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Sound Notifications</span>
          <span
            style={{
              width: 14,
              height: 14,
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: 0,
              background: soundLocal ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              lineHeight: 1,
              color: '#fff',
            }}
          >
            {soundLocal ? 'X' : ''}
          </span>
        </button>
        <button
          onClick={onToggleDebugMode}
          onMouseEnter={() => setHovered('debug')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'debug' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Debug View</span>
          {isDebugMode && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'rgba(90, 140, 255, 0.8)',
                flexShrink: 0,
              }}
            />
          )}
        </button>
      </div>
    </>
  );
}
