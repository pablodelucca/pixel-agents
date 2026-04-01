/**
 * Remote Agent Monitor Server
 *
 * Monitors Claude Code JSONL sessions and broadcasts status via WebSocket
 * Parses full history on startup + real-time updates
 */

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { join, basename } from 'path';
import { homedir } from 'os';
import { existsSync, readdirSync, readFileSync, statSync, watch } from 'fs';

const PORT = 3000;
const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

interface ToolState {
  toolId: string;
  toolName: string;
  startTime: number;
}

interface AgentState {
  id: string;
  projectDir: string;
  jsonlFile: string;
  lastOffset: number;
  lineBuffer: string;
  activeTools: Map<string, ToolState>;
  status: 'active' | 'waiting' | 'idle';
  lastActivity: number;
  cwd?: string;
}

// Connected clients
const clients = new Set<WebSocket>();

// Tracked agents
const agents = new Map<string, AgentState>();

// ── WebSocket Server ───────────────────────────────────────────────────────

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/health') {
    const agentStatus = Array.from(agents.entries()).map(([id, state]) => ({
      id,
      status: state.status,
      activeTools: Array.from(state.activeTools.values()).map(t => t.toolName),
      cwd: state.cwd,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', agents: agentStatus }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  clients.add(ws);

  // Send the list of all agent IDs first
  ws.send(JSON.stringify({ type: 'existingAgents', agents: Array.from(agents.keys()) }));

  // Then send each agent's state
  for (const [sessionId, state] of agents) {
    broadcastAgentState(sessionId, state, ws);
  }

  ws.on('close', () => {
    clients.delete(ws);
    console.log('[WS] Client disconnected');
  });
});

function broadcast(data: object) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function broadcastAgentState(sessionId: string, state: AgentState, ws?: WebSocket) {
  const sender = ws || { send: (msg: string) => broadcast(JSON.parse(msg)) };

  // Send agent creation
  const createMsg = {
    type: 'agentCreated',
    id: sessionId,
    folderName: state.cwd ? basename(state.cwd) : basename(state.projectDir),
  };

  // Send active tools
  for (const tool of state.activeTools.values()) {
    const toolMsg = {
      type: 'agentToolStart',
      id: sessionId,
      toolId: tool.toolId,
      status: tool.toolName,
    };
    if (ws) {
      ws.send(JSON.stringify(toolMsg));
    } else {
      broadcast(toolMsg);
    }
  }

  // Send status (always send, including idle)
  const statusMsg = {
    type: 'agentStatus',
    id: sessionId,
    status: state.status,
  };
  if (ws) {
    ws.send(JSON.stringify(statusMsg));
  } else {
    broadcast(statusMsg);
  }

  if (ws) {
    ws.send(JSON.stringify(createMsg));
  } else {
    broadcast(createMsg);
  }
}

// ── JSONL Parsing ───────────────────────────────────────────────────────────

function parseJsonlFile(filePath: string): { content: string; size: number } {
  if (!existsSync(filePath)) {
    return { content: '', size: 0 };
  }
  const content = readFileSync(filePath, 'utf8');
  return { content, size: content.length };
}

function parseAllLines(content: string): any[] {
  const lines = content.split('\n');
  const records: any[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Skip invalid lines
    }
  }

  return records;
}

function processRecord(sessionId: string, record: any, isHistory: boolean = false) {
  const state = agents.get(sessionId);
  if (!state) return;

  // Update cwd if present
  if (record.cwd) {
    state.cwd = record.cwd;
  }

  // assistant message with tool_use
  if (record.type === 'assistant' && record.message?.content) {
    const blocks = Array.isArray(record.message.content) ? record.message.content : [];

    for (const block of blocks) {
      if (block.type === 'tool_use') {
        const toolId = block.id;
        const toolName = block.name;

        // Skip if already tracking this tool
        if (!state.activeTools.has(toolId)) {
          state.activeTools.set(toolId, {
            toolId,
            toolName,
            startTime: record.timestamp ? new Date(record.timestamp).getTime() : Date.now(),
          });

          state.status = 'active';
          state.lastActivity = Date.now();

          if (!isHistory) {
            broadcast({
              type: 'agentToolStart',
              id: sessionId,
              toolId,
              status: toolName,
            });
            broadcast({
              type: 'agentStatus',
              id: sessionId,
              status: 'active',
            });
          }
        }
      }
    }
  }

  // user message with tool_result
  if (record.type === 'user' && record.message?.content) {
    const blocks = Array.isArray(record.message.content) ? record.message.content : [];

    for (const block of blocks) {
      if (block.type === 'tool_result') {
        const toolId = block.tool_use_id;

        // Remove the tool when we get a result (success or error)
        if (state.activeTools.has(toolId)) {
          state.activeTools.delete(toolId);

          if (!isHistory) {
            broadcast({
              type: 'agentToolDone',
              id: sessionId,
              toolId,
            });
          }
        }
      }
    }

    // If all tools are done, check if we should set to idle
    // Only set to idle if this wasn't an error result and no pending tools
    if (state.activeTools.size === 0) {
      // Check for error results - these usually mean the session was interrupted
      const hasError = blocks.some((b: any) => b.type === 'tool_result' && b.is_error);
      if (hasError) {
        // Error result without follow-up activity = interrupted session
        state.status = 'idle';
      }
    }
  }

  // system message with turn_duration (turn end)
  if (record.type === 'system' && record.subtype === 'turn_duration') {
    // Clear all tools at end of turn
    state.activeTools.clear();
    state.status = 'idle';
    state.lastActivity = Date.now();

    if (!isHistory) {
      broadcast({ type: 'agentToolsClear', id: sessionId });
      broadcast({ type: 'agentStatus', id: sessionId, status: 'idle' });
    }
  }

  // Detect waiting state (empty user message or permission request)
  if (record.type === 'user') {
    const content = record.message?.content;
    // Empty content or just permission-related content
    if (!content || (Array.isArray(content) && content.length === 0)) {
      state.status = 'waiting';
      state.lastActivity = Date.now();

      if (!isHistory) {
        broadcast({ type: 'agentStatus', id: sessionId, status: 'waiting' });
      }
    }
    // Check for permission denial/acceptance patterns
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_result' && typeof block.content === 'string') {
          if (block.content.includes('Permission denied') || block.content.includes('denied by user')) {
            // Permission was denied, clear waiting
            state.status = 'idle';
          }
        }
      }
    }
  }
}

function determineFinalState(sessionId: string) {
  const state = agents.get(sessionId);
  if (!state) return;

  // After parsing all history, determine the final state
  // If there are still active tools, check if they're stale
  if (state.activeTools.size > 0) {
    const now = Date.now();
    const STALE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

    // Check if any tool is stale (started more than 10 minutes ago)
    const hasActiveTools = Array.from(state.activeTools.values()).some(
      tool => (now - tool.startTime) < STALE_TIMEOUT_MS
    );

    if (hasActiveTools) {
      state.status = 'active';
    } else {
      // All tools are stale, session was interrupted
      console.log(`[Init] Session ${sessionId} has stale tools, marking as idle`);
      state.activeTools.clear();
      state.status = 'idle';
    }
  } else {
    // All tools done or no tools = idle
    state.status = 'idle';
  }
}

// ── Session Management ─────────────────────────────────────────────────────

function scanProjectsDir() {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) {
    console.log(`[Scan] Projects dir not found: ${CLAUDE_PROJECTS_DIR}`);
    return;
  }

  try {
    const projectDirs = readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });

    for (const dirent of projectDirs) {
      if (!dirent.isDirectory()) continue;

      const projectDir = join(CLAUDE_PROJECTS_DIR, dirent.name);

      try {
        const files = readdirSync(projectDir);

        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue;

          const sessionId = file.replace('.jsonl', '');
          const fullPath = join(projectDir, file);

          if (!agents.has(sessionId)) {
            console.log(`[Scan] Found new session: ${sessionId}`);
            initSession(sessionId, projectDir, fullPath);
          }
        }
      } catch (err) {
        // Skip directories we can't read
      }
    }
  } catch (err) {
    console.error('[Scan] Error scanning projects dir:', err);
  }
}

function initSession(sessionId: string, projectDir: string, jsonlFile: string) {
  const { content, size } = parseJsonlFile(jsonlFile);

  const state: AgentState = {
    id: sessionId,
    projectDir,
    jsonlFile,
    lastOffset: size,
    lineBuffer: '',
    activeTools: new Map(),
    status: 'idle',
    lastActivity: Date.now(),
  };

  agents.set(sessionId, state);

  // Parse all history
  const records = parseAllLines(content);
  console.log(`[Init] Parsing ${records.length} historical records for ${sessionId}`);

  for (const record of records) {
    processRecord(sessionId, record, true);
  }

  // Determine final state after history
  determineFinalState(sessionId);

  // Broadcast to clients
  const projectName = state.cwd ? basename(state.cwd) : basename(projectDir);
  broadcast({ type: 'agentCreated', id: sessionId, folderName: projectName });

  // Send current state
  for (const tool of state.activeTools.values()) {
    broadcast({
      type: 'agentToolStart',
      id: sessionId,
      toolId: tool.toolId,
      status: tool.toolName,
    });
  }

  if (state.status !== 'idle') {
    broadcast({ type: 'agentStatus', id: sessionId, status: state.status });
  }

  // Start watching for changes
  startWatching(sessionId);
}

function startWatching(sessionId: string) {
  const state = agents.get(sessionId);
  if (!state) return;

  try {
    const watcher = watch(state.jsonlFile, (eventType) => {
      if (eventType === 'change') {
        readNewLines(sessionId);
      }
    });

    watcher.on('error', (err) => {
      console.error(`[Watch] Error watching ${state.jsonlFile}:`, err);
    });
  } catch (err) {
    console.error(`[Watch] Cannot watch ${state.jsonlFile}:`, err);
  }
}

function readNewLines(sessionId: string) {
  const state = agents.get(sessionId);
  if (!state) return;

  try {
    const content = readFileSync(state.jsonlFile, 'utf8');

    if (content.length <= state.lastOffset) {
      return;
    }

    const newContent = content.slice(state.lastOffset);
    state.lastOffset = content.length;

    const fullContent = state.lineBuffer + newContent;
    const lines = fullContent.split('\n');
    state.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const record = JSON.parse(line);
        processRecord(sessionId, record, false);
      } catch {
        // Invalid JSON, skip
      }
    }
  } catch (err) {
    console.error(`[Read] Error reading ${state.jsonlFile}:`, err);
  }
}

function checkForRemovedSessions() {
  for (const [sessionId, state] of agents) {
    if (!existsSync(state.jsonlFile)) {
      console.log(`[Scan] Session removed: ${sessionId}`);
      agents.delete(sessionId);
      broadcast({ type: 'agentClosed', id: sessionId });
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  console.log(`[Server] Starting Remote Agent Monitor`);
  console.log(`[Server] Watching: ${CLAUDE_PROJECTS_DIR}`);
  console.log(`[Server] WebSocket port: ${PORT}`);

  // Initial scan - parses all history
  scanProjectsDir();

  // Report initial state
  console.log(`[Server] Found ${agents.size} sessions`);
  for (const [id, state] of agents) {
    console.log(`  - ${id}: ${state.status}, ${state.activeTools.size} active tools, cwd: ${state.cwd || 'unknown'}`);
  }

  // Periodic scan for new sessions (every 2 seconds)
  setInterval(scanProjectsDir, 2000);

  // Periodic check for removed sessions (every 5 seconds)
  setInterval(checkForRemovedSessions, 5000);

  server.listen(PORT, () => {
    console.log(`[Server] HTTP server listening on port ${PORT}`);
    console.log(`[Server] WebSocket ready at ws://localhost:${PORT}`);
    console.log(`[Server] Open http://localhost:5175?remote in browser to view`);
  });
}

main();