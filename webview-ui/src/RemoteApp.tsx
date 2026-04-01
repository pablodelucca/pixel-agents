/**
 * Remote monitoring App entry point
 *
 * Uses WebSocket connection instead of VS Code extension messages
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BottomToolbar } from './components/BottomToolbar.js';
import { DebugView } from './components/DebugView.js';
import { ZoomControls } from './components/ZoomControls.js';
import { PULSE_ANIMATION_DURATION_SEC } from './constants.js';
import { useEditorActions } from './hooks/useEditorActions.js';
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js';
import { useRemoteMessages } from './hooks/useRemoteMessages.js';
import { OfficeCanvas } from './office/components/OfficeCanvas.js';
import { ToolOverlay } from './office/components/ToolOverlay.js';
import { EditorState } from './office/editor/editorState.js';
import { EditorToolbar } from './office/editor/EditorToolbar.js';
import { OfficeState } from './office/engine/officeState.js';
import { isRotatable } from './office/layout/furnitureCatalog.js';
import { EditTool } from './office/types.js';
import {
  createRoom,
  findRoomForProject,
  loadRooms,
  loadRoomLayout,
  saveRooms,
  saveRoomLayout,
} from './roomManager.js';
import { getNumericId, getSessionId } from './sessionMapping.js';
import type { Room, RoomState } from './roomManager.js';
import type { ToolActivity } from './office/types.js';
import type { OfficeLayout } from './office/types.js';

// Game state lives outside React
const officeStateRef = { current: null as OfficeState | null };
const editorState = new EditorState();

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState();
  }
  return officeStateRef.current;
}

const actionBarBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '22px',
  background: 'var(--pixel-btn-bg)',
  color: 'var(--pixel-text-dim)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
};

function EditActionBar({
  editor,
  editorState: es,
}: {
  editor: ReturnType<typeof useEditorActions>;
  editorState: EditorState;
}) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const undoDisabled = es.undoStack.length === 0;
  const redoDisabled = es.redoStack.length === 0;

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 'var(--pixel-controls-z)',
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        padding: '4px 8px',
        boxShadow: 'var(--pixel-shadow)',
      }}
    >
      <button
        style={undoDisabled ? { ...actionBarBtnStyle, opacity: 0.5, cursor: 'default' } : actionBarBtnStyle}
        onClick={undoDisabled ? undefined : editor.handleUndo}
      >
        Undo
      </button>
      <button
        style={redoDisabled ? { ...actionBarBtnStyle, opacity: 0.5, cursor: 'default' } : actionBarBtnStyle}
        onClick={redoDisabled ? undefined : editor.handleRedo}
      >
        Redo
      </button>
      <button style={actionBarBtnStyle} onClick={editor.handleSave}>
        Save
      </button>
      {!showResetConfirm ? (
        <button style={actionBarBtnStyle} onClick={() => setShowResetConfirm(true)}>
          Reset
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: '22px', color: 'var(--pixel-reset-text)' }}>Reset?</span>
          <button
            style={{ ...actionBarBtnStyle, background: 'var(--pixel-danger-bg)', color: '#fff' }}
            onClick={() => {
              setShowResetConfirm(false);
              editor.handleReset();
            }}
          >
            Yes
          </button>
          <button style={actionBarBtnStyle} onClick={() => setShowResetConfirm(false)}>
            No
          </button>
        </div>
      )}
    </div>
  );
}

function ConnectionIndicator({ connected, onClick }: { connected: boolean; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        boxShadow: 'var(--pixel-shadow)',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: connected ? '#4ade80' : '#ef4444',
        }}
      />
      <span style={{ fontSize: '20px', color: 'var(--pixel-text)' }}>
        {connected ? 'Connected' : 'Disconnected'}
      </span>
      <span style={{ fontSize: '18px', color: 'var(--pixel-text-dim)', marginLeft: 4 }}>▼</span>
    </div>
  );
}

interface ProjectGroup {
  cwd: string;
  sessions: {
    sessionId: string;
    cwd: string;
    status: string;
    activeTools: string[];
  }[];
  roomId?: string;
  roomName?: string;
}

function AgentPanel({
  agents,
  agentStatuses,
  agentTools,
  agentCwds,
  roomState,
  onEnterRoom,
  onCreateRoom,
  onClose,
}: {
  agents: string[];
  agentStatuses: Record<string, string>;
  agentTools: Record<string, ToolActivity[]>;
  agentCwds: Record<string, string>;
  roomState: RoomState;
  onEnterRoom: (roomId: string) => void;
  onCreateRoom: (cwd: string, sessionIds: string[]) => void;
  onClose: () => void;
}) {
  // Group agents by project (cwd), normalizing case
  const projectGroups = new Map<string, ProjectGroup>();

  for (const sessionId of agents) {
    const rawCwd = agentCwds[sessionId] || sessionId.slice(0, 8);
    const cwd = rawCwd.toLowerCase();

    const status = agentStatuses[sessionId] || 'idle';
    const tools = agentTools[sessionId] || [];
    const isActive = tools.length > 0 || status === 'active';

    if (!projectGroups.has(cwd)) {
      // Check if this project has a room
      const room = findRoomForProject(roomState, cwd);
      projectGroups.set(cwd, {
        cwd: rawCwd,
        sessions: [],
        roomId: room?.id,
        roomName: room?.name,
      });
    }

    projectGroups.get(cwd)!.sessions.push({
      sessionId,
      cwd: rawCwd,
      status: isActive ? 'active' : 'idle',
      activeTools: tools.map(t => t.status),
    });
  }

  // Sort groups: with room first, then active, then by name
  const sortedGroups = Array.from(projectGroups.values()).sort((a, b) => {
    // Rooms first
    if (a.roomId && !b.roomId) return -1;
    if (!a.roomId && b.roomId) return 1;
    // Then active
    const aActive = a.sessions.some(s => s.status === 'active');
    const bActive = b.sessions.some(s => s.status === 'active');
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return a.cwd.localeCompare(b.cwd);
  });

  return (
    <div
      style={{
        position: 'absolute',
        top: 40,
        right: 8,
        zIndex: 60,
        width: 360,
        maxHeight: 'calc(100% - 60px)',
        overflowY: 'auto',
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        boxShadow: 'var(--pixel-shadow)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '2px solid var(--pixel-border)',
          background: 'var(--pixel-accent)',
        }}
      >
        <span style={{ fontSize: '22px', color: '#fff', fontWeight: 'bold' }}>
          Projects ({sortedGroups.length})
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#fff',
            fontSize: '24px',
            cursor: 'pointer',
            padding: '0 4px',
          }}
        >
          ×
        </button>
      </div>
      <div style={{ padding: 4 }}>
        {sortedGroups.map(group => {
          const anyActive = group.sessions.some(s => s.status === 'active');
          const sessionCount = group.sessions.length;
          const hasRoom = !!group.roomId;

          return (
            <div
              key={group.cwd}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                margin: '2px 0',
                background: 'var(--pixel-bg)',
                border: '2px solid',
                borderColor: hasRoom ? 'var(--pixel-accent)' : anyActive ? '#4ade80' : 'var(--pixel-border)',
                borderRadius: 0,
              }}
            >
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: anyActive ? '#4ade80' : '#6b7280',
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '18px', color: 'var(--pixel-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {group.cwd}
                  {hasRoom && <span style={{ color: 'var(--pixel-accent)', marginLeft: 4 }}>🏠</span>}
                </div>
                <div style={{ fontSize: '16px', color: 'var(--pixel-text-dim)' }}>
                  {sessionCount} session{sessionCount > 1 ? 's' : ''}
                  {anyActive && ' · active'}
                </div>
              </div>
              {hasRoom ? (
                <button
                  onClick={() => onEnterRoom(group.roomId!)}
                  style={{
                    padding: '4px 8px',
                    fontSize: '16px',
                    background: 'var(--pixel-accent)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 0,
                    cursor: 'pointer',
                  }}
                >
                  Enter
                </button>
              ) : (
                <button
                  onClick={() => {
                    console.log('[AgentPanel] + Room clicked for:', group.cwd, 'sessions:', group.sessions.map(s => s.sessionId));
                    onCreateRoom(group.cwd, group.sessions.map(s => s.sessionId));
                  }}
                  style={{
                    padding: '4px 8px',
                    fontSize: '16px',
                    background: 'var(--pixel-btn-bg)',
                    color: 'var(--pixel-text)',
                    border: '2px solid var(--pixel-border)',
                    borderRadius: 0,
                    cursor: 'pointer',
                  }}
                >
                  + Room
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Room tabs component
function RoomTabs({
  rooms,
  activeRoomId,
  onSelectRoom,
  onCloseRoom: _onCloseRoom,
  agentStatuses,
  agentCwds,
  agentTools,
  unassignedAgents,
  onHoverAgent,
}: {
  rooms: Room[];
  activeRoomId: string | null;
  onSelectRoom: (roomId: string) => void;
  onCloseRoom?: (roomId: string) => void;
  agentStatuses: Record<string, string>;
  agentCwds: Record<string, string>;
  agentTools: Record<string, ToolActivity[]>;
  unassignedAgents: string[];
  onHoverAgent: (sessionId: string | null) => void;
}) {
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);
  const [expandedRect, setExpandedRect] = useState<DOMRect | null>(null);
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Get agents for a room (default room uses unassignedAgents)
  const getAgentsForRoom = (room: Room): string[] => {
    if (room.id === 'default') {
      return unassignedAgents;
    }
    return room.agentIds;
  };

  const handleExpand = (roomId: string) => {
    const tabEl = tabRefs.current.get(roomId);
    if (tabEl && expandedRoom !== roomId) {
      setExpandedRect(tabEl.getBoundingClientRect());
      setExpandedRoom(roomId);
    } else {
      setExpandedRoom(null);
      setExpandedRect(null);
    }
  };

  return (
    <>
      <div
        className="room-tabs-container"
        style={{
          position: 'absolute',
          top: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 50,
          display: 'flex',
          gap: 2,
          alignItems: 'flex-start',
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '2px 4px',
          boxShadow: 'var(--pixel-shadow)',
          maxWidth: 'calc(100% - 200px)',
          overflowX: 'auto',
          overflowY: 'visible',
        }}
      >
        {rooms.map(room => {
          const isExpanded = expandedRoom === room.id;
          const isActive = room.id === activeRoomId;
          const roomAgents = getAgentsForRoom(room);

          return (
            <div
              key={room.id}
              ref={el => { if (el) tabRefs.current.set(room.id, el); }}
              style={{ position: 'relative', flexShrink: 0 }}
            >
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectRoom(room.id);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  background: isActive ? 'var(--pixel-accent)' : 'var(--pixel-btn-bg)',
                  color: isActive ? '#fff' : 'var(--pixel-text)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  fontSize: '18px',
                  border: '2px solid transparent',
                }}
              >
                <span>{room.name}</span>
                {roomAgents.length > 0 && (
                  <span style={{ fontSize: '14px', opacity: 0.7 }}>({roomAgents.length})</span>
                )}
                {roomAgents.length > 0 && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExpand(room.id);
                    }}
                    style={{
                      fontSize: '12px',
                      padding: '0 4px',
                      cursor: 'pointer',
                    }}
                  >
                    {isExpanded ? '▼' : '▶'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Expanded agent list - rendered outside scroll container */}
      {expandedRoom && expandedRect && (() => {
        const room = rooms.find(r => r.id === expandedRoom);
        if (!room) return null;
        const roomAgents = getAgentsForRoom(room);

        return (
          <div
            style={{
              position: 'fixed',
              top: expandedRect.bottom + 2,
              left: expandedRect.left,
              background: 'var(--pixel-bg)',
              border: '2px solid var(--pixel-border)',
              borderRadius: 0,
              minWidth: 220,
              maxHeight: 300,
              overflowY: 'auto',
              boxShadow: 'var(--pixel-shadow)',
              zIndex: 1000,
            }}
          >
            {roomAgents.map(sessionId => {
              const status = agentStatuses[sessionId] || 'idle';
              const tools = agentTools[sessionId] || [];
              const isActiveAgent = status === 'active' || tools.length > 0;
              const displayName = agentCwds[sessionId] || sessionId.slice(0, 8);
              const toolName = tools.length > 0 ? tools[0].status : null;

              return (
                <div
                  key={sessionId}
                  className="room-agent-item"
                  onMouseEnter={() => onHoverAgent(sessionId)}
                  onMouseLeave={() => onHoverAgent(null)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    border: '2px solid transparent',
                    borderBottom: '1px solid var(--pixel-border)',
                    fontSize: '16px',
                    color: 'var(--pixel-text)',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: isActiveAgent ? '#4ade80' : '#6b7280',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}>
                    {displayName}
                  </span>
                  {toolName && (
                    <span style={{ fontSize: '12px', color: '#4ade80', marginLeft: 'auto' }}>
                      {toolName}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}
    </>
  );
}

function RemoteApp() {
  const editor = useEditorActions(getOfficeState, editorState);

  const isEditDirty = useCallback(
    () => editor.isEditMode && editor.isDirty,
    [editor.isEditMode, editor.isDirty],
  );

  // Room state management
  const [roomState, setRoomState] = useState<RoomState>(() => loadRooms());

  // Remote messages hook - must be called before visibleAgents useMemo
  const {
    agents: allAgents,
    selectedAgent,
    setSelectedAgent,
    agentTools,
    agentStatuses,
    agentCwds,
    subagentTools,
    subagentCharacters,
    layoutReady,
    layoutWasReset: _layoutWasReset,
    loadedAssets,
    workspaceFolders: _workspaceFolders,
    externalAssetDirectories: _externalAssetDirectories,
    lastSeenVersion: _lastSeenVersion,
    extensionVersion: _extensionVersion,
    watchAllSessions: _watchAllSessions,
    setWatchAllSessions: _setWatchAllSessions,
    alwaysShowLabels,
    connected,
  } = useRemoteMessages(
    getOfficeState,
    editor.setLastSavedLayout,
    isEditDirty,
    () => new Set(), // No hidden agents anymore, use rooms instead
  );

  // Get current room
  const currentRoom = useMemo(() => {
    return roomState.rooms.find(r => r.id === roomState.activeRoomId) || roomState.rooms[0];
  }, [roomState]);

  // Agents not assigned to any room (for default room display)
  const unassignedAgents = useMemo(() => {
    const assignedAgents = new Set(roomState.rooms.flatMap(r => r.agentIds));
    return allAgents.filter(id => !assignedAgents.has(id));
  }, [allAgents, roomState.rooms]);

  // Filter agents by current room
  const visibleAgents = useMemo(() => {
    if (!currentRoom) return allAgents;
    // If default room, show agents not assigned to any room
    if (currentRoom.id === 'default') {
      return unassignedAgents;
    }
    return allAgents.filter(id => currentRoom.agentIds.includes(id));
  }, [allAgents, currentRoom, roomState.rooms, unassignedAgents]);

  const [isDebugMode, setIsDebugMode] = useState(false);
  const [alwaysShowOverlay, setAlwaysShowOverlay] = useState(false);
  const [showAgentPanel, setShowAgentPanel] = useState(false);

  // Handle hover on agent from room list
  const handleHoverAgent = useCallback((sessionId: string | null) => {
    const os = getOfficeState();
    if (sessionId) {
      const numericId = getNumericId(sessionId);
      os.hoveredAgentId = numericId;
    } else {
      os.hoveredAgentId = null;
    }
  }, []);

  // Sync agents with office state based on current room
  useEffect(() => {
    const os = getOfficeState();
    // Get current agents in officeState (characters is a Map)
    const currentAgents = new Set<string>();
    for (const ch of os.characters.values()) {
      // Find session ID from numeric ID
      const sessionId = getSessionId(ch.id);
      if (sessionId) currentAgents.add(sessionId);
    }

    // Remove agents that should no longer be visible
    for (const sessionId of currentAgents) {
      if (!visibleAgents.includes(sessionId)) {
        const numericId = getNumericId(sessionId);
        if (numericId) os.removeAgent(numericId);
      }
    }

    // Add agents that should be visible but aren't yet
    for (const sessionId of visibleAgents) {
      if (!currentAgents.has(sessionId)) {
        const numericId = getNumericId(sessionId);
        const folderName = agentCwds[sessionId];
        os.addAgent(numericId, undefined, undefined, undefined, true, folderName);
      }
    }
  }, [visibleAgents, agentCwds]);

  // Load room layout when switching rooms
  useEffect(() => {
    if (!layoutReady || !currentRoom) return;

    const os = getOfficeState();
    const savedLayout = loadRoomLayout(currentRoom.id);

    if (savedLayout) {
      console.log('[Room] Loading layout for room:', currentRoom.id);
      os.rebuildFromLayout(savedLayout as OfficeLayout);
    } else {
      // No saved layout, use default layout from assets
      console.log('[Room] No saved layout for room:', currentRoom.id, 'using default');
      // Keep current layout (already loaded from default-layout.json)
    }
  }, [currentRoom?.id, layoutReady]);

  // Room management handlers
  const handleSelectRoom = useCallback((roomId: string) => {
    console.log('[handleSelectRoom] called with roomId:', roomId, 'currentRoom:', currentRoom?.id);
    // Save current room layout before switching
    if (currentRoom && layoutReady) {
      const os = getOfficeState();
      const layout = os.getLayout();
      saveRoomLayout(currentRoom.id, layout);
    }

    setRoomState(prev => {
      const newState = { ...prev, activeRoomId: roomId };
      saveRooms(newState);
      return newState;
    });
  }, [currentRoom, layoutReady]);

  const handleEnterRoom = useCallback((roomId: string) => {
    handleSelectRoom(roomId);
    setShowAgentPanel(false);
  }, [handleSelectRoom]);

  const handleCreateRoom = useCallback((cwd: string, sessionIds: string[]) => {
    // Save current layout first
    if (currentRoom && layoutReady) {
      const os = getOfficeState();
      const layout = os.getLayout();
      saveRoomLayout(currentRoom.id, layout);
    }

    setRoomState(prev => {
      const room = createRoom(cwd.split(/[/\\]/).pop() || cwd, cwd);
      room.agentIds = sessionIds;
      const newState = {
        ...prev,
        rooms: [...prev.rooms, room],
        activeRoomId: room.id,
      };
      saveRooms(newState);

      // Copy current layout to new room
      const os = getOfficeState();
      const layout = os.getLayout();
      saveRoomLayout(room.id, layout);

      return newState;
    });
    setShowAgentPanel(false);
  }, [currentRoom, layoutReady]);

  useEffect(() => {
    setAlwaysShowOverlay(alwaysShowLabels);
  }, [alwaysShowLabels]);

  const handleToggleDebugMode = useCallback(() => setIsDebugMode(prev => !prev), []);
  const handleToggleAlwaysShowOverlay = useCallback(() => {
    setAlwaysShowOverlay(prev => !prev);
  }, []);

  const handleClick = useCallback((agentId: number) => {
    // In remote mode, clicking just selects the agent (no terminal focus)
    // Convert numeric ID back to session ID for selection
    const sessionId = getSessionId(agentId);
    if (sessionId) {
      setSelectedAgent(sessionId);
    }
    console.log('[Remote] Clicked agent:', agentId, sessionId);
  }, [setSelectedAgent]);

  const handleCloseAgent = useCallback((id: number) => {
    // In remote mode, we can't close agents (they're on the server)
    console.log('[Remote] Cannot close remote agent:', id);
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);

  const [editorTickForKeyboard, setEditorTickForKeyboard] = useState(0);
  useEditorKeyboard(
    editor.isEditMode,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    useCallback(() => setEditorTickForKeyboard(n => n + 1), []),
    editor.handleToggleEditMode,
  );

  const officeState = getOfficeState();
  void editorTickForKeyboard;

  const showRotateHint =
    editor.isEditMode &&
    (() => {
      if (editorState.selectedFurnitureUid) {
        const item = officeState.getLayout().furniture.find(f => f.uid === editorState.selectedFurnitureUid);
        if (item && isRotatable(item.type)) return true;
      }
      if (editorState.activeTool === EditTool.FURNITURE_PLACE && isRotatable(editorState.selectedFurnitureType)) {
        return true;
      }
      return false;
    })();

  if (!layoutReady) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--pixel-text)',
        }}
      >
        Loading...
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        @keyframes pixel-agents-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .pixel-agents-pulse { animation: pixel-agents-pulse ${PULSE_ANIMATION_DURATION_SEC}s ease-in-out infinite; }
        .room-agent-item {
          transition: all 0.1s ease;
          border: 2px solid transparent !important;
        }
        .room-agent-item:hover {
          border-color: var(--pixel-accent) !important;
          background: rgba(74, 222, 128, 0.1) !important;
        }
        .room-tabs-container::-webkit-scrollbar {
          height: 6px;
        }
        .room-tabs-container::-webkit-scrollbar-track {
          background: var(--pixel-bg);
        }
        .room-tabs-container::-webkit-scrollbar-thumb {
          background: var(--pixel-border);
          border-radius: 0;
        }
        .room-tabs-container::-webkit-scrollbar-thumb:hover {
          background: var(--pixel-accent);
        }
      `}</style>

      <OfficeCanvas
        officeState={officeState}
        onClick={handleClick}
        isEditMode={editor.isEditMode}
        editorState={editorState}
        onEditorTileAction={editor.handleEditorTileAction}
        onEditorEraseAction={editor.handleEditorEraseAction}
        onEditorSelectionChange={editor.handleEditorSelectionChange}
        onDeleteSelected={editor.handleDeleteSelected}
        onRotateSelected={editor.handleRotateSelected}
        onDragMove={editor.handleDragMove}
        editorTick={editor.editorTick}
        zoom={editor.zoom}
        onZoomChange={editor.handleZoomChange}
        panRef={editor.panRef}
      />

      {!isDebugMode && <ZoomControls zoom={editor.zoom} onZoomChange={editor.handleZoomChange} />}

      {/* Room tabs */}
      <RoomTabs
        rooms={roomState.rooms}
        activeRoomId={roomState.activeRoomId}
        onSelectRoom={handleSelectRoom}
        agentStatuses={agentStatuses}
        agentCwds={agentCwds}
        agentTools={agentTools}
        unassignedAgents={unassignedAgents}
        onHoverAgent={handleHoverAgent}
      />

      {/* Connection indicator */}
      <ConnectionIndicator connected={connected} onClick={() => setShowAgentPanel(prev => !prev)} />

      {/* Agent panel */}
      {showAgentPanel && (
        <AgentPanel
          agents={allAgents}
          agentStatuses={agentStatuses}
          agentTools={agentTools}
          agentCwds={agentCwds}
          roomState={roomState}
          onEnterRoom={handleEnterRoom}
          onCreateRoom={handleCreateRoom}
          onClose={() => setShowAgentPanel(false)}
        />
      )}

      {/* Vignette overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--pixel-vignette)',
          pointerEvents: 'none',
          zIndex: 40,
        }}
      />

      <BottomToolbar
        isEditMode={editor.isEditMode}
        onToggleEditMode={editor.handleToggleEditMode}
        isDebugMode={isDebugMode}
        onToggleDebugMode={handleToggleDebugMode}
        alwaysShowOverlay={alwaysShowOverlay}
        onToggleAlwaysShowOverlay={handleToggleAlwaysShowOverlay}
      />

      {editor.isEditMode && editor.isDirty && <EditActionBar editor={editor} editorState={editorState} />}

      {showRotateHint && (
        <div
          style={{
            position: 'absolute',
            top: editor.isDirty ? 52 : 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 49,
            background: 'var(--pixel-hint-bg)',
            color: '#fff',
            fontSize: '20px',
            padding: '3px 8px',
            borderRadius: 0,
            border: '2px solid var(--pixel-accent)',
            boxShadow: 'var(--pixel-shadow)',
            pointerEvents: 'none',
          }}
        >
          Rotate (R)
        </div>
      )}

      {editor.isEditMode &&
        (() => {
          const selUid = editorState.selectedFurnitureUid;
          const selColor = selUid
            ? officeState.getLayout().furniture.find(f => f.uid === selUid)?.color ?? null
            : null;
          return (
            <EditorToolbar
              activeTool={editorState.activeTool}
              selectedTileType={editorState.selectedTileType}
              selectedFurnitureType={editorState.selectedFurnitureType}
              selectedFurnitureUid={selUid}
              selectedFurnitureColor={selColor}
              floorColor={editorState.floorColor}
              wallColor={editorState.wallColor}
              selectedWallSet={editorState.selectedWallSet}
              onToolChange={editor.handleToolChange}
              onTileTypeChange={editor.handleTileTypeChange}
              onFloorColorChange={editor.handleFloorColorChange}
              onWallColorChange={editor.handleWallColorChange}
              onWallSetChange={editor.handleWallSetChange}
              onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
              onFurnitureTypeChange={editor.handleFurnitureTypeChange}
              loadedAssets={loadedAssets}
            />
          );
        })()}

      {!isDebugMode && (
        <ToolOverlay
          officeState={officeState}
          agents={visibleAgents.map(getNumericId)}
          agentTools={Object.fromEntries(Object.entries(agentTools).map(([sessionId, v]) => [getNumericId(sessionId), v]))}
          subagentCharacters={subagentCharacters}
          containerRef={containerRef}
          zoom={editor.zoom}
          panRef={editor.panRef}
          onCloseAgent={handleCloseAgent}
          alwaysShowOverlay={alwaysShowOverlay}
        />
      )}

      {isDebugMode && (
        <DebugView
          agents={visibleAgents.map(getNumericId)}
          selectedAgent={selectedAgent ? getNumericId(selectedAgent) : null}
          agentTools={Object.fromEntries(Object.entries(agentTools).map(([sessionId, v]) => [getNumericId(sessionId), v]))}
          agentStatuses={Object.fromEntries(Object.entries(agentStatuses).map(([sessionId, v]) => [getNumericId(sessionId), v]))}
          subagentTools={Object.fromEntries(Object.entries(subagentTools).map(([sessionId, v]) => [getNumericId(sessionId), v]))}
          onSelectAgent={id => {
            const sessionId = getSessionId(id);
            if (sessionId) setSelectedAgent(sessionId);
          }}
        />
      )}
    </div>
  );
}

export default RemoteApp;