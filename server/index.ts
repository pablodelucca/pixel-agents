import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { exec, execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { JsonlWatcher, type WatchedFile } from './watcher.js';
import { processTranscriptLine } from './parser.js';
import {
  loadCharacterSprites,
  loadWallTiles,
  loadFloorTiles,
  loadFurnitureAssets,
  loadDefaultLayout,
} from './assetLoader.js';
import type { TrackedAgent, ServerMessage } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3456', 10);
const IDLE_SHUTDOWN_MS = 600_000; // 10 minutes

// State
const agents = new Map<string, TrackedAgent>(); // sessionId -> agent
let nextAgentId = 1;
const clients = new Set<WebSocket>();
let lastActivityTime = Date.now();

// Load assets at startup
// In dev mode (tsx), __dirname is server/ so assets are at ../webview-ui/public/assets/
// In production (esbuild), __dirname is dist/ so assets are at ./public/assets/
const devAssetsRoot = join(__dirname, '..', 'webview-ui', 'public', 'assets');
const prodAssetsRoot = join(__dirname, 'public', 'assets');
const assetsRoot = existsSync(devAssetsRoot) ? devAssetsRoot : prodAssetsRoot;

console.log(`[Server] Loading assets from: ${assetsRoot}`);

const characterSprites = loadCharacterSprites(assetsRoot);
const wallTiles = loadWallTiles(assetsRoot);
const floorTiles = loadFloorTiles(assetsRoot);
const furnitureAssets = loadFurnitureAssets(assetsRoot);

// Persistence directory
const persistDir = join(homedir(), '.pixel-agents');
const persistedLayoutPath = join(persistDir, 'layout.json');
const persistedSeatsPath = join(persistDir, 'agent-seats.json');

// Load layout: persisted first, then default
function loadLayout(): Record<string, unknown> | null {
  if (existsSync(persistedLayoutPath)) {
    try {
      const content = readFileSync(persistedLayoutPath, 'utf-8');
      const layout = JSON.parse(content) as Record<string, unknown>;
      console.log(`[Server] Loaded persisted layout from ${persistedLayoutPath}`);
      return layout;
    } catch (err) {
      console.warn(
        `[Server] Failed to load persisted layout: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  return loadDefaultLayout(assetsRoot);
}

function loadPersistedSeats(): Record<
  number,
  { palette: number; hueShift: number; seatId: string | null }
> | null {
  if (existsSync(persistedSeatsPath)) {
    try {
      const content = readFileSync(persistedSeatsPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
  return null;
}

let currentLayout = loadLayout();
const persistedSeats = loadPersistedSeats();

// sessionId -> tty device path (e.g. /dev/ttys003) for launched terminals
const agentTtys = new Map<string, string>();

function runAppleScript(script: string, sync: true): string;
function runAppleScript(script: string, sync?: false): void;
function runAppleScript(script: string, sync = false): string | void {
  const tmp = join(tmpdir(), `agora-${randomUUID()}.scpt`);
  writeFileSync(tmp, script, 'utf-8');
  if (sync) {
    try {
      return execSync(`osascript ${tmp}`, { encoding: 'utf-8' }).trim();
    } catch (err) {
      console.error(`[Server] AppleScript error: ${err}`);
      return '';
    } finally {
      try {
        unlinkSync(tmp);
      } catch {}
    }
  } else {
    exec(`osascript ${tmp}`, (err) => {
      try {
        unlinkSync(tmp);
      } catch {}
      if (err) console.error(`[Server] AppleScript error: ${err.message}`);
    });
  }
}

// Launch a new Claude agent in a system terminal; capture its tty for later focusing
function launchAgent(cwd: string, sessionId: string): void {
  const claudeCmd = `claude --session-id ${sessionId}`;

  if (process.platform === 'darwin') {
    const escapedCwd = cwd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    // do script returns the tab object; get its tty so we can focus it later
    const tty = runAppleScript(
      `tell application "Terminal"
  activate
  set newTab to do script "cd " & quoted form of "${escapedCwd}" & " && ${claudeCmd}"
  get tty of newTab
end tell`,
      true,
    );
    if (tty) {
      agentTtys.set(sessionId, tty);
      console.log(`[Server] Launched session ${sessionId.slice(0, 8)} on tty ${tty}`);
    }
  } else if (process.platform === 'win32') {
    exec(`start cmd /k "cd /d "${cwd.replace(/"/g, '\\"')}" && ${claudeCmd}"`);
  } else {
    const escapedCwd = cwd.replace(/"/g, '\\"');
    exec(`gnome-terminal -- bash -c 'cd "${escapedCwd}" && ${claudeCmd}; exec bash'`);
  }
}

// Find the tty of any process running claude with this session ID
function findTtyForSession(sessionId: string): string | null {
  try {
    const pidLine = execSync(`pgrep -f "session-id ${sessionId}"`, { encoding: 'utf-8' }).trim();
    const pid = pidLine.split('\n')[0].trim();
    if (!pid) return null;
    const raw = execSync(`ps -o tty= -p ${pid}`, { encoding: 'utf-8' }).trim();
    if (!raw || raw === '??') return null;
    // Normalize: 's003' → '/dev/ttys003', 'ttys003' → '/dev/ttys003'
    if (raw.startsWith('/')) return raw;
    if (raw.startsWith('tty')) return `/dev/${raw}`;
    return `/dev/tty${raw}`;
  } catch {
    return null;
  }
}

// Bring the specific terminal tab for this session into focus
function focusAgentTerminal(sessionId: string): void {
  if (process.platform !== 'darwin') return;

  let tty = agentTtys.get(sessionId);
  if (!tty) {
    // Fall back to searching the process table (works for manually started sessions)
    const found = findTtyForSession(sessionId);
    if (found) {
      agentTtys.set(sessionId, found); // cache it
      tty = found;
    }
  }

  if (!tty) {
    console.log(`[Server] Could not find terminal for session ${sessionId.slice(0, 8)}`);
    return;
  }

  runAppleScript(`tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "${tty}" then
        activate
        set index of w to 1
        set selected tab of w to t
        return
      end if
    end repeat
  end repeat
end tell`);
}

// Express app
const app = express();
// Serve production build
app.use(express.static(join(__dirname, 'public')));

const server = createServer(app);

// WebSocket
const wss = new WebSocketServer({ server, path: '/ws' });

// Ping/pong heartbeat — keeps clients Set accurate for shutdown guard
const HEARTBEAT_INTERVAL_MS = 30_000;
setInterval(() => {
  for (const ws of clients) {
    if ((ws as unknown as Record<string, boolean>).__isAlive === false) {
      clients.delete(ws);
      ws.terminate();
      continue;
    }
    (ws as unknown as Record<string, boolean>).__isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function sendInitialData(ws: WebSocket): void {
  // Send settings
  ws.send(JSON.stringify({ type: 'settingsLoaded', soundEnabled: false }));

  // Send workspace folders (default to home directory in standalone mode)
  ws.send(
    JSON.stringify({
      type: 'workspaceFolders',
      folders: [{ name: '~', path: homedir() }],
    }),
  );

  // Send character sprites
  if (characterSprites) {
    ws.send(
      JSON.stringify({ type: 'characterSpritesLoaded', characters: characterSprites.characters }),
    );
  }

  // Send wall tiles
  if (wallTiles) {
    ws.send(JSON.stringify({ type: 'wallTilesLoaded', sprites: wallTiles.sprites }));
  }

  // Send floor tiles (optional)
  if (floorTiles) {
    ws.send(JSON.stringify({ type: 'floorTilesLoaded', sprites: floorTiles.sprites }));
  }

  // Send furniture assets (optional)
  if (furnitureAssets) {
    ws.send(
      JSON.stringify({
        type: 'furnitureAssetsLoaded',
        catalog: furnitureAssets.catalog,
        sprites: furnitureAssets.sprites,
      }),
    );
  }

  // Send existing agents with persisted seat metadata
  const agentList = Array.from(agents.values());
  const agentIds = agentList.map((a) => a.id);
  const folderNames: Record<number, string> = {};
  const agentMeta: Record<number, { palette?: number; hueShift?: number; seatId?: string }> = {};
  for (const a of agentList) {
    folderNames[a.id] = a.projectName;
    if (persistedSeats?.[a.id]) {
      const s = persistedSeats[a.id];
      agentMeta[a.id] = { palette: s.palette, hueShift: s.hueShift, seatId: s.seatId ?? undefined };
    }
  }
  ws.send(JSON.stringify({ type: 'existingAgents', agents: agentIds, folderNames, agentMeta }));

  // Send layout (must come after existingAgents — the hook buffers agents until layout arrives)
  if (currentLayout) {
    ws.send(JSON.stringify({ type: 'layoutLoaded', layout: currentLayout, version: 1 }));
  } else {
    // Send null layout to trigger default layout creation in the UI
    ws.send(JSON.stringify({ type: 'layoutLoaded', layout: null, version: 0 }));
  }
}

wss.on('connection', (ws) => {
  (ws as unknown as Record<string, boolean>).__isAlive = true;
  ws.on('pong', () => {
    (ws as unknown as Record<string, boolean>).__isAlive = true;
  });
  clients.add(ws);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'webviewReady' || msg.type === 'ready') {
        sendInitialData(ws);
      } else if (msg.type === 'saveLayout') {
        try {
          mkdirSync(persistDir, { recursive: true });
          writeFileSync(persistedLayoutPath, JSON.stringify(msg.layout, null, 2));
          currentLayout = msg.layout as Record<string, unknown>;
          // Broadcast to other clients for multi-tab sync
          const data = JSON.stringify({ type: 'layoutLoaded', layout: msg.layout, version: 1 });
          for (const client of clients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(data);
            }
          }
        } catch (err) {
          console.error(
            `[Server] Failed to save layout: ${err instanceof Error ? err.message : err}`,
          );
        }
      } else if (msg.type === 'saveAgentSeats') {
        try {
          mkdirSync(persistDir, { recursive: true });
          writeFileSync(persistedSeatsPath, JSON.stringify(msg.seats, null, 2));
        } catch (err) {
          console.error(
            `[Server] Failed to save agent seats: ${err instanceof Error ? err.message : err}`,
          );
        }
      } else if (msg.type === 'openClaude') {
        const cwd = (msg.folderPath as string | undefined) || homedir();
        const sessionId = randomUUID();
        console.log(`[Server] Launching agent in ${cwd} (session ${sessionId.slice(0, 8)})`);
        launchAgent(cwd, sessionId);
      } else if (msg.type === 'focusAgent') {
        const agentId = msg.id as number;
        for (const agent of agents.values()) {
          if (agent.id === agentId) {
            focusAgentTerminal(agent.sessionId);
            break;
          }
        }
      }
    } catch {
      /* ignore invalid messages */
    }
  });

  ws.on('close', () => clients.delete(ws));
});

// Watcher
const watcher = new JsonlWatcher();

watcher.on('fileAdded', (file: WatchedFile) => {
  if (agents.has(file.sessionId)) return;
  lastActivityTime = Date.now();

  const agent: TrackedAgent = {
    id: nextAgentId++,
    sessionId: file.sessionId,
    projectDir: dirname(file.path),
    projectName: file.projectName,
    jsonlFile: file.path,
    fileOffset: 0,
    lineBuffer: '',
    activity: 'idle',
    activeTools: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastActivityTime: Date.now(),
  };

  agents.set(file.sessionId, agent);
  broadcast({ type: 'agentCreated', id: agent.id, folderName: agent.projectName });
  console.log(`Agent ${agent.id} joined: ${agent.projectName} (${file.sessionId.slice(0, 8)})`);
});

watcher.on('fileRemoved', (file: WatchedFile) => {
  const agent = agents.get(file.sessionId);
  if (!agent) return;

  agents.delete(file.sessionId);
  broadcast({ type: 'agentClosed', id: agent.id });
  console.log(`Agent ${agent.id} left: ${agent.projectName}`);
});

watcher.on('line', (file: WatchedFile, line: string) => {
  const agent = agents.get(file.sessionId);
  if (!agent) return;
  lastActivityTime = Date.now();

  processTranscriptLine(line, agent, broadcast);
});

// Start
watcher.start();
server.listen(PORT, () => {
  console.log(`Pixel Agents server running at http://localhost:${PORT}`);
  console.log(`Watching ~/.claude/projects/ for active sessions...`);
});

// Idle shutdown
setInterval(() => {
  if (agents.size === 0 && clients.size === 0 && Date.now() - lastActivityTime > IDLE_SHUTDOWN_MS) {
    console.log('No active sessions or clients for 10 minutes, shutting down...');
    watcher.stop();
    server.close();
    process.exit(0);
  }
}, 30_000);

// Graceful shutdown
process.on('SIGINT', () => {
  watcher.stop();
  server.close();
  process.exit(0);
});
