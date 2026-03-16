import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { FILE_WATCHER_POLL_INTERVAL_MS } from './constants.js';
import {
  createOpenClawAgentState,
  findActiveSession,
  getOpenClawAgents,
  loadOpenClawConfig,
  OPENCLAW_CONFIG_FILE,
} from './openclawLoader.js';
import { processOpenClawLine } from './openclawParser.js';
import type { OpenClawAgentState } from './openclawTypes.js';

const SESSION_CHECK_INTERVAL_MS = 5000;

export interface OpenClawWatchState {
  agents: Map<number, OpenClawAgentState>;
  fileWatchers: Map<number, fs.FSWatcher>;
  pollingTimers: Map<number, ReturnType<typeof setInterval>>;
  sessionCheckTimers: Map<number, ReturnType<typeof setInterval>>;
  webview: { postMessage: (msg: unknown) => void } | undefined;
  configWatchTimer: ReturnType<typeof setInterval> | null;
  lastConfigMtime: number;
}

/**
 * Initialize OpenClaw watching
 */
export function initOpenClawWatching(
  webview: { postMessage: (msg: unknown) => void } | undefined,
): OpenClawWatchState {
  const state: OpenClawWatchState = {
    agents: new Map(),
    fileWatchers: new Map(),
    pollingTimers: new Map(),
    sessionCheckTimers: new Map(),
    webview,
    configWatchTimer: null,
    lastConfigMtime: 0,
  };

  // Initial load
  loadAgentsFromConfig(state);

  // Watch config for changes (new agents added/removed)
  startConfigWatching(state);

  return state;
}

/**
 * Load agents from OpenClaw config
 */
export function loadAgentsFromConfig(state: OpenClawWatchState): void {
  const config = loadOpenClawConfig();
  if (!config) {
    console.log('[Pixel Agents] No OpenClaw config found');
    return;
  }

  const agentConfigs = getOpenClawAgents(config);
  const existingOpenClawIds = new Set(Array.from(state.agents.values()).map((a) => a.openClawId));
  const configIds = new Set(agentConfigs.map((a) => a.id));

  // Remove agents that no longer exist in config
  for (const [numericId, agent] of state.agents) {
    if (!configIds.has(agent.openClawId)) {
      console.log(`[Pixel Agents] Removing agent ${agent.openClawId} (no longer in config)`);
      stopWatchingAgent(state, numericId);
      state.agents.delete(numericId);
      state.webview?.postMessage({ type: 'agentClosed', id: numericId });
    }
  }

  // Add new agents
  let nextId = Math.max(0, ...Array.from(state.agents.keys())) + 1;
  for (const agentConfig of agentConfigs) {
    if (!existingOpenClawIds.has(agentConfig.id)) {
      const id = nextId++;
      const agent = createOpenClawAgentState(id, agentConfig);
      state.agents.set(id, agent);
      console.log(`[Pixel Agents] Added OpenClaw agent ${id}: ${agent.emoji} ${agent.name}`);

      // Notify webview
      state.webview?.postMessage({
        type: 'openClawAgentCreated',
        id,
        openClawId: agent.openClawId,
        name: agent.name,
        emoji: agent.emoji,
      });

      // Start watching for sessions
      startSessionWatching(state, id);
    }
  }
}

/**
 * Watch OpenClaw config file for changes
 */
function startConfigWatching(state: OpenClawWatchState): void {
  const checkConfig = () => {
    try {
      const stat = fs.statSync(OPENCLAW_CONFIG_FILE);
      if (stat.mtime.getTime() > state.lastConfigMtime) {
        state.lastConfigMtime = stat.mtime.getTime();
        console.log('[Pixel Agents] OpenClaw config changed, reloading agents');
        loadAgentsFromConfig(state);
      }
    } catch {
      // Config might not exist yet
    }
  };

  // Initial mtime
  try {
    const stat = fs.statSync(OPENCLAW_CONFIG_FILE);
    state.lastConfigMtime = stat.mtime.getTime();
  } catch {
    // ignore
  }

  state.configWatchTimer = setInterval(checkConfig, 5000);
}

/**
 * Start watching for session files for an agent
 */
function startSessionWatching(state: OpenClawWatchState, agentId: number): void {
  const agent = state.agents.get(agentId);
  if (!agent) return;

  const checkSession = () => {
    const sessionFile = findActiveSession(agent.openClawId);

    if (sessionFile && sessionFile !== agent.activeSessionFile) {
      console.log(`[Pixel Agents] Agent ${agentId} new session: ${path.basename(sessionFile)}`);

      // Stop watching old session
      if (agent.activeSessionFile) {
        stopWatchingSessionFile(state, agentId);
      }

      // Start watching new session
      agent.activeSessionFile = sessionFile;
      agent.fileOffset = 0;
      agent.lineBuffer = '';
      startWatchingSessionFile(state, agentId, sessionFile);
    }
  };

  // Initial check
  checkSession();

  // Periodic check for new sessions
  const timer = setInterval(checkSession, SESSION_CHECK_INTERVAL_MS);
  state.sessionCheckTimers.set(agentId, timer);
}

/**
 * Start watching a specific session file
 */
function startWatchingSessionFile(
  state: OpenClawWatchState,
  agentId: number,
  filePath: string,
): void {
  const agent = state.agents.get(agentId);
  if (!agent) return;

  // Get current file size to skip existing content
  try {
    const stat = fs.statSync(filePath);
    agent.fileOffset = stat.size;
  } catch {
    agent.fileOffset = 0;
  }

  // Primary: fs.watch
  try {
    const watcher = fs.watch(filePath, () => {
      readNewSessionLines(state, agentId);
    });
    state.fileWatchers.set(agentId, watcher);
  } catch (e) {
    console.log(`[Pixel Agents] fs.watch failed for agent ${agentId}: ${e}`);
  }

  // Secondary: polling
  const timer = setInterval(() => {
    readNewSessionLines(state, agentId);
  }, FILE_WATCHER_POLL_INTERVAL_MS);
  state.pollingTimers.set(agentId, timer);

  // Read any new lines immediately
  readNewSessionLines(state, agentId);
}

/**
 * Read new lines from session file
 */
function readNewSessionLines(state: OpenClawWatchState, agentId: number): void {
  const agent = state.agents.get(agentId);
  if (!agent || !agent.activeSessionFile) return;

  try {
    const stat = fs.statSync(agent.activeSessionFile);
    if (stat.size <= agent.fileOffset) return;

    const buf = Buffer.alloc(stat.size - agent.fileOffset);
    const fd = fs.openSync(agent.activeSessionFile, 'r');
    fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
    fs.closeSync(fd);
    agent.fileOffset = stat.size;

    const text = agent.lineBuffer + buf.toString('utf-8');
    const lines = text.split('\n');
    agent.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      processOpenClawLine(agentId, line, state.agents, state.webview);
    }
  } catch (e) {
    console.log(`[Pixel Agents] Read error for agent ${agentId}: ${e}`);
  }
}

/**
 * Stop watching session file for an agent
 */
function stopWatchingSessionFile(state: OpenClawWatchState, agentId: number): void {
  state.fileWatchers.get(agentId)?.close();
  state.fileWatchers.delete(agentId);

  const timer = state.pollingTimers.get(agentId);
  if (timer) {
    clearInterval(timer);
    state.pollingTimers.delete(agentId);
  }
}

/**
 * Stop watching an agent completely
 */
function stopWatchingAgent(state: OpenClawWatchState, agentId: number): void {
  stopWatchingSessionFile(state, agentId);

  const sessionTimer = state.sessionCheckTimers.get(agentId);
  if (sessionTimer) {
    clearInterval(sessionTimer);
    state.sessionCheckTimers.delete(agentId);
  }
}

/**
 * Cleanup all watchers
 */
export function cleanupOpenClawWatching(state: OpenClawWatchState): void {
  if (state.configWatchTimer) {
    clearInterval(state.configWatchTimer);
  }

  for (const agentId of state.agents.keys()) {
    stopWatchingAgent(state, agentId);
  }

  state.agents.clear();
}

/**
 * Send existing agent info to webview
 */
export function sendOpenClawAgents(
  state: OpenClawWatchState,
  webview: { postMessage: (msg: unknown) => void } | undefined,
): void {
  if (!webview) return;

  const agentInfos: Array<{
    id: number;
    openClawId: string;
    name: string;
    emoji: string;
  }> = [];

  for (const [id, agent] of state.agents) {
    agentInfos.push({
      id,
      openClawId: agent.openClawId,
      name: agent.name,
      emoji: agent.emoji,
    });
  }

  webview.postMessage({
    type: 'openClawAgents',
    agents: agentInfos,
  });

  // Send current statuses
  for (const [agentId, agent] of state.agents) {
    for (const [toolId, status] of agent.activeToolStatuses) {
      webview.postMessage({
        type: 'agentToolStart',
        id: agentId,
        toolId,
        status,
      });
    }
    if (agent.isWaiting) {
      webview.postMessage({
        type: 'agentStatus',
        id: agentId,
        status: 'waiting',
      });
    }
  }
}
