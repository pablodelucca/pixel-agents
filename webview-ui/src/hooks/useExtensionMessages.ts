import { useEffect, useRef, useState } from 'react';

import { setSoundEnabled } from '../notificationSound.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { setFloorSprites } from '../office/floorTiles.js';
import { buildDynamicCatalog } from '../office/layout/furnitureCatalog.js';
import { migrateLayoutColors } from '../office/layout/layoutSerializer.js';
import { setCharacterTemplates } from '../office/sprites/spriteData.js';
import type { OfficeLayout } from '../office/types.js';
import { setWallSprites } from '../office/wallTiles.js';
import { vscode } from '../vscodeApi.js';

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
  partOfGroup?: boolean;
  groupId?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
}

// ── Wholesale State Types (mirrors src/types.ts) ──────────────
export interface AgentCharacterState {
  id: number;
  name: string;
  processStatus: 'running' | 'not_running';
  animState: 'TYPING' | 'IDLE' | 'ABSENT';
  bubble: { text: string; type: string } | null;
  lastActivity: string | null;
}

export interface DbSnapshot {
  leads: {
    total: number;
    new: number;
    dripping: number;
    dripComplete: number;
    responded: number;
    doNotContact: number;
    badNumber: number;
    hot: number;
    paused: number;
  };
  dripStages: Record<number, number>;
  outreach: {
    sentToday: number;
    totalSent: number;
    totalReplied: number;
    replyRate: number;
  };
  deals: {
    total: number;
    qualifying: number;
    waitingArv: number;
    waitingRepairs: number;
    offered: number;
    negotiating: number;
    underContract: number;
    closed: number;
    passed: number;
  };
  sendWindow: {
    isOpen: boolean;
    nextOpen: string | null;
  };
}

export interface WholesaleStateSnapshot {
  agents: AgentCharacterState[];
  db: DbSnapshot;
  lastUpdate: number;
}

export interface ExtensionMessageState {
  agents: number[];
  agentNames: Record<number, string>;
  agentStates: Record<number, AgentCharacterState>;
  dbSnapshot: DbSnapshot | null;
  layoutReady: boolean;
  loadedAssets?: { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> };
}

export function useExtensionMessages(
  getOfficeState: () => OfficeState,
  onLayoutLoaded?: (layout: OfficeLayout) => void,
  isEditDirty?: () => boolean,
): ExtensionMessageState {
  const [agents, setAgents] = useState<number[]>([]);
  const [agentNames, setAgentNames] = useState<Record<number, string>>({});
  const [agentStates, setAgentStates] = useState<Record<number, AgentCharacterState>>({});
  const [dbSnapshot, setDbSnapshot] = useState<DbSnapshot | null>(null);
  const [layoutReady, setLayoutReady] = useState(false);
  const [loadedAssets, setLoadedAssets] = useState<
    { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> } | undefined
  >();

  const layoutReadyRef = useRef(false);

  useEffect(() => {
    // Buffer wholesale agents until layout is loaded
    let pendingAgents: Array<{
      id: number;
      palette: number;
      hueShift: number;
      name: string;
    }> = [];

    const handler = (e: MessageEvent) => {
      const msg = e.data;
      const os = getOfficeState();

      if (msg.type === 'layoutLoaded') {
        // Skip external layout updates while editor has unsaved changes
        if (layoutReadyRef.current && isEditDirty?.()) {
          return;
        }
        const rawLayout = msg.layout as OfficeLayout | null;
        const layout = rawLayout && rawLayout.version === 1 ? migrateLayoutColors(rawLayout) : null;
        if (layout) {
          os.rebuildFromLayout(layout);
          onLayoutLoaded?.(layout);
        } else {
          onLayoutLoaded?.(os.getLayout());
        }
        // Add buffered agents
        for (const p of pendingAgents) {
          os.addAgent(p.id, p.palette, p.hueShift, undefined, true);
        }
        pendingAgents = [];
        layoutReadyRef.current = true;
        setLayoutReady(true);
      } else if (msg.type === 'wholesaleAgents') {
        // 3 fixed agents from the extension
        const incoming = msg.agents as number[];
        const meta = msg.agentMeta as Record<
          number,
          { palette: number; hueShift: number; name: string }
        >;

        const names: Record<number, string> = {};
        for (const id of incoming) {
          names[id] = meta[id]?.name ?? `Agent ${id}`;
        }
        setAgentNames(names);

        if (layoutReadyRef.current) {
          // Layout already loaded — add agents now
          for (const id of incoming) {
            const m = meta[id];
            if (!os.characters.has(id)) {
              os.addAgent(id, m?.palette ?? 0, m?.hueShift ?? 0, undefined, true);
            }
          }
        } else {
          // Buffer until layout loads
          for (const id of incoming) {
            const m = meta[id];
            pendingAgents.push({
              id,
              palette: m?.palette ?? 0,
              hueShift: m?.hueShift ?? 0,
              name: m?.name ?? `Agent ${id}`,
            });
          }
        }
        setAgents(incoming);
      } else if (msg.type === 'wholesaleState') {
        // State update from the data poller
        const snapshot = msg.snapshot as WholesaleStateSnapshot;
        setDbSnapshot(snapshot.db);

        const states: Record<number, AgentCharacterState> = {};
        for (const agentState of snapshot.agents) {
          states[agentState.id] = agentState;

          // Update character in office state
          const ch = os.characters.get(agentState.id);
          if (!ch) continue;

          if (agentState.animState === 'TYPING') {
            os.setAgentActive(agentState.id, true);
            os.setAgentTool(agentState.id, 'typing'); // triggers TYPE animation
          } else if (agentState.animState === 'IDLE') {
            os.setAgentActive(agentState.id, false);
            os.setAgentTool(agentState.id, null);
          } else if (agentState.animState === 'ABSENT') {
            os.setAgentActive(agentState.id, false);
            os.setAgentTool(agentState.id, null);
            // Show offline bubble
            ch.bubbleType = 'permission'; // reuse permission type (stays until cleared)
          }

          // Handle bubble from state mapper
          if (agentState.bubble && agentState.animState !== 'ABSENT') {
            // Use waiting bubble type for info/alert (auto-fades)
            if (agentState.bubble.type === 'sleeping' || agentState.bubble.type === 'offline') {
              ch.bubbleType = 'permission'; // persistent
            } else {
              os.showWaitingBubble(agentState.id);
            }
          } else if (!agentState.bubble && agentState.animState !== 'ABSENT') {
            os.clearPermissionBubble(agentState.id);
          }
        }
        setAgentStates(states);
      } else if (msg.type === 'characterSpritesLoaded') {
        const characters = msg.characters as Array<{
          down: string[][][];
          up: string[][][];
          right: string[][][];
        }>;
        setCharacterTemplates(characters);
      } else if (msg.type === 'floorTilesLoaded') {
        const sprites = msg.sprites as string[][][];
        setFloorSprites(sprites);
      } else if (msg.type === 'wallTilesLoaded') {
        const sprites = msg.sprites as string[][][];
        setWallSprites(sprites);
      } else if (msg.type === 'settingsLoaded') {
        const soundOn = msg.soundEnabled as boolean;
        setSoundEnabled(soundOn);
      } else if (msg.type === 'furnitureAssetsLoaded') {
        try {
          const catalog = msg.catalog as FurnitureAsset[];
          const sprites = msg.sprites as Record<string, string[][]>;
          buildDynamicCatalog({ catalog, sprites });
          setLoadedAssets({ catalog, sprites });
        } catch (err) {
          console.error('[Webview] Error processing furnitureAssetsLoaded:', err);
        }
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'webviewReady' });
    return () => window.removeEventListener('message', handler);
  }, [getOfficeState]);

  return {
    agents,
    agentNames,
    agentStates,
    dbSnapshot,
    layoutReady,
    loadedAssets,
  };
}
