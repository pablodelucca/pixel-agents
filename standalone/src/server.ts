import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

import { loadAllAssets } from './assetLoader.js';
import {
  DEFAULT_PORT,
  FILE_WATCHER_POLL_INTERVAL_MS,
  LAYOUT_FILE_DIR,
  LAYOUT_FILE_NAME,
  LAYOUT_REVISION_KEY,
  PROJECT_SCAN_INTERVAL_MS,
} from './constants.js';
import {
  cancelPermissionTimer,
  cancelWaitingTimer,
  clearAgentActivity,
  processTranscriptLine,
} from './transcriptParser.js';
import type { AgentState } from './types.js';

// -- State --

const agents = new Map<number, AgentState>();
const fileWatchers = new Map<number, fs.FSWatcher>();
const pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
const knownJsonlFiles = new Set<string>();
const knownProjectDirs = new Set<string>();
let nextAgentId = 1;
const clients = new Set<WebSocket>();

// -- Helpers --

function broadcast(msg: Record<string, unknown>): void {
  const json = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) {
      // WebSocket.OPEN
      ws.send(json);
    }
  }
}

function getProjectName(dirPath: string): string {
  // Convert ~/.claude/projects/-Users-rolle-Projects-foo back to project name
  const base = path.basename(dirPath);
  const parts = base.split('-').filter(Boolean);
  // Take last meaningful segment as project name
  return parts[parts.length - 1] || base;
}

// -- Layout persistence --

function getLayoutFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, LAYOUT_FILE_NAME);
}

function readLayoutFromFile(): Record<string, unknown> | null {
  const filePath = getLayoutFilePath();
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeLayoutToFile(layout: Record<string, unknown>): void {
  const filePath = getLayoutFilePath();
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(layout, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[Layout] Write error:', err);
  }
}

// -- File watching (ported from extension) --

function startFileWatching(agentId: number, filePath: string): void {
  try {
    const watcher = fs.watch(filePath, () => {
      readNewLines(agentId);
    });
    fileWatchers.set(agentId, watcher);
  } catch {
    /* fs.watch can fail */
  }

  try {
    fs.watchFile(filePath, { interval: FILE_WATCHER_POLL_INTERVAL_MS }, () => {
      readNewLines(agentId);
    });
  } catch {
    /* ignore */
  }

  const interval = setInterval(() => {
    if (!agents.has(agentId)) {
      clearInterval(interval);
      try {
        fs.unwatchFile(filePath);
      } catch {
        /* ignore */
      }
      return;
    }
    readNewLines(agentId);
  }, FILE_WATCHER_POLL_INTERVAL_MS);
  pollingTimers.set(agentId, interval);
}

function readNewLines(agentId: number): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  try {
    const stat = fs.statSync(agent.jsonlFile);
    if (stat.size <= agent.fileOffset) return;

    const buf = Buffer.alloc(stat.size - agent.fileOffset);
    const fd = fs.openSync(agent.jsonlFile, 'r');
    fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
    fs.closeSync(fd);
    agent.fileOffset = stat.size;

    const text = agent.lineBuffer + buf.toString('utf-8');
    const lines = text.split('\n');
    agent.lineBuffer = lines.pop() || '';

    const hasLines = lines.some((l) => l.trim());
    if (hasLines) {
      cancelWaitingTimer(agentId, waitingTimers);
      cancelPermissionTimer(agentId, permissionTimers);
      if (agent.permissionSent) {
        agent.permissionSent = false;
        broadcast({ type: 'agentToolPermissionClear', id: agentId });
      }
    }

    for (const line of lines) {
      if (!line.trim()) continue;
      processTranscriptLine(agentId, line, agents, waitingTimers, permissionTimers, broadcast);
    }
  } catch {
    // Read error - file may have been removed
  }
}

function removeAgent(agentId: number): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  fileWatchers.get(agentId)?.close();
  fileWatchers.delete(agentId);
  const pt = pollingTimers.get(agentId);
  if (pt) clearInterval(pt);
  pollingTimers.delete(agentId);
  try {
    fs.unwatchFile(agent.jsonlFile);
  } catch {
    /* ignore */
  }

  cancelWaitingTimer(agentId, waitingTimers);
  cancelPermissionTimer(agentId, permissionTimers);

  agents.delete(agentId);
  broadcast({ type: 'agentClosed', id: agentId });
}

// -- Session discovery --

function isFileActive(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    // Consider a file active if modified in the last 30 minutes
    return Date.now() - stat.mtimeMs < 30 * 60 * 1000;
  } catch {
    return false;
  }
}

function isFileGrowing(filePath: string): boolean {
  // Check if file has grown recently (last 60 seconds) - sign of active session
  try {
    const stat = fs.statSync(filePath);
    return Date.now() - stat.mtimeMs < 60 * 1000;
  } catch {
    return false;
  }
}

function adoptJsonlFile(filePath: string, projectDir: string): void {
  if (knownJsonlFiles.has(filePath)) return;
  knownJsonlFiles.add(filePath);

  if (!isFileActive(filePath)) return;

  const id = nextAgentId++;
  const projectName = getProjectName(projectDir);
  const agent: AgentState = {
    id,
    projectDir,
    projectName,
    jsonlFile: filePath,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    folderName: projectName,
  };

  // Skip to near end of file - only read recent activity
  try {
    const stat = fs.statSync(filePath);
    // Start reading from max 50KB before end to catch recent activity
    agent.fileOffset = Math.max(0, stat.size - 50 * 1024);
  } catch {
    /* start from beginning */
  }

  agents.set(id, agent);
  console.log(`[Agent ${id}] Adopted session in ${projectName}: ${path.basename(filePath)}`);
  broadcast({ type: 'agentCreated', id, folderName: projectName });

  startFileWatching(id, filePath);
  readNewLines(id);
}

function scanProjectDir(projectDir: string): void {
  try {
    const files = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(projectDir, f));

    for (const file of files) {
      if (!knownJsonlFiles.has(file)) {
        adoptJsonlFile(file, projectDir);
      }
    }
  } catch {
    /* dir may not exist */
  }
}

function scanAllProjects(): void {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  try {
    if (!fs.existsSync(claudeProjectsDir)) return;
    const entries = fs.readdirSync(claudeProjectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectDir = path.join(claudeProjectsDir, entry.name);
      knownProjectDirs.add(projectDir);
      scanProjectDir(projectDir);
    }
  } catch {
    /* ignore */
  }
}

function cleanupStaleAgents(): void {
  for (const [id, agent] of agents) {
    if (!fs.existsSync(agent.jsonlFile)) {
      console.log(`[Agent ${id}] Session file removed, cleaning up`);
      removeAgent(id);
      continue;
    }
    // Remove agents whose sessions haven't been active for 30 minutes
    if (!isFileActive(agent.jsonlFile) && !isFileGrowing(agent.jsonlFile)) {
      console.log(`[Agent ${id}] Session inactive, cleaning up`);
      removeAgent(id);
    }
  }
}

// -- Send full state to new client --

function sendInitialState(ws: WebSocket, assets: ReturnType<typeof loadAllAssets>): void {
  const send = (msg: Record<string, unknown>) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  };

  // Send assets first
  send({ type: 'characterSpritesLoaded', characters: assets.characters });
  send({ type: 'floorTilesLoaded', sprites: assets.floorTiles });
  send({ type: 'wallTilesLoaded', sets: assets.wallSets });
  send({ type: 'furnitureAssetsLoaded', catalog: assets.catalog, sprites: assets.sprites });

  // Send settings
  send({ type: 'settingsLoaded', soundEnabled: true });

  // Send standalone mode flag
  send({ type: 'standaloneMode', enabled: true });

  // Send existing agents - these get buffered in pendingAgents by the webview
  const agentIds = [...agents.keys()].sort((a, b) => a - b);
  const folderNames: Record<number, string> = {};
  for (const [id, agent] of agents) {
    if (agent.folderName) folderNames[id] = agent.folderName;
  }
  send({ type: 'existingAgents', agents: agentIds, agentMeta: {}, folderNames });

  // Send layout LAST - this triggers the webview to flush pendingAgents into OfficeState
  const savedLayout = readLayoutFromFile();
  const layout = savedLayout ?? assets.defaultLayout;
  if (layout) {
    if (savedLayout && assets.defaultLayout) {
      const fileRevision = (savedLayout[LAYOUT_REVISION_KEY] as number) ?? 0;
      const defaultRevision = (assets.defaultLayout[LAYOUT_REVISION_KEY] as number) ?? 0;
      if (defaultRevision > fileRevision) {
        writeLayoutToFile(assets.defaultLayout);
        send({ type: 'layoutLoaded', layout: assets.defaultLayout, wasReset: true });
      } else {
        send({ type: 'layoutLoaded', layout: savedLayout });
      }
    } else if (savedLayout) {
      send({ type: 'layoutLoaded', layout: savedLayout });
    } else if (assets.defaultLayout) {
      writeLayoutToFile(assets.defaultLayout);
      send({ type: 'layoutLoaded', layout: assets.defaultLayout });
    }
  } else {
    send({ type: 'layoutLoaded', layout: null });
  }

  // Re-send current tool states
  for (const [agentId, agent] of agents) {
    for (const [toolId, status] of agent.activeToolStatuses) {
      send({ type: 'agentToolStart', id: agentId, toolId, status });
    }
    if (agent.isWaiting) {
      send({ type: 'agentStatus', id: agentId, status: 'waiting' });
    }
  }
}

// -- Static file server --

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
  };
  return mimes[ext] || 'application/octet-stream';
}

// -- Main --

function main(): void {
  const port = parseInt(process.env.PORT || '', 10) || DEFAULT_PORT;

  // Find assets - check dist/assets first, then webview-ui/public/assets
  const projectRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(projectRoot, '..');
  let assetsRoot: string | null = null;

  const distAssets = path.join(projectRoot, 'dist', 'assets');
  const repoDistAssets = path.join(repoRoot, 'dist', 'assets');
  const publicAssets = path.join(repoRoot, 'webview-ui', 'public', 'assets');

  if (fs.existsSync(distAssets)) {
    assetsRoot = path.join(projectRoot, 'dist');
  } else if (fs.existsSync(repoDistAssets)) {
    assetsRoot = path.join(repoRoot, 'dist');
  } else if (fs.existsSync(publicAssets)) {
    assetsRoot = path.join(repoRoot, 'webview-ui', 'public');
  }

  if (!assetsRoot) {
    console.error(
      'Could not find assets directory. Run the main project build first: npm run build',
    );
    process.exit(1);
  }

  console.log(`[Server] Loading assets from: ${assetsRoot}`);
  const assets = loadAllAssets(assetsRoot);

  // Find webview dist
  const webviewDist = path.join(repoRoot, 'dist', 'webview');
  if (!fs.existsSync(webviewDist)) {
    console.error(`Webview not built. Run from repo root: npm run build`);
    process.exit(1);
  }

  // Create HTTP server for static files
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    let filePath = path.join(webviewDist, url.pathname === '/' ? 'index.html' : url.pathname);

    // Also serve fonts from public dir
    if (url.pathname.startsWith('/fonts/')) {
      const fontPath = path.join(repoRoot, 'webview-ui', 'public', url.pathname);
      if (fs.existsSync(fontPath)) {
        filePath = fontPath;
      }
    }

    if (!fs.existsSync(filePath)) {
      // SPA fallback
      filePath = path.join(webviewDist, 'index.html');
    }

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  // WebSocket server
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[WS] Client connected (${clients.size} total)`);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        console.log(`[WS] Received: ${msg.type}`);
        if (msg.type === 'webviewReady') {
          // Send initial state only after React app is mounted and listening
          sendInitialState(ws, assets);
        } else {
          handleClientMessage(msg, assets);
        }
      } catch {
        /* ignore bad messages */
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] Client disconnected (${clients.size} total)`);
    });
  });

  // Start scanning for sessions
  scanAllProjects();
  setInterval(() => {
    scanAllProjects();
    cleanupStaleAgents();
  }, PROJECT_SCAN_INTERVAL_MS);

  server.listen(port, () => {
    console.log(`\n  Pixel Agents standalone server running at:`);
    console.log(`  http://localhost:${port}\n`);
    console.log(`  Watching all Claude Code sessions in ~/.claude/projects/`);
    console.log(`  Found ${agents.size} active session(s)\n`);
  });
}

function handleClientMessage(
  msg: Record<string, unknown>,
  assets: ReturnType<typeof loadAllAssets>,
): void {
  if (msg.type === 'webviewReady') {
    // Already handled on connection
  } else if (msg.type === 'saveLayout') {
    writeLayoutToFile(msg.layout as Record<string, unknown>);
  } else if (msg.type === 'saveAgentSeats') {
    // In standalone mode, seats are handled client-side (localStorage)
  } else if (msg.type === 'openClaude') {
    // Cannot spawn terminals in standalone mode - ignore
    console.log(
      '[Server] "Open Claude" not available in standalone mode - start claude from your terminal',
    );
  } else if (msg.type === 'focusAgent') {
    // Cannot focus terminal in standalone mode
  } else if (msg.type === 'closeAgent') {
    // Cannot close external terminal sessions
  } else if (msg.type === 'setSoundEnabled') {
    // Client-side only
  }
}

main();
