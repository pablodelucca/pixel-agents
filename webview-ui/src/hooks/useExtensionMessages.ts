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
import { vscode } from '../vscodeApi.js';

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
  agentNames: Record<number, string>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  subagentCharacters: SubagentCharacter[];
  layoutReady: boolean;
  layoutWasReset: boolean;
  loadedAssets?: { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> };
  workspaceFolders: WorkspaceFolder[];
}

function saveAgentSeats(os: OfficeState): void {
  const seats: Record<number, { palette: number; hueShift: number; seatId: string | null }> = {};
  for (const ch of os.characters.values()) {
    if (ch.isSubagent) continue;
    seats[ch.id] = { palette: ch.palette, hueShift: ch.hueShift, seatId: ch.seatId };
  }
  vscode.postMessage({ type: 'saveAgentSeats', seats });
}

export function useExtensionMessages(
  getOfficeState: () => OfficeState,
  onLayoutLoaded?: (layout: OfficeLayout) => void,
  isEditDirty?: () => boolean,
): ExtensionMessageState {
  const [agents, setAgents] = useState<number[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const [agentTools, setAgentTools] = useState<Record<number, ToolActivity[]>>({});
  const [agentStatuses, setAgentStatuses] = useState<Record<number, string>>({});
  const [agentNames, setAgentNames] = useState<Record<number, string>>({});
  const [subagentTools, setSubagentTools] = useState<
    Record<number, Record<string, ToolActivity[]>>
  >({});
  const [subagentCharacters, setSubagentCharacters] = useState<SubagentCharacter[]>([]);
  const [layoutReady, setLayoutReady] = useState(false);
  const [layoutWasReset, setLayoutWasReset] = useState(false);
  const [loadedAssets, setLoadedAssets] = useState<
    { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> } | undefined
  >();
  const [workspaceFolders, setWorkspaceFolders] = useState<WorkspaceFolder[]>([]);

  // Track whether initial layout has been loaded (ref to avoid re-render)
  const layoutReadyRef = useRef(false);
  const furnitureAssetsReadyRef = useRef(false);

  useEffect(() => {
    // Buffer agents from existingAgents until layout is loaded
    let pendingAgents: Array<{
      id: number;
      palette?: number;
      hueShift?: number;
      seatId?: string;
      folderName?: string;
    }> = [];
    let pendingOfficeMessages: Array<
      | { type: 'agentToolStart'; id: number; toolId: string; status: string }
      | { type: 'agentToolsClear'; id: number }
      | { type: 'agentStatus'; id: number; status: string }
      | {
          type: 'subagentToolStart';
          id: number;
          parentToolId: string;
          toolId: string;
          status: string;
        }
      | { type: 'subagentClear'; id: number; parentToolId: string }
    > = [];

    const shouldDelayAgentPlacement = (os: OfficeState): boolean =>
      !furnitureAssetsReadyRef.current &&
      os.getLayout().furniture.length > 0 &&
      os.seats.size === 0;

    const flushPendingAgents = (os: OfficeState): void => {
      if (!layoutReadyRef.current || shouldDelayAgentPlacement(os)) return;
      for (const p of pendingAgents) {
        os.addAgent(p.id, p.palette, p.hueShift, p.seatId, true, p.folderName);
      }
      pendingAgents = [];
      if (os.characters.size > 0) {
        saveAgentSeats(os);
      }
    };

    const flushPendingOfficeMessages = (os: OfficeState): void => {
      if (!layoutReadyRef.current || shouldDelayAgentPlacement(os)) return;
      for (const pending of pendingOfficeMessages) {
        switch (pending.type) {
          case 'agentToolStart':
            applyAgentToolStart(os, pending.id, pending.toolId, pending.status);
            break;
          case 'agentToolsClear':
            applyAgentToolsClear(os, pending.id);
            break;
          case 'agentStatus':
            applyAgentStatus(os, pending.id, pending.status);
            break;
          case 'subagentToolStart':
            applySubagentToolStart(os, pending.id, pending.parentToolId, pending.status);
            break;
          case 'subagentClear':
            applySubagentClear(os, pending.id, pending.parentToolId);
            break;
        }
      }
      pendingOfficeMessages = [];
    };

    const applyAgentToolStart = (
      os: OfficeState,
      id: number,
      toolId: string,
      status: string,
    ): void => {
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
    };

    const applyAgentToolsClear = (os: OfficeState, id: number): void => {
      os.removeAllSubagents(id);
      setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id));
      os.setAgentTool(id, null);
      os.clearPermissionBubble(id);
    };

    const applyAgentStatus = (os: OfficeState, id: number, status: string): void => {
      os.setAgentActive(id, status === 'active');
      if (status === 'waiting') {
        os.showWaitingBubble(id);
        playDoneSound();
      }
    };

    const applySubagentToolStart = (
      os: OfficeState,
      id: number,
      parentToolId: string,
      status: string,
    ): void => {
      const subId = os.getSubagentId(id, parentToolId);
      if (subId !== null) {
        const subToolName = extractToolName(status);
        os.setAgentTool(subId, subToolName);
        os.setAgentActive(subId, true);
      }
    };

    const applySubagentClear = (os: OfficeState, id: number, parentToolId: string): void => {
      os.removeSubagent(id, parentToolId);
      setSubagentCharacters((prev) =>
        prev.filter((s) => !(s.parentAgentId === id && s.parentToolId === parentToolId)),
      );
    };

    const handler = (e: MessageEvent) => {
      const msg = e.data;
      const os = getOfficeState();

      if (msg.type === 'layoutLoaded') {
        // Skip external layout updates while editor has unsaved changes
        if (layoutReadyRef.current && isEditDirty?.()) {
          console.log('[Webview] Skipping external layout update — editor has unsaved changes');
          return;
        }
        const rawLayout = msg.layout as OfficeLayout | null;
        const layout = rawLayout && rawLayout.version === 1 ? migrateLayoutColors(rawLayout) : null;
        if (layout) {
          os.rebuildFromLayout(layout);
          onLayoutLoaded?.(layout);
        } else {
          // Default layout — snapshot whatever OfficeState built
          onLayoutLoaded?.(os.getLayout());
        }
        layoutReadyRef.current = true;
        flushPendingAgents(os);
        flushPendingOfficeMessages(os);
        setLayoutReady(true);
        if (msg.wasReset) {
          setLayoutWasReset(true);
        }
      } else if (msg.type === 'agentCreated') {
        const id = msg.id as number;
        const folderName = msg.folderName as string | undefined;
        setAgents((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setSelectedAgent(id);
        if (folderName) {
          setAgentNames((prev) => ({ ...prev, [id]: folderName }));
        }
        if (shouldDelayAgentPlacement(os)) {
          pendingAgents.push({ id, folderName });
        } else {
          os.addAgent(id, undefined, undefined, undefined, undefined, folderName);
          saveAgentSeats(os);
        }
      } else if (msg.type === 'agentClosed') {
        const id = msg.id as number;
        setAgents((prev) => prev.filter((a) => a !== id));
        setSelectedAgent((prev) => (prev === id ? null : prev));
        setAgentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setAgentStatuses((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setAgentNames((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setSubagentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        // Remove all sub-agent characters belonging to this agent
        os.removeAllSubagents(id);
        setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id));
        os.removeAgent(id);
      } else if (msg.type === 'existingAgents') {
        const incoming = msg.agents as number[];
        const meta = (msg.agentMeta || {}) as Record<
          number,
          { palette?: number; hueShift?: number; seatId?: string }
        >;
        const folderNames = (msg.folderNames || {}) as Record<number, string>;
        setAgentNames((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const id of incoming) {
            const folderName = folderNames[id];
            if (folderName && next[id] !== folderName) {
              next[id] = folderName;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
        // Buffer agents — they'll be added in layoutLoaded after seats are built
        for (const id of incoming) {
          const m = meta[id];
          pendingAgents.push({
            id,
            palette: m?.palette,
            hueShift: m?.hueShift,
            seatId: m?.seatId,
            folderName: folderNames[id],
          });
        }
        setAgents((prev) => {
          const ids = new Set(prev);
          const merged = [...prev];
          for (const id of incoming) {
            if (!ids.has(id)) {
              merged.push(id);
            }
          }
          return merged.sort((a, b) => a - b);
        });
      } else if (msg.type === 'agentToolStart') {
        const id = msg.id as number;
        const toolId = msg.toolId as string;
        const status = msg.status as string;
        setAgentTools((prev) => {
          const list = prev[id] || [];
          if (list.some((t) => t.toolId === toolId)) return prev;
          return { ...prev, [id]: [...list, { toolId, status, done: false }] };
        });
        if (!layoutReadyRef.current) {
          pendingOfficeMessages.push({ type: 'agentToolStart', id, toolId, status });
        } else {
          applyAgentToolStart(os, id, toolId, status);
        }
      } else if (msg.type === 'agentToolDone') {
        const id = msg.id as number;
        const toolId = msg.toolId as string;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          return {
            ...prev,
            [id]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
          };
        });
      } else if (msg.type === 'agentToolsClear') {
        const id = msg.id as number;
        setAgentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setSubagentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        if (!layoutReadyRef.current) {
          pendingOfficeMessages.push({ type: 'agentToolsClear', id });
        } else {
          applyAgentToolsClear(os, id);
        }
      } else if (msg.type === 'agentSelected') {
        const id = msg.id as number;
        setSelectedAgent(id);
      } else if (msg.type === 'agentStatus') {
        const id = msg.id as number;
        const status = msg.status as string;
        setAgentStatuses((prev) => {
          if (status === 'active') {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          }
          return { ...prev, [id]: status };
        });
        if (!layoutReadyRef.current) {
          pendingOfficeMessages.push({ type: 'agentStatus', id, status });
        } else {
          applyAgentStatus(os, id, status);
        }
      } else if (msg.type === 'agentToolPermission') {
        const id = msg.id as number;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          return {
            ...prev,
            [id]: list.map((t) => (t.done ? t : { ...t, permissionWait: true })),
          };
        });
        os.showPermissionBubble(id);
      } else if (msg.type === 'subagentToolPermission') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        // Show permission bubble on the sub-agent character
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
          return {
            ...prev,
            [id]: list.map((t) => (t.permissionWait ? { ...t, permissionWait: false } : t)),
          };
        });
        os.clearPermissionBubble(id);
        // Also clear permission bubbles on all sub-agent characters of this parent
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
          return {
            ...prev,
            [id]: { ...agentSubs, [parentToolId]: [...list, { toolId, status, done: false }] },
          };
        });
        if (!layoutReadyRef.current) {
          pendingOfficeMessages.push({
            type: 'subagentToolStart',
            id,
            parentToolId,
            toolId,
            status,
          });
        } else {
          applySubagentToolStart(os, id, parentToolId, status);
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
          return {
            ...prev,
            [id]: {
              ...agentSubs,
              [parentToolId]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
            },
          };
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
        if (!layoutReadyRef.current) {
          pendingOfficeMessages.push({ type: 'subagentClear', id, parentToolId });
        } else {
          applySubagentClear(os, id, parentToolId);
        }
      } else if (msg.type === 'characterSpritesLoaded') {
        const characters = msg.characters as Array<{
          down: string[][][];
          up: string[][][];
          right: string[][][];
        }>;
        console.log(`[Webview] Received ${characters.length} pre-colored character sprites`);
        setCharacterTemplates(characters);
      } else if (msg.type === 'floorTilesLoaded') {
        const sprites = msg.sprites as string[][][];
        console.log(`[Webview] Received ${sprites.length} floor tile patterns`);
        setFloorSprites(sprites);
      } else if (msg.type === 'wallTilesLoaded') {
        const solidSets = msg.solidSets as string[][][][];
        const glassSets = msg.glassSets as string[][][][];
        console.log(
          `[Webview] Received ${solidSets.length} solid and ${glassSets.length} glass wall tile set(s)`,
        );
        setWallSprites(solidSets, glassSets);
      } else if (msg.type === 'workspaceFolders') {
        const folders = msg.folders as WorkspaceFolder[];
        setWorkspaceFolders(folders);
      } else if (msg.type === 'settingsLoaded') {
        const soundOn = msg.soundEnabled as boolean;
        setSoundEnabled(soundOn);
      } else if (msg.type === 'furnitureAssetsLoaded') {
        try {
          const catalog = msg.catalog as FurnitureAsset[];
          const sprites = msg.sprites as Record<string, string[][]>;
          console.log(`📦 Webview: Loaded ${catalog.length} furniture assets`);
          // Build dynamic catalog immediately so getCatalogEntry() works when layoutLoaded arrives next
          buildDynamicCatalog({ catalog, sprites });
          furnitureAssetsReadyRef.current = true;
          if (layoutReadyRef.current) {
            os.rebuildFromLayout(os.getLayout());
            flushPendingAgents(os);
            flushPendingOfficeMessages(os);
          }
          setLoadedAssets({ catalog, sprites });
        } catch (err) {
          console.error(`❌ Webview: Error processing furnitureAssetsLoaded:`, err);
        }
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'webviewReady' });
    return () => window.removeEventListener('message', handler);
  }, [getOfficeState]);

  return {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    agentNames,
    subagentTools,
    subagentCharacters,
    layoutReady,
    layoutWasReset,
    loadedAssets,
    workspaceFolders,
  };
}
