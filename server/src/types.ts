import type { WebSocket } from 'ws';

export interface RemoteAgent {
  id: number;
  name: string;
  status: 'active' | 'idle' | 'waiting' | 'permission';
  activeTool?: string;
  seatId?: string;
  palette: number;
  hueShift: number;
}

export interface ClientState {
  ws: WebSocket;
  clientId: string;
  userName: string;
  agents: RemoteAgent[];
  lastHeartbeat: number;
}

export interface PresenceClient {
  clientId: string;
  userName: string;
  agents: RemoteAgent[];
}

export interface JoinMessage {
  type: 'join';
  userName: string;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  agents: RemoteAgent[];
}

export type ClientMessage = JoinMessage | HeartbeatMessage;

export interface PresenceMessage {
  type: 'presence';
  clients: PresenceClient[];
}

export interface LayoutChangedMessage {
  type: 'layoutChanged';
  etag: string;
}

export type ServerMessage = PresenceMessage | LayoutChangedMessage;
