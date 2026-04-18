/**
 * Typed message protocol between extension/server and webview.
 * All communication uses postMessage (VS Code) or WebSocket (standalone).
 *
 * ServerMessage: extension/server -> webview
 * ClientMessage: webview -> extension/server
 */

// ── Server -> Webview ────────────────────────────────────────

export type ServerMessage =
  // Provider capabilities (sent once after webviewReady)
  | {
      type: 'providerCapabilities';
      /** Tool names the webview should render with the "reading" animation. */
      readingTools: string[];
      /** Tool names that spawn sub-agent characters (Task/Agent on Claude). */
      subagentToolNames: string[];
    }
  // Agent lifecycle
  | { type: 'agentCreated'; id: number; folderName?: string; isExternal?: boolean }
  | { type: 'agentClosed'; id: number }
  | { type: 'agentSelected'; id: number }
  | {
      type: 'existingAgents';
      agents: number[];
      agentMeta: Record<string, { palette?: number; hueShift?: number; seatId?: string }>;
      folderNames: Record<number, string>;
      externalAgents: Record<number, boolean>;
    }

  // Agent status
  | { type: 'agentStatus'; id: number; status: 'active' | 'waiting' }

  // Tool activity
  | {
      type: 'agentToolStart';
      id: number;
      toolId: string;
      status: string;
      toolName?: string;
      permissionActive?: boolean;
      runInBackground?: boolean;
    }
  | { type: 'agentToolDone'; id: number; toolId: string }
  | { type: 'agentToolsClear'; id: number }
  | { type: 'agentToolPermission'; id: number }
  | { type: 'agentToolPermissionClear'; id: number }

  // Sub-agent activity
  | {
      type: 'subagentToolStart';
      id: number;
      parentToolId: string;
      toolId: string;
      status: string;
    }
  | { type: 'subagentToolDone'; id: number; parentToolId: string; toolId: string }
  | { type: 'subagentClear'; id: number; parentToolId: string }
  | { type: 'subagentToolPermission'; id: number; parentToolId: string }

  // Agent Teams
  | {
      type: 'agentTeamInfo';
      id: number;
      teamName?: string;
      agentName?: string;
      isTeamLead?: boolean;
      leadAgentId?: number;
      teamUsesTmux?: boolean;
    }
  | { type: 'agentTokenUsage'; id: number; inputTokens: number; outputTokens: number }

  // Layout
  | { type: 'layoutLoaded'; layout: Record<string, unknown> | null; wasReset?: boolean }

  // Assets
  | {
      type: 'furnitureAssetsLoaded';
      catalog: FurnitureAssetMessage[];
      sprites: Record<string, string[][]>;
    }
  | {
      type: 'characterSpritesLoaded';
      characters: Array<{
        down: string[][][];
        up: string[][][];
        right: string[][][];
      }>;
    }
  | { type: 'floorTilesLoaded'; sprites: string[][][] }
  | { type: 'wallTilesLoaded'; sets: string[][][][] }

  // Settings & config
  | {
      type: 'settingsLoaded';
      soundEnabled: boolean;
      lastSeenVersion: string;
      extensionVersion: string;
      watchAllSessions: boolean;
      alwaysShowLabels: boolean;
      hooksEnabled: boolean;
      hooksInfoShown: boolean;
      externalAssetDirectories: string[];
    }
  | { type: 'externalAssetDirectoriesUpdated'; dirs: string[] }
  | { type: 'workspaceFolders'; folders: Array<{ name: string; path: string }> }

  // Diagnostics
  | { type: 'agentDiagnostics'; agents: Array<Record<string, unknown>> };

// ── Webview -> Server/Extension ──────────────────────────────

export type ClientMessage =
  // Agent actions
  | { type: 'webviewReady' }
  | { type: 'launchAgent'; folderPath?: string; bypassPermissions?: boolean }
  | { type: 'focusAgent'; id: number }
  | { type: 'closeAgent'; id: number }

  // State persistence
  | {
      type: 'saveAgentSeats';
      seats: Record<number, { palette: number; hueShift: number; seatId: string | null }>;
    }
  | { type: 'saveLayout'; layout: Record<string, unknown> }

  // Settings
  | { type: 'setSoundEnabled'; enabled: boolean }
  | { type: 'setLastSeenVersion'; version: string }
  | { type: 'setAlwaysShowLabels'; enabled: boolean }
  | { type: 'setHooksEnabled'; enabled: boolean }
  | { type: 'setHooksInfoShown' }
  | { type: 'setWatchAllSessions'; enabled: boolean }

  // Layout import/export
  | { type: 'exportLayout' }
  | { type: 'importLayout' }
  | { type: 'openSessionsFolder' }

  // Asset directories
  | { type: 'addExternalAssetDirectory' }
  | { type: 'removeExternalAssetDirectory'; path: string }

  // Diagnostics
  | { type: 'requestDiagnostics' };

// ── Supporting types ─────────────────────────────────────────

/** Furniture asset metadata sent in furnitureAssetsLoaded message */
export interface FurnitureAssetMessage {
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
