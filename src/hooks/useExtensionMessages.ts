import { useEffect, useRef, useState } from 'react';

import { playDoneSound, setSoundEnabled } from '../notificationSound.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { setFloorSprites } from '../office/floorTiles.js';
import { buildDynamicCatalog } from '../office/layout/furnitureCatalog.js';
import { migrateLayoutColors } from '../office/layout/layoutSerializer.js';
import { setCharacterTemplates } from '../office/sprites/spriteData.js';
import { extractToolName } from '../office/toolUtils.js';
import type { OfficeLayout, ToolActivity } from '../office/types.js';
import { setWallSprites } from '../office/wallTiles.js';
import { loadAllAssets } from '../standalone/assetLoader.js';
import {
  fetchAgentsFromGateway,
  subscribeToOpenClawEvents,
} from '../vscodeApi.js';

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
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
}

export interface WorkspaceFolder {
  name: string;
  path: string;
}

export interface ExtensionMessageState {
  agents: number[];
  selectedAgent: number | null;
  agentTools: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, string>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  subagentCharacters: SubagentCharacter[];
  layoutReady: boolean;
  layoutWasReset: boolean;
  loadedAssets?: { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> };
  workspaceFolders: WorkspaceFolder[];
}

export function useExtensionMessages(
  getOfficeState: () => OfficeState,
  onLayoutLoaded?: (layout: OfficeLayout) => void,
  _isEditDirty?: () => boolean,
): ExtensionMessageState {
  const [agents, setAgents] = useState<number[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const [agentTools, setAgentTools] = useState<Record<number, ToolActivity[]>>({});
  const [agentStatuses, setAgentStatuses] = useState<Record<number, string>>({});
  const [subagentTools, setSubagentTools] = useState<
    Record<number, Record<string, ToolActivity[]>>
  >({});
  const [subagentCharacters, setSubagentCharacters] = useState<SubagentCharacter[]>([]);
  const [layoutReady, setLayoutReady] = useState(false);
  const [layoutWasReset] = useState(false);
  const [loadedAssets, setLoadedAssets] = useState<
    { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> } | undefined
  >();
  const [workspaceFolders, setWorkspaceFolders] = useState<WorkspaceFolder[]>([]);

  // Track whether initial layout has been loaded (ref to avoid re-render)
  const layoutReadyRef = useRef(false);

  // Buffer for agents that arrive before layout is loaded
  const pendingAgentsRef = useRef<
    Array<{
      id: number;
      palette?: number;
      hueShift?: number;
      seatId?: string;
      displayName?: string;
    }>
  >([]);

  // ── Standalone Mode - Load assets and listen for backend messages ────────────────────────────────────────
  useEffect(() => {
    const loadStandaloneAssets = async () => {
      try {
        console.log('[Standalone] Loading assets...');
        const assets = await loadAllAssets();

        // Set character sprites
        setCharacterTemplates(assets.characters);

        // Set floor tiles
        setFloorSprites(assets.floors);

        // Set wall tiles
        setWallSprites(assets.walls);

        // Build furniture catalog
        const spriteData: Record<string, string[][]> = {};
        for (const [id, sprite] of Object.entries(assets.furniture.sprites)) {
          spriteData[id] = sprite;
        }
        buildDynamicCatalog({
          catalog: assets.furniture.catalog,
          sprites: spriteData,
        });

        setLoadedAssets({
          catalog: assets.furniture.catalog,
          sprites: spriteData,
        });

        // Load layout
        const os = getOfficeState();
        if (assets.layout) {
          const layout = migrateLayoutColors(assets.layout as OfficeLayout);
          os.rebuildFromLayout(layout);
          onLayoutLoaded?.(layout);
        }

        // Add any pending agents that arrived before layout was ready
        for (const p of pendingAgentsRef.current) {
          os.addAgent(p.id, p.palette, p.hueShift, p.seatId, true, p.displayName);
        }
        pendingAgentsRef.current = [];

        layoutReadyRef.current = true;
        setLayoutReady(true);
        setWorkspaceFolders([{ name: 'OpenClaw', path: '/openclaw' }]);

        // Enable sound by default
        setSoundEnabled(true);

        console.log('[Standalone] Assets loaded, ready for agents');
      } catch (error) {
        console.error('[Standalone] Failed to load assets:', error);
      }
    };

    loadStandaloneAssets();
  }, [getOfficeState, onLayoutLoaded]);

  // ── Fetch initial agents from gateway (Electron mode) or use mock data (web mode) ────────────────────────────────────────
  useEffect(() => {
    if (!layoutReadyRef.current) return;
    
    const doFetch = async () => {
      // Try Electron IPC first
      let agentList = await fetchAgentsFromGateway();
      
      // If no Electron and no agents, use mock data for demo
      if (agentList.length === 0) {
        // Check if we're in web mode (no Electron)
        if (!window.electronAPI) {
          console.log('[Standalone] Web mode - using mock agents for demo');
          agentList = [
            { id: 1, name: 'Main Agent', emoji: '🤖' },
            { id: 2, name: 'Clara', emoji: '🎭' },
          ];
        }
      }
      
      if (agentList.length > 0) {
        console.log('[Standalone] Initial agents:', agentList);
        const os = getOfficeState();
        const ids: number[] = [];
        for (const agent of agentList) {
          const displayName = `${agent.emoji || '🤖'} ${agent.name || String(agent.id)}`;
          os.addAgent(agent.id, undefined, undefined, undefined, true, displayName);
          ids.push(agent.id);
        }
        setAgents(ids);
        if (ids.length > 0) {
          setSelectedAgent(ids[0]);
        }
      } else {
        console.log('[Standalone] No agents from gateway, will wait for events');
      }
    };
    
    doFetch();
  }, [layoutReady, getOfficeState]);

  // ── Subscribe to OpenClaw events via Electron IPC ────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = subscribeToOpenClawEvents((event) => {
      console.log('[Standalone] Received OpenClaw event:', event);
      if (!event || typeof event !== 'object') return;
      const msg = event as Record<string, unknown>;
      const os = getOfficeState();
      
      handleOpenClawMessage(msg, os);
    });
    
    return unsubscribe || undefined;
  }, [getOfficeState]);

  // ── Message handler (shared by IPC and window.message) ────────────────────────────────────────
  const handleOpenClawMessage = (msg: Record<string, unknown>, os: OfficeState) => {
    if (msg.type === 'agentCreated' || msg.type === 'openClawAgentCreated') {
        const id = msg.id as number;
        const name = msg.name as string;
        const emoji = (msg.emoji as string) || '🤖';
        const displayName = `${emoji} ${name}`;
        console.log(`[Webview] Agent created: ${displayName}`);
        setAgents((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setSelectedAgent(id);

        if (layoutReadyRef.current) {
          os.addAgent(id, undefined, undefined, undefined, true, displayName);
        } else {
          pendingAgentsRef.current.push({ id, displayName });
        }
      } else if (msg.type === 'agentClosed') {
        const id = msg.id as number;
        setAgents((prev) => prev.filter((a) => a !== id));
        setSelectedAgent((prev) => (prev === id ? null : prev));
        setAgentTools((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setAgentStatuses((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setSubagentTools((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        os.removeAllSubagents(id);
        setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id));
        os.removeAgent(id);
      } else if (msg.type === 'agentToolStart') {
        const id = msg.id as number;
        const toolId = msg.toolId as string;
        const status = msg.status as string;
        setAgentTools((prev) => {
          const list = prev[id] || [];
          if (list.some((t) => t.toolId === toolId)) return prev;
          return { ...prev, [id]: [...list, { toolId, status, done: false }] };
        });
        const toolName = extractToolName(status);
        os.setAgentTool(id, toolName);
        os.setAgentActive(id, true);
        os.clearPermissionBubble(id);
        if (status.startsWith('Subtask:')) {
          const label = status.slice('Subtask:'.length).trim();
          const subId = os.addSubagent(id, toolId);
          setSubagentCharacters((prev) => {
            if (prev.some((s) => s.id === subId)) return prev;
            return [...prev, { id: subId, parentAgentId: id, parentToolId: toolId, label }];
          });
        }
      } else if (msg.type === 'agentToolDone') {
        const id = msg.id as number;
        const toolId = msg.toolId as string;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          return { ...prev, [id]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)) };
        });
      } else if (msg.type === 'agentToolsClear') {
        const id = msg.id as number;
        setAgentTools((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setSubagentTools((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        os.removeAllSubagents(id);
        setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id));
        os.setAgentTool(id, null);
        os.clearPermissionBubble(id);
      } else if (msg.type === 'agentSelected') {
        const id = msg.id as number;
        setSelectedAgent(id);
      } else if (msg.type === 'agentStatus') {
        const id = msg.id as number;
        const status = msg.status as string;
        setAgentStatuses((prev) => {
          if (status === 'active') {
            const next = { ...prev };
            delete next[id];
            return next;
          }
          return { ...prev, [id]: status };
        });
        os.setAgentActive(id, status === 'active');
        if (status === 'waiting') {
          os.showWaitingBubble(id);
          playDoneSound();
        }
      } else if (msg.type === 'agentToolPermission') {
        const id = msg.id as number;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          return { ...prev, [id]: list.map((t) => (t.done ? t : { ...t, permissionWait: true })) };
        });
        os.showPermissionBubble(id);
      } else if (msg.type === 'subagentToolPermission') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        const subId = os.getSubagentId(id, parentToolId);
        if (subId !== null) {
          os.showPermissionBubble(subId);
        }
      } else if (msg.type === 'agentToolPermissionClear') {
        const id = msg.id as number;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          const hasPermission = list.some((t) => t.permissionWait);
          if (!hasPermission) return prev;
          return { ...prev, [id]: list.map((t) => (t.permissionWait ? { ...t, permissionWait: false } : t)) };
        });
        os.clearPermissionBubble(id);
        for (const [subId, meta] of os.subagentMeta) {
          if (meta.parentAgentId === id) {
            os.clearPermissionBubble(subId);
          }
        }
      } else if (msg.type === 'subagentToolStart') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        const toolId = msg.toolId as string;
        const status = msg.status as string;
        setSubagentTools((prev) => {
          const agentSubs = prev[id] || {};
          const list = agentSubs[parentToolId] || [];
          if (list.some((t) => t.toolId === toolId)) return prev;
          return { ...prev, [id]: { ...agentSubs, [parentToolId]: [...list, { toolId, status, done: false }] } };
        });
        const subId = os.getSubagentId(id, parentToolId);
        if (subId !== null) {
          const subToolName = extractToolName(status);
          os.setAgentTool(subId, subToolName);
          os.setAgentActive(subId, true);
        }
      } else if (msg.type === 'subagentToolDone') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        const toolId = msg.toolId as string;
        setSubagentTools((prev) => {
          const agentSubs = prev[id];
          if (!agentSubs) return prev;
          const list = agentSubs[parentToolId];
          if (!list) return prev;
          return { ...prev, [id]: { ...agentSubs, [parentToolId]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)) } };
        });
      } else if (msg.type === 'subagentClear') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        setSubagentTools((prev) => {
          const agentSubs = prev[id];
          if (!agentSubs || !(parentToolId in agentSubs)) return prev;
          const next = { ...agentSubs };
          delete next[parentToolId];
          if (Object.keys(next).length === 0) {
            const outer = { ...prev };
            delete outer[id];
            return outer;
          }
          return { ...prev, [id]: next };
        });
        os.removeSubagent(id, parentToolId);
        setSubagentCharacters((prev) => prev.filter((s) => !(s.parentAgentId === id && s.parentToolId === parentToolId)));
      } else if (msg.type === 'openClawAgents') {
        // List of all OpenClaw agents (initial sync)
        const agentList = msg.agents as Array<{
          id: number;
          openClawId: string;
          name: string;
          emoji: string;
        }>;
        console.log(`[Webview] OpenClaw agents received:`, agentList);
        const ids = agentList.map((a) => a.id);
        setAgents(ids);
        if (ids.length > 0) {
          setSelectedAgent(ids[0]);
        }
        for (const agent of agentList) {
          const displayName = `${agent.emoji} ${agent.name}`;
          if (layoutReadyRef.current) {
            os.addAgent(agent.id, undefined, undefined, undefined, true, displayName);
          } else {
            pendingAgentsRef.current.push({ id: agent.id, displayName });
          }
        }
      }
  };

  // ── Listen for messages from backend (OpenClaw) - window.message fallback ────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;
      const os = getOfficeState();
      handleOpenClawMessage(msg as Record<string, unknown>, os);
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [getOfficeState]);

  return {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    subagentTools,
    subagentCharacters,
    layoutReady,
    layoutWasReset,
    loadedAssets,
    workspaceFolders,
  };
}
