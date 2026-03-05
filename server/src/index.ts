#!/usr/bin/env node
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientState, ClientMessage, PresenceClient, RemoteAgent } from './types.js';

const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '4200', 10);
const DATA_DIR = process.argv.find((_, i, a) => a[i - 1] === '--data') || 'server-data';
const LAYOUT_FILE = path.join(DATA_DIR, 'layout.json');
const HEARTBEAT_TIMEOUT_MS = 10_000;
const CLEANUP_INTERVAL_MS = 5_000;

let layoutJson = '{}';
let layoutEtag = '';
const clients = new Map<string, ClientState>();

function computeEtag(json: string): string {
  return crypto.createHash('md5').update(json).digest('hex');
}

function loadLayout(): void {
  try {
    if (fs.existsSync(LAYOUT_FILE)) {
      layoutJson = fs.readFileSync(LAYOUT_FILE, 'utf-8');
      layoutEtag = computeEtag(layoutJson);
      console.log(`[Server] Layout loaded from ${LAYOUT_FILE} (etag: ${layoutEtag.slice(0, 8)})`);
    }
  } catch (err) {
    console.error('[Server] Failed to load layout:', err);
  }
}

function saveLayout(json: string): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpPath = LAYOUT_FILE + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, LAYOUT_FILE);
  } catch (err) {
    console.error('[Server] Failed to save layout:', err);
  }
}

function buildPresenceList(excludeClientId?: string): PresenceClient[] {
  const result: PresenceClient[] = [];
  for (const [id, client] of clients) {
    if (id === excludeClientId) continue;
    result.push({
      clientId: client.clientId,
      userName: client.userName,
      agents: client.agents,
    });
  }
  return result;
}

function broadcastPresence(): void {
  for (const [id, client] of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    const msg = JSON.stringify({
      type: 'presence',
      clients: buildPresenceList(id),
    });
    client.ws.send(msg);
  }
}

function cleanupStaleClients(): void {
  const now = Date.now();
  let removed = false;
  for (const [id, client] of clients) {
    if (now - client.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
      console.log(`[Server] Client ${id} (${client.userName}) timed out`);
      client.ws.close();
      clients.delete(id);
      removed = true;
    }
  }
  if (removed) {
    broadcastPresence();
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
  res.setHeader('Access-Control-Expose-Headers', 'ETag');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/layout' && req.method === 'GET') {
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === layoutEtag) {
      res.writeHead(304);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'ETag': layoutEtag,
    });
    res.end(layoutJson);
    return;
  }

  if (req.url === '/layout' && req.method === 'PUT') {
    let body = '';
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => {
      try {
        JSON.parse(body);
        layoutJson = body;
        layoutEtag = computeEtag(layoutJson);
        saveLayout(layoutJson);

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'ETag': layoutEtag,
        });
        res.end(JSON.stringify({ etag: layoutEtag }));

        const msg = JSON.stringify({ type: 'layoutChanged', etag: layoutEtag });
        for (const client of clients.values()) {
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(msg);
          }
        }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, clients: clients.size }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const clientId = crypto.randomUUID();
  const client: ClientState = {
    ws,
    clientId,
    userName: 'Anonymous',
    agents: [],
    lastHeartbeat: Date.now(),
  };
  clients.set(clientId, client);
  console.log(`[Server] Client connected: ${clientId}`);

  ws.send(JSON.stringify({
    type: 'presence',
    clients: buildPresenceList(clientId),
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as ClientMessage;
      client.lastHeartbeat = Date.now();

      if (msg.type === 'join') {
        client.userName = msg.userName || 'Anonymous';
        console.log(`[Server] Client ${clientId} joined as "${client.userName}"`);
        broadcastPresence();
      } else if (msg.type === 'heartbeat') {
        client.agents = msg.agents || [];
        broadcastPresence();
      }
    } catch (err) {
      console.error('[Server] Bad message from client:', err);
    }
  });

  ws.on('close', () => {
    console.log(`[Server] Client disconnected: ${clientId} (${client.userName})`);
    clients.delete(clientId);
    broadcastPresence();
  });

  ws.on('error', (err) => {
    console.error(`[Server] WS error for ${clientId}:`, err);
  });
});

loadLayout();
setInterval(cleanupStaleClients, CLEANUP_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`[Pixel Agents Server] Running on port ${PORT}`);
  console.log(`[Pixel Agents Server] Layout file: ${path.resolve(LAYOUT_FILE)}`);
});
