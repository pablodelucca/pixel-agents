// Agent activity states
export type AgentActivity = 'idle' | 'typing' | 'reading' | 'waiting' | 'permission';

// Tool info for speech bubbles
export interface ActiveTool {
  toolId: string;
  toolName: string;
  status: string;
}

// Agent as tracked by the server
export interface TrackedAgent {
  id: number;
  sessionId: string;
  projectDir: string;
  projectName: string;
  jsonlFile: string;
  fileOffset: number;
  lineBuffer: string;
  activity: AgentActivity;
  activeTools: Map<string, ActiveTool>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>;
  activeSubagentToolNames: Map<string, Map<string, string>>;
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  lastActivityTime: number;
}

// Messages sent from server to client via WebSocket
// Must match the upstream message format expected by useExtensionMessages
export type ServerMessage =
  | { type: 'agentCreated'; id: number; folderName: string }
  | { type: 'agentClosed'; id: number }
  | {
      type: 'existingAgents';
      agents: number[];
      folderNames: Record<number, string>;
      agentMeta?: Record<number, { palette?: number; hueShift?: number; seatId?: string }>;
    }
  | { type: 'agentToolStart'; id: number; toolId: string; status: string }
  | { type: 'agentToolDone'; id: number; toolId: string }
  | { type: 'agentToolsClear'; id: number }
  | { type: 'agentStatus'; id: number; status: string }
  | { type: 'agentToolPermission'; id: number }
  | { type: 'agentToolPermissionClear'; id: number }
  | { type: 'subagentToolStart'; id: number; parentToolId: string; toolId: string; status: string }
  | { type: 'subagentToolDone'; id: number; parentToolId: string; toolId: string }
  | { type: 'subagentToolPermission'; id: number; parentToolId: string }
  | { type: 'subagentClear'; id: number; parentToolId: string }
  | { type: 'characterSpritesLoaded'; characters: unknown[] }
  | { type: 'floorTilesLoaded'; sprites: unknown[] }
  | { type: 'wallTilesLoaded'; sprites: unknown[] }
  | { type: 'furnitureAssetsLoaded'; catalog: unknown[]; sprites: Record<string, unknown> }
  | { type: 'layoutLoaded'; layout: unknown; version: number }
  | { type: 'settingsLoaded'; soundEnabled: boolean };

// Messages sent from client to server
export type ClientMessage =
  | { type: 'ready' }
  | { type: 'webviewReady' }
  | { type: 'saveLayout'; layout: unknown }
  | {
      type: 'saveAgentSeats';
      seats: Record<number, { palette: number; hueShift: number; seatId: string | null }>;
    };
