import type { WebSocket } from 'ws';
import * as crypto from 'crypto';

export interface PresenceClient {
  clientId: string;
  userName: string;
  agents: unknown[];
}

interface ClientEntry {
  ws: WebSocket;
  clientId: string;
  userName: string;
  agents: unknown[];
  lastHeartbeat: number;
}

export class ClientStore {
  private clients = new Map<string, ClientEntry>();

  get size(): number {
    return this.clients.size;
  }

  add(ws: WebSocket): string {
    const clientId = crypto.randomUUID();
    this.clients.set(clientId, {
      ws,
      clientId,
      userName: 'Anonymous',
      agents: [],
      lastHeartbeat: Date.now(),
    });
    return clientId;
  }

  remove(clientId: string): void {
    this.clients.delete(clientId);
  }

  get(clientId: string): ClientEntry | undefined {
    return this.clients.get(clientId);
  }

  setUserName(clientId: string, userName: string): void {
    const entry = this.clients.get(clientId);
    if (entry) entry.userName = userName;
  }

  updateAgents(clientId: string, agents: unknown[]): void {
    const entry = this.clients.get(clientId);
    if (entry) {
      entry.agents = agents;
      entry.lastHeartbeat = Date.now();
    }
  }

  setLastHeartbeat(clientId: string, time: number): void {
    const entry = this.clients.get(clientId);
    if (entry) entry.lastHeartbeat = time;
  }

  touchHeartbeat(clientId: string): void {
    const entry = this.clients.get(clientId);
    if (entry) entry.lastHeartbeat = Date.now();
  }

  buildPresenceList(excludeClientId?: string): PresenceClient[] {
    const result: PresenceClient[] = [];
    for (const entry of this.clients.values()) {
      if (entry.clientId === excludeClientId) continue;
      result.push({
        clientId: entry.clientId,
        userName: entry.userName,
        agents: entry.agents,
      });
    }
    return result;
  }

  broadcastPresence(): void {
    for (const entry of this.clients.values()) {
      if (entry.ws.readyState !== 1) continue; // WebSocket.OPEN = 1
      const msg = JSON.stringify({
        type: 'presence',
        clients: this.buildPresenceList(entry.clientId),
      });
      entry.ws.send(msg);
    }
  }

  broadcastToAll(message: string): void {
    for (const entry of this.clients.values()) {
      if (entry.ws.readyState !== 1) continue;
      entry.ws.send(message);
    }
  }

  cleanupStale(timeoutMs: number): boolean {
    const now = Date.now();
    let removed = false;
    for (const [id, entry] of this.clients) {
      if (now - entry.lastHeartbeat > timeoutMs) {
        entry.ws.close();
        this.clients.delete(id);
        removed = true;
      }
    }
    return removed;
  }
}
