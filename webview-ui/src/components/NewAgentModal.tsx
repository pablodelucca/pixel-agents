import { useEffect, useState } from 'react';

import type { AgentRole, WorkspaceFolder } from '../hooks/useExtensionMessages.js';

type View = 'pick' | 'edit';

interface NewAgentModalProps {
  agentRoles: Record<string, AgentRole>;
  workspaceFolders: WorkspaceFolder[];
  onLaunch: (
    folderPath: string | undefined,
    agentName: string,
    title: string,
    description: string,
    prompt: string,
  ) => void;
  onSaveRole: (key: string, title: string, description: string, prompt: string) => void;
  onDeleteRole: (key: string) => void;
  onClose: () => void;
}

const modalBg: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  zIndex: 49,
};

const modalBox: React.CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  zIndex: 50,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  boxShadow: 'var(--pixel-shadow)',
  width: 460,
  maxWidth: '90vw',
};

const inputBase: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  color: 'var(--vscode-foreground)',
  fontSize: '20px',
  fontFamily: 'inherit',
  padding: '6px 8px',
  outline: 'none',
  boxSizing: 'border-box',
};

const btnBase: React.CSSProperties = {
  fontSize: '20px',
  padding: '5px 14px',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  cursor: 'pointer',
  fontFamily: 'inherit',
  background: 'var(--pixel-btn-bg)',
  color: 'var(--pixel-text-dim)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 12px',
  borderBottom: '1px solid var(--pixel-border)',
};

const labelStyle: React.CSSProperties = {
  fontSize: '16px',
  color: 'var(--pixel-text-dim)',
  display: 'block',
  marginBottom: 4,
};

export function NewAgentModal({
  agentRoles,
  workspaceFolders,
  onLaunch,
  onSaveRole,
  onDeleteRole,
  onClose,
}: NewAgentModalProps) {
  const [view, setView] = useState<View>('pick');
  const [selectedFolder, setSelectedFolder] = useState<string | undefined>(undefined);
  const [agentName, setAgentName] = useState('');

  // Role editing state
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPrompt, setEditPrompt] = useState('');

  // Selected role key (empty string = no role)
  const [selectedRoleKey, setSelectedRoleKey] = useState('');

  const roleKeys = Object.keys(agentRoles);
  const hasMultipleFolders = workspaceFolders.length > 1;

  useEffect(() => {
    if (!hasMultipleFolders) setSelectedFolder(undefined);
  }, [hasMultipleFolders]);

  // If selected role was deleted, reset to no role
  useEffect(() => {
    if (selectedRoleKey && !agentRoles[selectedRoleKey]) {
      setSelectedRoleKey('');
    }
  }, [agentRoles, selectedRoleKey]);

  const openEditNew = () => {
    setEditKey(null);
    setEditTitle('');
    setEditDescription('');
    setEditPrompt('');
    setView('edit');
  };

  const openEditExisting = (key: string) => {
    setEditKey(key);
    setEditTitle(agentRoles[key].title);
    setEditDescription(agentRoles[key].description);
    setEditPrompt(agentRoles[key].prompt);
    setView('edit');
  };

  const handleSaveRole = () => {
    const key = editTitle.trim();
    if (!key) return;
    if (editKey !== null && editKey !== key) {
      onDeleteRole(editKey);
    }
    onSaveRole(key, editTitle, editDescription, editPrompt);
    if (selectedRoleKey === editKey) setSelectedRoleKey(key);
    setView('pick');
  };

  const handleLaunch = () => {
    const folder = hasMultipleFolders ? selectedFolder : undefined;
    if (hasMultipleFolders && !folder) return;
    const role = agentRoles[selectedRoleKey];
    onLaunch(
      folder,
      agentName.trim(),
      role?.title ?? '',
      role?.description ?? '',
      role?.prompt ?? '',
    );
    onClose();
  };

  if (view === 'edit') {
    const canSave = !!editTitle.trim();
    return (
      <>
        <div onClick={onClose} style={modalBg} />
        <div style={modalBox}>
          <div style={headerStyle}>
            <span style={{ fontSize: '22px', color: 'rgba(255,255,255,0.9)' }}>
              {editKey === null ? 'New Role Preset' : 'Edit Role Preset'}
            </span>
            <button
              onClick={() => setView('pick')}
              style={{
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,0.5)',
                fontSize: '22px',
                cursor: 'pointer',
                padding: '0 4px',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={labelStyle}>Title</label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="e.g. Senior Frontend Engineer"
                style={inputBase}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') handleSaveRole();
                  if (e.key === 'Escape') setView('pick');
                }}
                autoFocus
              />
            </div>
            <div>
              <label style={labelStyle}>
                Description{' '}
                <span style={{ opacity: 0.6, fontSize: '14px' }}>(visible to other agents)</span>
              </label>
              <input
                type="text"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="e.g. Specializes in React and TypeScript, owns the frontend"
                style={inputBase}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
            <div>
              <label style={labelStyle}>Details</label>
              <textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder={
                  'The full instructions sent to Claude when this agent launches.\n\ne.g. You are a Senior Frontend Engineer. You specialize in React and TypeScript. You prefer functional components and always write tests before implementation.'
                }
                rows={7}
                style={{ ...inputBase, resize: 'vertical' }}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
              <button onClick={() => setView('pick')} style={btnBase}>
                Cancel
              </button>
              <button
                onClick={handleSaveRole}
                disabled={!canSave}
                style={{
                  ...btnBase,
                  background: canSave ? 'rgba(90,140,255,0.15)' : 'var(--pixel-btn-bg)',
                  color: canSave ? 'var(--pixel-accent)' : 'var(--pixel-text-dim)',
                  borderColor: canSave ? 'var(--pixel-accent)' : 'var(--pixel-border)',
                  opacity: canSave ? 1 : 0.5,
                }}
              >
                Save Preset
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Pick view
  const canLaunch = !hasMultipleFolders || !!selectedFolder;
  const selectedRole = agentRoles[selectedRoleKey];

  return (
    <>
      <div onClick={onClose} style={modalBg} />
      <div style={modalBox}>
        <div style={headerStyle}>
          <span style={{ fontSize: '22px', color: 'rgba(255,255,255,0.9)' }}>+ Agent</span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              fontSize: '22px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Agent name */}
          <div>
            <label style={labelStyle}>Agent Name (optional)</label>
            <input
              autoFocus
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="e.g. Alice"
              style={inputBase}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') handleLaunch();
                if (e.key === 'Escape') onClose();
              }}
            />
          </div>

          {/* Folder picker (multi-root only) */}
          {hasMultipleFolders && (
            <div>
              <label style={labelStyle}>Workspace Folder</label>
              <select
                value={selectedFolder ?? ''}
                onChange={(e) => setSelectedFolder(e.target.value || undefined)}
                style={{ ...inputBase, cursor: 'pointer' }}
              >
                <option value="">— select folder —</option>
                {workspaceFolders.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Job role dropdown */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 4,
              }}
            >
              <label style={{ ...labelStyle, marginBottom: 0 }}>Job Role (optional)</label>
              <button
                onClick={openEditNew}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--pixel-accent)',
                  fontSize: '16px',
                  cursor: 'pointer',
                  padding: '0 2px',
                  fontFamily: 'inherit',
                }}
              >
                + New Preset
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                value={selectedRoleKey}
                onChange={(e) => setSelectedRoleKey(e.target.value)}
                style={{ ...inputBase, flex: 1, cursor: 'pointer' }}
              >
                <option value="">No role</option>
                {roleKeys.map((key) => (
                  <option key={key} value={key}>
                    {agentRoles[key].title}
                  </option>
                ))}
              </select>
              {selectedRoleKey && (
                <>
                  <button
                    onClick={() => openEditExisting(selectedRoleKey)}
                    title="Edit preset"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--pixel-text-dim)',
                      cursor: 'pointer',
                      padding: '4px 6px',
                      fontSize: '18px',
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => {
                      onDeleteRole(selectedRoleKey);
                      setSelectedRoleKey('');
                    }}
                    title="Delete preset"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--pixel-text-dim)',
                      cursor: 'pointer',
                      padding: '4px 6px',
                      fontSize: '18px',
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
            {selectedRole?.description && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: '16px',
                  color: 'var(--pixel-text-dim)',
                  fontStyle: 'italic',
                }}
              >
                {selectedRole.description}
              </div>
            )}
          </div>

          {/* Launch button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <button
              onClick={handleLaunch}
              disabled={!canLaunch}
              style={{
                ...btnBase,
                background: canLaunch ? 'rgba(90,140,255,0.15)' : 'var(--pixel-btn-bg)',
                color: canLaunch ? 'var(--pixel-accent)' : 'var(--pixel-text-dim)',
                borderColor: canLaunch ? 'var(--pixel-accent)' : 'var(--pixel-border)',
                opacity: canLaunch ? 1 : 0.5,
                fontSize: '22px',
                padding: '6px 18px',
              }}
            >
              Launch Agent
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
