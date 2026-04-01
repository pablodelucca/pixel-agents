/**
 * WebSocket-based message handler for remote monitoring
 *
 * Replaces useExtensionMessages for browser-only runtime
 */

import { useEffect, useRef, useState } from 'react';

import { playDoneSound } from '../notificationSound.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { setFloorSprites } from '../office/floorTiles.js';
import { buildDynamicCatalog } from '../office/layout/furnitureCatalog.js';
import { migrateLayoutColors } from '../office/layout/layoutSerializer.js';
import { setCharacterTemplates } from '../office/sprites/spriteData.js';
import { deleteSessionMapping, getNumericId } from '../sessionMapping.js';
import { extractToolName } from '../office/toolUtils.js';
import type { OfficeLayout, ToolActivity } from '../office/types.js';
import { setWallSprites } from '../office/wallTiles.js';

export interface SubagentCharacter {
  id: number;
  parentAgentId: number;
  parentToolId: string;
  label: string;
}

export interface FurnitureAsset {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  groupId?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  orientation?: string;
  state?: string;
}

export interface WorkspaceFolder {
  name: string;
  path: string;
}

export interface RemoteMessageState {
  agents: string[];
  selectedAgent: string | null;
  setSelectedAgent: (id: string | null) => void;
  agentTools: Record<string, ToolActivity[]>;
  agentStatuses: Record<string, string>;
  agentCwds: Record<string, string>;
  subagentTools: Record<string, Record<string, ToolActivity[]>>;
  subagentCharacters: SubagentCharacter[];
  layoutReady: boolean;
  layoutWasReset: boolean;
  loadedAssets?: { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> };
  workspaceFolders: WorkspaceFolder[];
  externalAssetDirectories: string[];
  lastSeenVersion: string;
  extensionVersion: string;
  watchAllSessions: boolean;
  setWatchAllSessions: (v: boolean) => void;
  alwaysShowLabels: boolean;
  connected: boolean;
}

// WebSocket URL - can be configured via environment variable or URL parameter
// Auto-detect: use current host if not localhost
function getWebSocketUrl(): string {
  // 1. URL parameter takes priority
  const urlParam = new URLSearchParams(window.location.search).get('ws');
  if (urlParam) return urlParam;

  // 2. Environment variable
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;

  // 3. Auto-detect: if not localhost, use current host with /ws path (for nginx proxy)
  const { hostname, port, protocol } = window.location;
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPort = port ? `:${port}` : '';
    // Use /ws path for nginx proxy, or direct if not behind proxy
    return `${wsProtocol}//${hostname}${wsPort}/ws`;
  }

  // 4. Default for local development
  return 'ws://localhost:3000';
}

const WS_URL = getWebSocketUrl();

export function useRemoteMessages(
  getOfficeState: () => OfficeState,
  onLayoutLoaded?: (layout: OfficeLayout) => void,
  _isEditDirty?: () => boolean,
  _getHiddenAgents?: () => Set<string>,
): RemoteMessageState {
  const [agents, setAgents] = useState<string[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [agentTools, setAgentTools] = useState<Record<string, ToolActivity[]>>({});
  const [agentStatuses, setAgentStatuses] = useState<Record<string, string>>({});
  const [agentCwds, setAgentCwds] = useState<Record<string, string>>({});
  // These are kept for future expansion but not currently used by remote server
  const [_subagentTools, _setSubagentTools] = useState<
    Record<string, Record<string, ToolActivity[]>>
  >({});
  const [_subagentCharacters, _setSubagentCharacters] = useState<SubagentCharacter[]>([]);
  const [layoutReady, setLayoutReady] = useState(false);
  const [_layoutWasReset, _setLayoutWasReset] = useState(false);
  const [loadedAssets, setLoadedAssets] = useState<
    { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> } | undefined
  >();
  const [_workspaceFolders, _setWorkspaceFolders] = useState<WorkspaceFolder[]>([]);
  const [_externalAssetDirectories, _setExternalAssetDirectories] = useState<string[]>([]);
  const [_lastSeenVersion, _setLastSeenVersion] = useState('');
  const [_extensionVersion, _setExtensionVersion] = useState('remote-1.0.0');
  const [watchAllSessions, setWatchAllSessions] = useState(false);
  const [_alwaysShowLabels, _setAlwaysShowLabels] = useState(false);
  const [connected, setConnected] = useState(false);

  const layoutReadyRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    // Load assets first (same as browser mock)
    const loadAssets = async () => {
      const base = import.meta.env.BASE_URL;

      try {
        const [assetIndex, catalog, characters, floors, walls, furniture] = await Promise.all([
          fetch(`${base}assets/asset-index.json`).then(r => r.json()),
          fetch(`${base}assets/furniture-catalog.json`).then(r => r.json()),
          fetch(`${base}assets/decoded/characters.json`).then(r => r.json()),
          fetch(`${base}assets/decoded/floors.json`).then(r => r.json()),
          fetch(`${base}assets/decoded/walls.json`).then(r => r.json()),
          fetch(`${base}assets/decoded/furniture.json`).then(r => r.json()),
        ]);

        setCharacterTemplates(characters);
        setFloorSprites(floors);
        setWallSprites(walls);
        buildDynamicCatalog({ catalog, sprites: furniture });
        setLoadedAssets({ catalog, sprites: furniture });

        // Load layout
        const layout = assetIndex.defaultLayout
          ? await fetch(`${base}assets/${assetIndex.defaultLayout}`).then(r => r.json())
          : null;

        const migratedLayout = layout && layout.version === 1 ? migrateLayoutColors(layout) : null;

        if (migratedLayout) {
          getOfficeState().rebuildFromLayout(migratedLayout);
          onLayoutLoaded?.(migratedLayout);
        } else {
          onLayoutLoaded?.(getOfficeState().getLayout());
        }

        layoutReadyRef.current = true;
        setLayoutReady(true);
      } catch (err) {
        console.error('[Remote] Failed to load assets:', err);
      }
    };

    loadAssets();

    // Connect WebSocket
    const connectWebSocket = () => {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log('[Remote] WebSocket connected');
        setConnected(true);
        wsRef.current = ws;
      };

      ws.onclose = () => {
        console.log('[Remote] WebSocket disconnected');
        setConnected(false);
        wsRef.current = null;

        // Reconnect after 3 seconds
        if (reconnectTimeoutRef.current === null) {
          reconnectTimeoutRef.current = window.setTimeout(() => {
            reconnectTimeoutRef.current = null;
            connectWebSocket();
          }, 3000);
        }
      };

      ws.onerror = (err) => {
        console.error('[Remote] WebSocket error:', err);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleServerMessage(msg);
        } catch (err) {
          console.error('[Remote] Failed to parse message:', err);
        }
      };
    };

    connectWebSocket();

    return () => {
      wsRef.current?.close();
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  const handleServerMessage = (msg: any) => {
    const os = getOfficeState();
    console.log('[Remote] Received:', msg.type, msg);

    if (msg.type === 'existingAgents') {
      const incoming = msg.agents as string[];
      // Only update React state, let RemoteApp sync to officeState
      setAgents(incoming);
    } else if (msg.type === 'agentCreated') {
      const sessionId = msg.id as string;
      const folderName = msg.folderName as string | undefined;
      // Update cwd
      if (folderName) {
        setAgentCwds(prev => ({ ...prev, [sessionId]: folderName }));
      }
      // Only update React state, let RemoteApp sync to officeState
      setAgents(prev => (prev.includes(sessionId) ? prev : [...prev, sessionId]));
      setSelectedAgent(sessionId);
    } else if (msg.type === 'agentClosed') {
      const sessionId = msg.id as string;
      const numericId = getNumericId(sessionId);
      setAgents(prev => prev.filter(a => a !== sessionId));
      setSelectedAgent(prev => (prev === sessionId ? null : prev));
      setAgentTools(prev => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      setAgentStatuses(prev => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      // Remove from officeState (this is fine since agent is closed)
      if (numericId) {
        os.removeAgent(numericId);
        deleteSessionMapping(sessionId);
      }
    } else if (msg.type === 'agentToolStart') {
      const sessionId = msg.id as string;
      const numericId = getNumericId(sessionId);
      const toolId = msg.toolId as string;
      const status = msg.status as string;
      setAgentTools(prev => {
        const list = prev[sessionId] || [];
        if (list.some(t => t.toolId === toolId)) return prev;
        return { ...prev, [sessionId]: [...list, { toolId, status, done: false }] };
      });
      const toolName = extractToolName(status);
      os.setAgentTool(numericId, toolName);
      os.setAgentActive(numericId, true);
      os.clearPermissionBubble(numericId);
    } else if (msg.type === 'agentToolDone') {
      const sessionId = msg.id as string;
      const toolId = msg.toolId as string;
      setAgentTools(prev => {
        const list = prev[sessionId];
        if (!list) return prev;
        return {
          ...prev,
          [sessionId]: list.map(t => (t.toolId === toolId ? { ...t, done: true } : t)),
        };
      });
    } else if (msg.type === 'agentToolsClear') {
      const sessionId = msg.id as string;
      const numericId = getNumericId(sessionId);
      setAgentTools(prev => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      setAgentStatuses(prev => ({ ...prev, [sessionId]: 'idle' }));
      os.setAgentTool(numericId, null);
      os.setAgentActive(numericId, false);
      os.clearPermissionBubble(numericId);
    } else if (msg.type === 'agentStatus') {
      const sessionId = msg.id as string;
      const numericId = getNumericId(sessionId);
      const status = msg.status as string;
      // Always store the status (including 'active')
      setAgentStatuses(prev => ({ ...prev, [sessionId]: status }));
      os.setAgentActive(numericId, status === 'active');
      if (status === 'waiting') {
        os.showWaitingBubble(numericId);
        playDoneSound();
      }
    } else if (msg.type === 'agentToolPermission') {
      const sessionId = msg.id as string;
      const numericId = getNumericId(sessionId);
      os.showPermissionBubble(numericId);
    }
  };

  return {
    agents,
    selectedAgent,
    setSelectedAgent,
    agentTools,
    agentStatuses,
    agentCwds,
    subagentTools: _subagentTools,
    subagentCharacters: _subagentCharacters,
    layoutReady,
    layoutWasReset: _layoutWasReset,
    loadedAssets,
    workspaceFolders: _workspaceFolders,
    externalAssetDirectories: _externalAssetDirectories,
    lastSeenVersion: _lastSeenVersion,
    extensionVersion: _extensionVersion,
    watchAllSessions,
    setWatchAllSessions,
    alwaysShowLabels: _alwaysShowLabels,
    connected,
  };
}