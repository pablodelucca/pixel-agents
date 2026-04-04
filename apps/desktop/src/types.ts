import type {
  NormalizedAgentEvent,
  StoredAgentProviderConfig,
} from '../../../packages/core/src/index.js';

export interface DesktopConfig {
  externalAssetDirectories: string[];
  provider: StoredAgentProviderConfig;
  soundEnabled: boolean;
  watchAllSessions: boolean;
  alwaysShowLabels: boolean;
  rememberProviderChoice: boolean;
  lastProjectDirectory?: string;
}

export interface OpenAgentPayload {
  folderPath?: string;
  bypassPermissions?: boolean;
  providerOverride?: StoredAgentProviderConfig;
  rememberProviderDefault?: boolean;
}

export type RendererToHostMessage =
  | { type: 'webviewReady' }
  | ({ type: 'openAgent' } & OpenAgentPayload)
  | { type: 'focusAgent'; id: number }
  | { type: 'closeAgent'; id: number }
  | { type: 'saveLayout'; layout: Record<string, unknown> }
  | { type: 'saveAgentSeats'; seats: Record<string, unknown> }
  | { type: 'setSoundEnabled'; enabled: boolean }
  | { type: 'setWatchAllSessions'; enabled: boolean }
  | { type: 'setAlwaysShowLabels'; enabled: boolean }
  | { type: 'addExternalAssetDirectory' }
  | { type: 'removeExternalAssetDirectory'; path: string }
  | { type: 'exportLayout' }
  | { type: 'importLayout' }
  | { type: 'pickProjectFolder' }
  | { type: 'configureAgentProvider' }
  | {
      type: 'configureProvider';
      provider: StoredAgentProviderConfig;
      rememberProviderDefault?: boolean;
    }
  | { type: 'openSessionsFolder' }
  | { type: 'setLastSeenVersion'; version: string };

export type HostToRendererMessage =
  | NormalizedAgentEvent
  | { type: 'runtimeLog'; level: 'info' | 'error'; message: string; agentId?: number }
  | {
      type: 'existingAgents';
      agents: number[];
      agentMeta: Record<number, unknown>;
      folderNames: Record<number, string>;
    }
  | { type: 'workspaceFolders'; folders: Array<{ name: string; path: string }> }
  | { type: 'settingsLoaded'; [key: string]: unknown }
  | { type: 'layoutLoaded'; layout: Record<string, unknown> | null; wasReset?: boolean }
  | { type: 'furnitureAssetsLoaded'; catalog: unknown[]; sprites: Record<string, string[][]> }
  | { type: 'floorTilesLoaded'; sprites: string[][][] }
  | { type: 'wallTilesLoaded'; sets: string[][][][] }
  | {
      type: 'characterSpritesLoaded';
      characters: Array<{
        down: string[][][];
        up: string[][][];
        right: string[][][];
      }>;
    }
  | { type: 'projectFolderPicked'; folderPath: string }
  | { type: 'externalAssetDirectoriesUpdated'; dirs: string[] }
  | { type: 'providerConfigured'; provider: StoredAgentProviderConfig }
  | { type: 'hostError'; message: string };
