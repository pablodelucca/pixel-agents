import type { AvatarAppearance } from '../avatar/types.js'

// ── Sync modes ─────────────────────────────────────────
export type SyncMode = 'connect' | 'guest' | 'offline'

// ── Agent snapshot sent in heartbeat ───────────────────
export interface AgentSnapshot {
  id: number
  name: string
  status: 'active' | 'idle' | 'waiting' | 'permission'
  activeTool?: string
  appearance: AvatarAppearance
  x: number
  y: number
  dir: number
  state: string  // CharacterState value
  frame: number  // animation frame
}

// ── Presence from server ───────────────────────────────
export interface PresenceClient {
  clientId: string
  userName: string
  agents: AgentSnapshot[]
}

// ── Client -> Server messages ──────────────────────────
export type ClientMessage =
  | { type: 'join'; userName: string }
  | { type: 'heartbeat'; agents: AgentSnapshot[] }
  | { type: 'layoutPut'; layout: string }
  | { type: 'chat'; agentId: number; msg: string }

// ── Server -> Client messages ──────────────────────────
export type ServerMessage =
  | { type: 'welcome'; clientId: string; layoutJson: string; layoutEtag: string }
  | { type: 'presence'; clients: PresenceClient[] }
  | { type: 'layoutFull'; layoutJson: string; layoutEtag: string }
  | { type: 'layoutChanged'; etag: string }
  | { type: 'chat'; clientId: string; agentId: number; userName: string; msg: string }

// ── SyncTransport event callbacks ──────────────────────
export interface SyncTransportCallbacks {
  onOpen: () => void
  onMessage: (msg: ServerMessage) => void
  onClose: () => void
}

// ── SyncManager config ─────────────────────────────────
export interface SyncManagerConfig {
  serverUrl: string
  userName: string
  mode: SyncMode
  heartbeatIntervalMs: number
  getLocalAgents: () => AgentSnapshot[]
  onPresence: (clients: PresenceClient[]) => void
  onRemoteLayout: (layout: unknown) => void
  isEditDirty?: () => boolean
  onChat?: (clientId: string, agentId: number, userName: string, msg: string) => void
}
