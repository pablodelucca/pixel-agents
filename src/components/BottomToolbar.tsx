import { useEffect, useRef, useState } from 'react';

import type { Server } from '../types/database.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { useServers } from '../hooks/useServers.js';
import { useServerState } from '../hooks/useServerState.js';
import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import { ServerPasswordModal } from './ServerPasswordModal.js';
import { ServersModal } from './ServersModal.js';
import { SettingsModal } from './SettingsModal.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  onOpenClaude: () => void;
  onToggleEditMode: () => void;
  isDebugMode: boolean;
  onToggleDebugMode: () => void;
  workspaceFolders: WorkspaceFolder[];
  getOfficeState: () => OfficeState;
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

export function BottomToolbar({
  isEditMode: _isEditMode,
  onOpenClaude: _onOpenClaude,
  onToggleEditMode: _onToggleEditMode,
  isDebugMode,
  onToggleDebugMode,
  workspaceFolders: _workspaceFolders,
  getOfficeState,
}: BottomToolbarProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isServersDropdownOpen, setIsServersDropdownOpen] = useState(false);
  const [isCreateServerOpen, setIsCreateServerOpen] = useState(false);
  const [hoveredServer, setHoveredServer] = useState<string | null>(null);
  const serversDropdownRef = useRef<HTMLDivElement>(null);

  // Password modal state
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [selectedServerForPassword, setSelectedServerForPassword] = useState<Server | null>(null);

  // Fetch servers from Supabase
  const { servers, loading: serversLoading, refetch: refetchServers } = useServers();

  // Server state context
  const { activeServer, setActiveServer, fetchServerConfig, syncAgentsToOffice, isLoading: isConfigLoading } = useServerState();

  // Close servers dropdown on outside click
  useEffect(() => {
    if (!isServersDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (serversDropdownRef.current && !serversDropdownRef.current.contains(e.target as Node)) {
        setIsServersDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isServersDropdownOpen]);

  const handleSelectServer = async (server: Server) => {
    console.log('Selected server:', server.name, server.id);

    // Set active server
    setActiveServer(server);

    // Fetch OpenClaw config from the server via backend
    const config = await fetchServerConfig(server.id);

    if (config) {
      console.log('Loaded agents:', config.agents);

      // Sync agents to office (pass server directly to avoid async state issue)
      const officeState = getOfficeState();
      syncAgentsToOffice(officeState, config.agents, server);
    }

    setIsServersDropdownOpen(false);
  };

  const handleOpenPasswordModal = (e: React.MouseEvent, server: Server) => {
    e.stopPropagation(); // Prevent selecting the server
    setSelectedServerForPassword(server);
    setIsPasswordModalOpen(true);
  };

  const handlePasswordSaved = () => {
    // Refetch servers to update the password status
    refetchServers();
  };

  const handleCreateServerClick = () => {
    setIsServersDropdownOpen(false);
    setIsCreateServerOpen(true);
  };

  return (
    <div style={panelStyle}>
      {/* Servers dropdown */}
      <div ref={serversDropdownRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setIsServersDropdownOpen((v) => !v)}
          onMouseEnter={() => setHovered('servers')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...btnBase,
            padding: '5px 12px',
            background:
              hovered === 'servers' || isServersDropdownOpen
                ? 'var(--pixel-agent-hover-bg)'
                : 'var(--pixel-agent-bg)',
            border: '2px solid var(--pixel-agent-border)',
            color: 'var(--pixel-agent-text)',
          }}
        >
          Servers
        </button>
        {isServersDropdownOpen && (
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
            {serversLoading ? (
              <div
                style={{
                  padding: '8px 10px',
                  fontSize: '20px',
                  color: 'var(--pixel-text-dim)',
                }}
              >
                Loading...
              </div>
            ) : servers.length === 0 ? (
              <div
                style={{
                  padding: '8px 10px',
                  fontSize: '20px',
                  color: 'var(--pixel-text-dim)',
                  fontStyle: 'italic',
                }}
              >
                No office yet
              </div>
            ) : (
              servers.map((server: Server) => {
                const isActive = activeServer?.id === server.id;
                const isLoading = isConfigLoading && isActive;
                const hasPassword = !!server.password_encrypted;
                const isHovered = hoveredServer === server.id;

                return (
                  <div
                    key={server.id}
                    onMouseEnter={() => setHoveredServer(server.id)}
                    onMouseLeave={() => setHoveredServer(null)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      background: isActive
                        ? 'var(--pixel-active-bg)'
                        : isHovered
                          ? 'var(--pixel-btn-hover-bg)'
                          : 'transparent',
                      border: isActive ? '2px solid var(--pixel-accent)' : 'none',
                    }}
                  >
                    <button
                      onClick={() => handleSelectServer(server)}
                      disabled={isLoading}
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        textAlign: 'left',
                        padding: '6px 10px',
                        fontSize: '22px',
                        color: isActive ? 'var(--pixel-accent)' : 'var(--pixel-text)',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 0,
                        cursor: isLoading ? 'wait' : 'pointer',
                        whiteSpace: 'nowrap',
                        opacity: isLoading ? 0.7 : 1,
                      }}
                    >
                      <span>
                        {isActive ? '▶ ' : ''}
                        {server.name}
                        {isLoading && ' ...'}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {/* Password indicator */}
                        <span
                          title={hasPassword ? 'Password set' : 'No password'}
                          style={{
                            fontSize: '14px',
                            opacity: hasPassword ? 1 : 0.3,
                          }}
                        >
                          🔐
                        </span>
                        {/* Status indicator */}
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background:
                              server.status === 'online'
                                ? '#4ade80'
                                : server.status === 'pending'
                                  ? '#fbbf24'
                                  : '#ef4444',
                            flexShrink: 0,
                          }}
                        />
                      </span>
                    </button>
                    {/* Password button - always show if hovered */}
                    {isHovered && (
                      <button
                        onClick={(e) => handleOpenPasswordModal(e, server)}
                        title={hasPassword ? 'Change password' : 'Set password'}
                        style={{
                          padding: '4px 8px',
                          marginRight: 6,
                          fontSize: '18px',
                          background: hasPassword
                            ? 'rgba(90, 140, 255, 0.3)'
                            : 'rgba(255, 170, 0, 0.3)',
                          border: '1px solid var(--pixel-border)',
                          borderRadius: 0,
                          cursor: 'pointer',
                          color: hasPassword ? '#5a8cff' : '#ffaa00',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {hasPassword ? '🔑' : '⚠️'}
                      </button>
                    )}
                  </div>
                );
              })
            )}
            <div style={{ borderTop: '1px solid var(--pixel-border)' }}>
              <button
                onClick={handleCreateServerClick}
                onMouseEnter={() => setHoveredServer('create')}
                onMouseLeave={() => setHoveredServer(null)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  fontSize: '22px',
                  color: 'var(--pixel-agent-text)',
                  background:
                    hoveredServer === 'create' ? 'rgba(90, 140, 255, 0.3)' : 'rgba(90, 140, 255, 0.2)',
                  border: 'none',
                  borderRadius: 0,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                + Create New Server
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Password Modal */}
      <ServerPasswordModal
        isOpen={isPasswordModalOpen}
        server={selectedServerForPassword}
        onClose={() => {
          setIsPasswordModalOpen(false);
          setSelectedServerForPassword(null);
        }}
        onSuccess={handlePasswordSaved}
      />

      {/* Create Server Dialog */}
      <ServersModal isOpen={isCreateServerOpen} onClose={() => setIsCreateServerOpen(false)} />

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
        />
      </div>
    </div>
  );
}
