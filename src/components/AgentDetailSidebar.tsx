import { useEffect, useState } from 'react';
import { Activity, Brain, Edit3, Folder, Heart, Save, Sparkles, User, X, Wrench } from 'lucide-react';

import type { Character } from '../office/types.js';

// API base URL - backend server
const API_BASE_URL = '';

interface OfficeServer {
  id: string;
  username: string;
  ip: string;
  cpu: number;
  ram: number;
  storage: number;
}

interface WorkspaceFiles {
  'AGENTS.md': string;
  'HEARTBEAT.md': string;
  'IDENTITY.md': string;
  'MEMORY.md': string;
  'SOUL.md': string;
  'TOOLS.md': string;
  'USER.md': string;
}

// Tab configuration with icons and labels
const TABS = [
  { id: 'IDENTITY.md' as const, label: 'Identity', Icon: User },
  { id: 'SOUL.md' as const, label: 'Soul', Icon: Sparkles },
  { id: 'USER.md' as const, label: 'User', Icon: Heart },
  { id: 'AGENTS.md' as const, label: 'Workspace', Icon: Folder },
  { id: 'TOOLS.md' as const, label: 'Tools', Icon: Wrench },
  { id: 'MEMORY.md' as const, label: 'Memory', Icon: Brain },
  { id: 'HEARTBEAT.md' as const, label: 'Heartbeat', Icon: Activity },
] as const;

type TabId = typeof TABS[number]['id'];

// Pixel-style avatar component
function CharacterAvatar({ character, size = 80 }: { character: Character; size?: number }) {
  const paletteColors = [
    '#FF6B6B', // Red
    '#4ECDC4', // Teal
    '#45B7D1', // Blue
    '#96CEB4', // Green
    '#FFEAA7', // Yellow
    '#DDA0DD', // Plum
  ];
  const bgColor = paletteColors[character.palette % paletteColors.length];
  const emoji = character.displayName?.match(/^(\p{Emoji})/u)?.[1] || '🤖';

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: bgColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.5,
        border: '3px solid var(--pixel-border)',
        boxShadow: '4px 4px 0 rgba(0,0,0,0.3)',
        flexShrink: 0,
      }}
    >
      {emoji}
    </div>
  );
}

// Simple markdown-like renderer
function MarkdownContent({ content }: { content: string }) {
  if (!content.trim()) {
    return (
      <div
        style={{
          color: 'var(--pixel-text-dim)',
          fontStyle: 'italic',
          textAlign: 'center',
          padding: 20,
        }}
      >
        No content
      </div>
    );
  }

  // Parse markdown into lines and render
  const lines = content.split('\n');

  return (
    <div
      style={{
        fontSize: 18,
        lineHeight: 1.6,
        color: 'var(--pixel-text)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {lines.map((line, i) => {
        // Headers
        if (line.startsWith('# ')) {
          return (
            <div
              key={i}
              style={{
                fontSize: 28,
                fontWeight: 'bold',
                color: 'var(--pixel-accent)',
                marginTop: i === 0 ? 0 : 16,
                marginBottom: 8,
              }}
            >
              {line.slice(2)}
            </div>
          );
        }
        if (line.startsWith('## ')) {
          return (
            <div
              key={i}
              style={{
                fontSize: 24,
                fontWeight: 'bold',
                color: 'var(--pixel-text)',
                marginTop: 16,
                marginBottom: 8,
              }}
            >
              {line.slice(3)}
            </div>
          );
        }
        if (line.startsWith('### ')) {
          return (
            <div
              key={i}
              style={{
                fontSize: 20,
                fontWeight: 'bold',
                color: 'var(--pixel-text)',
                marginTop: 12,
                marginBottom: 6,
              }}
            >
              {line.slice(4)}
            </div>
          );
        }

        // Horizontal rule
        if (line.trim() === '---') {
          return (
            <div
              key={i}
              style={{
                borderTop: '1px solid var(--pixel-border)',
                margin: '16px 0',
              }}
            />
          );
        }

        // List items
        if (line.trim().startsWith('- ')) {
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 8,
                marginLeft: 8,
                marginBottom: 4,
              }}
            >
              <span style={{ color: 'var(--pixel-accent)' }}>•</span>
              <span>{renderInlineFormatting(line.trim().slice(2))}</span>
            </div>
          );
        }

        // Bold text with **text**
        if (line.includes('**')) {
          return (
            <div key={i} style={{ marginBottom: 4 }}>
              {renderInlineFormatting(line)}
            </div>
          );
        }

        // Empty line
        if (!line.trim()) {
          return <div key={i} style={{ height: 8 }} />;
        }

        // Regular text
        return (
          <div key={i} style={{ marginBottom: 4 }}>
            {line}
          </div>
        );
      })}
    </div>
  );
}

// Helper to render inline formatting (bold, italic, code)
function renderInlineFormatting(text: string): React.ReactNode {
  // Simple regex-based replacement for **bold**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} style={{ fontWeight: 'bold' }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    // Check for inline code
    const codeParts = part.split(/(`[^`]+`)/g);
    if (codeParts.length > 1) {
      return codeParts.map((cp, j) => {
        if (cp.startsWith('`') && cp.endsWith('`')) {
          return (
            <code
              key={`${i}-${j}`}
              style={{
                background: 'rgba(0,0,0,0.3)',
                padding: '2px 6px',
                borderRadius: 4,
                fontFamily: 'monospace',
                fontSize: 16,
              }}
            >
              {cp.slice(1, -1)}
            </code>
          );
        }
        return cp;
      });
    }
    return part;
  });
}

export function AgentDetailSidebar({
  character,
  isOpen,
  onClose,
  server,
}: {
  character: Character;
  isOpen: boolean;
  onClose: () => void;
  server: OfficeServer | null;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('IDENTITY.md');
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFiles | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Extract name from displayName
  const name = character.displayName?.replace(/^(\p{Emoji}\s*)/u, '') || `Agent ${character.id}`;
  const status = character.isActive ? 'Working...' : 'Idle';

  // Fetch workspace files when sidebar opens
  useEffect(() => {
    // Only fetch if sidebar is open, server exists, and we don't have files yet
    if (!isOpen || !server?.id || !character.agentId) {
      return;
    }

    let cancelled = false;

    // Reset state at the start of fetch
    console.log('[AgentDetailSidebar] Starting fetch for character:', character.id);
    setWorkspaceFiles(null);
    setError(null);
    setActiveTab('IDENTITY.md');
    setIsEditMode(false); // Reset edit mode on new fetch
    setEditContent('');
    setIsLoading(true);

    const fetchWorkspace = async () => {
      // Check if cancelled
      if (cancelled) return;

      const url = `${API_BASE_URL}/api/servers/${server.id}/sessions/workspace?agentId=${character.agentId}`;
      console.log('[AgentDetailSidebar] Fetching from:', url);

      try {
        const response = await fetch(url);

        if (cancelled) return;

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('[AgentDetailSidebar] API error:', errorData);
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('[AgentDetailSidebar] Workspace response:', data.success, 'files:', Object.keys(data.data || {}).length);

        if (cancelled) return;

        if (data.success && data.data) {
          console.log('[AgentDetailSidebar] Setting workspace files, clearing error');
          setWorkspaceFiles(data.data);
          setError(null); // Clear any previous error
        } else {
          console.error('[AgentDetailSidebar] API returned failure:', data);
          setError(data.error || 'Failed to load workspace');
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[AgentDetailSidebar] Failed to fetch workspace:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchWorkspace();

    // Cleanup function to cancel pending fetch
    return () => {
      cancelled = true;
    };
  }, [isOpen, server?.id, character.agentId]);

  // Update edit content when active tab or workspace files change
  useEffect(() => {
    if (workspaceFiles && activeTab) {
      setEditContent(workspaceFiles[activeTab] || '');
    }
  }, [workspaceFiles, activeTab]);

  // Handle entering edit mode
  const handleEdit = () => {
    if (workspaceFiles) {
      setEditContent(workspaceFiles[activeTab] || '');
      setIsEditMode(true);
      setSaveError(null);
      setSaveSuccess(false);
    }
  };

  // Handle canceling edit mode
  const handleCancelEdit = () => {
    setIsEditMode(false);
    setEditContent(workspaceFiles?.[activeTab] || '');
    setSaveError(null);
    setSaveSuccess(false);
  };

  // Handle saving the file
  const handleSave = async () => {
    if (!server?.id || !character.agentId) return;

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/servers/${server.id}/sessions/workspace`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filename: activeTab,
            content: editContent,
            agentId: character.agentId,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to save file');
      }

      // Update local state with new content
      setWorkspaceFiles((prev) =>
        prev ? { ...prev, [activeTab]: editContent } : null
      );
      setIsEditMode(false);
      setSaveSuccess(true);

      // Clear success message after 3 seconds
      setTimeout(() => setSaveSuccess(false), 3000);

      console.log('[AgentDetailSidebar] File saved successfully:', activeTab);
    } catch (err) {
      console.error('[AgentDetailSidebar] Failed to save file:', err);
      setSaveError(err instanceof Error ? err.message : 'Failed to save file');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle tab change - exit edit mode if changing tabs
  const handleTabChange = (tabId: TabId) => {
    if (isEditMode) {
      // Ask for confirmation before switching tabs while editing
      if (editContent !== (workspaceFiles?.[activeTab] || '')) {
        if (!window.confirm('You have unsaved changes. Discard them?')) {
          return;
        }
      }
      setIsEditMode(false);
    }
    setActiveTab(tabId);
    setSaveError(null);
    setSaveSuccess(false);
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        width: 400,
        background: 'var(--pixel-bg)',
        borderRight: '2px solid var(--pixel-border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100,
        boxShadow: '4px 0 8px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px',
          borderBottom: '2px solid var(--pixel-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          background: 'var(--pixel-header-bg, rgba(0,0,0,0.2))',
        }}
      >
        <CharacterAvatar character={character} size={64} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 'bold',
              color: 'var(--pixel-text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {name}
          </div>
          <div
            style={{
              fontSize: 14,
              color: character.isActive ? 'var(--pixel-accent)' : 'var(--pixel-text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 4,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: character.isActive ? '#4ade80' : '#6b7280',
              }}
            />
            {status}
          </div>
          {character.agentId && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--pixel-text-dim)',
                marginTop: 4,
              }}
            >
              ID: {character.agentId}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--pixel-btn-bg)',
            border: '2px solid var(--pixel-border)',
            color: 'var(--pixel-text)',
            cursor: 'pointer',
            fontSize: 20,
            borderRadius: 4,
          }}
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Tabs - Icon only by default, show label when active */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          padding: '8px 12px',
          borderBottom: '2px solid var(--pixel-border)',
          background: 'rgba(0,0,0,0.1)',
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              disabled={isEditMode && isActive}
              title={tab.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: isActive ? 6 : 0,
                padding: isActive ? '6px 12px' : '8px',
                fontSize: 14,
                background: isActive ? 'var(--pixel-accent)' : 'var(--pixel-btn-bg)',
                color: isActive ? '#fff' : 'var(--pixel-text)',
                border: '2px solid var(--pixel-border)',
                borderRadius: 4,
                cursor: isEditMode && isActive ? 'default' : 'pointer',
                whiteSpace: 'nowrap',
                boxShadow: isActive ? '2px 2px 0 rgba(0,0,0,0.3)' : 'none',
                transform: isActive ? 'translate(-1px, -1px)' : 'none',
                transition: 'all 0.2s ease',
                opacity: isEditMode && isActive ? 0.8 : 1,
              }}
            >
              <tab.Icon size={18} />
              {isActive && <span>{tab.label}</span>}
            </button>
          );
        })}
      </div>

      {/* Action Bar - Edit/Save buttons */}
      {workspaceFiles && !isLoading && !error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '2px solid var(--pixel-border)',
            background: 'rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ fontSize: 14, color: 'var(--pixel-text-dim)' }}>
            {isEditMode ? 'Editing...' : activeTab}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!isEditMode ? (
              <button
                onClick={handleEdit}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  fontSize: 14,
                  background: 'var(--pixel-btn-bg)',
                  color: 'var(--pixel-text)',
                  border: '2px solid var(--pixel-border)',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
                title="Edit file"
              >
                <Edit3 size={16} />
                Edit
              </button>
            ) : (
              <>
                <button
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    fontSize: 14,
                    background: 'var(--pixel-btn-bg)',
                    color: 'var(--pixel-text)',
                    border: '2px solid var(--pixel-border)',
                    borderRadius: 4,
                    cursor: isSaving ? 'wait' : 'pointer',
                    opacity: isSaving ? 0.6 : 1,
                  }}
                  title="Cancel editing"
                >
                  <X size={16} />
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    fontSize: 14,
                    background: 'var(--pixel-accent)',
                    color: '#fff',
                    border: '2px solid var(--pixel-accent)',
                    borderRadius: 4,
                    cursor: isSaving ? 'wait' : 'pointer',
                    opacity: isSaving ? 0.8 : 1,
                  }}
                  title="Save file to server"
                >
                  <Save size={16} />
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Save Status Messages */}
      {(saveError || saveSuccess) && (
        <div
          style={{
            padding: '8px 12px',
            background: saveSuccess ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
            borderBottom: '2px solid var(--pixel-border)',
            color: saveSuccess ? '#22c55e' : '#ef4444',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {saveSuccess ? '✓ File saved successfully!' : `✕ ${saveError}`}
        </div>
      )}

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflow: isEditMode ? 'hidden' : 'auto',
          padding: isEditMode ? 0 : 16,
        }}
      >
        {!server ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--pixel-text-dim)',
              textAlign: 'center',
              gap: 8,
              padding: 20,
            }}
          >
            <span style={{ fontSize: 48 }}>🔌</span>
            <div style={{ fontSize: 16 }}>No server connected</div>
            <div style={{ fontSize: 14 }}>Purchase an office to view agent details</div>
          </div>
        ) : isLoading ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--pixel-text-dim)',
            }}
          >
            <span className="pixel-agents-pulse">Loading workspace...</span>
          </div>
        ) : error ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fca5a5',
              textAlign: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 48 }}>⚠️</span>
            <div style={{ fontSize: 16 }}>Failed to load</div>
            <div style={{ fontSize: 14, maxWidth: 280 }}>{error}</div>
          </div>
        ) : workspaceFiles ? (
          isEditMode ? (
            // Edit mode - show textarea
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              disabled={isSaving}
              style={{
                width: '100%',
                height: '100%',
                padding: 16,
                fontSize: 16,
                fontFamily: 'monospace',
                lineHeight: 1.5,
                background: 'var(--pixel-bg)',
                color: 'var(--pixel-text)',
                border: 'none',
                outline: 'none',
                resize: 'none',
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
                overflowX: 'hidden',
                overflowY: 'auto',
                boxSizing: 'border-box',
              }}
              placeholder={`Enter content for ${activeTab}...`}
              spellCheck={false}
            />
          ) : (
            // View mode - show markdown
            <MarkdownContent content={workspaceFiles[activeTab]} />
          )
        ) : null}
      </div>
    </div>
  );
}
