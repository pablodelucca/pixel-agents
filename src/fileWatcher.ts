import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  ACTIVE_JSONL_MAX_AGE_MS,
  ACTIVE_JSONL_MIN_SIZE,
  FILE_WATCHER_POLL_INTERVAL_MS,
  GLOBAL_SCAN_INTERVAL_MS,
  PROJECT_SCAN_INTERVAL_MS,
} from './constants.js';
import { cancelPermissionTimer, cancelWaitingTimer, clearAgentActivity } from './timerManager.js';
import { processTranscriptLine } from './transcriptParser.js';
import type { AgentState } from './types.js';

export function startFileWatching(
  agentId: number,
  filePath: string,
  agents: Map<number, AgentState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
  // Primary: fs.watch (unreliable on macOS — may miss events)
  try {
    const watcher = fs.watch(filePath, () => {
      readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
    });
    fileWatchers.set(agentId, watcher);
  } catch (e) {
    console.log(`[Pixel Agents] fs.watch failed for agent ${agentId}: ${e}`);
  }

  // Secondary: fs.watchFile (stat-based polling, reliable on macOS)
  try {
    fs.watchFile(filePath, { interval: FILE_WATCHER_POLL_INTERVAL_MS }, () => {
      readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
    });
  } catch (e) {
    console.log(`[Pixel Agents] fs.watchFile failed for agent ${agentId}: ${e}`);
  }

  // Tertiary: manual poll as last resort
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
    readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
  }, FILE_WATCHER_POLL_INTERVAL_MS);
  pollingTimers.set(agentId, interval);
}

export function readNewLines(
  agentId: number,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
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

    // Track activity for headless auto-despawn
    agent.lastActivityMs = Date.now();

    const text = agent.lineBuffer + buf.toString('utf-8');
    const lines = text.split('\n');
    agent.lineBuffer = lines.pop() || '';

    const hasLines = lines.some((l) => l.trim());
    if (hasLines) {
      // New data arriving — cancel timers (data flowing means agent is still active)
      cancelWaitingTimer(agentId, waitingTimers);
      cancelPermissionTimer(agentId, permissionTimers);
      if (agent.permissionSent) {
        agent.permissionSent = false;
        webview?.postMessage({ type: 'agentToolPermissionClear', id: agentId });
      }
    }

    for (const line of lines) {
      if (!line.trim()) continue;
      processTranscriptLine(agentId, line, agents, waitingTimers, permissionTimers, webview);
    }
  } catch (e) {
    console.log(`[Pixel Agents] Read error for agent ${agentId}: ${e}`);
  }
}

// ── Legacy project-level scanning (kept for /clear reassignment) ────

export function ensureProjectScan(
  projectDir: string,
  knownJsonlFiles: Set<string>,
  projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
  activeAgentIdRef: { current: number | null },
  nextAgentIdRef: { current: number },
  agents: Map<number, AgentState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
  persistAgents: () => void,
): void {
  if (projectScanTimerRef.current) return;
  // Seed with all existing JSONL files so we only react to truly new ones
  try {
    const files = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(projectDir, f));
    for (const f of files) {
      knownJsonlFiles.add(f);
    }
  } catch {
    /* dir may not exist yet */
  }

  projectScanTimerRef.current = setInterval(() => {
    scanForNewJsonlFiles(
      projectDir,
      knownJsonlFiles,
      activeAgentIdRef,
      nextAgentIdRef,
      agents,
      fileWatchers,
      pollingTimers,
      waitingTimers,
      permissionTimers,
      webview,
      persistAgents,
    );
  }, PROJECT_SCAN_INTERVAL_MS);
}

function scanForNewJsonlFiles(
  projectDir: string,
  knownJsonlFiles: Set<string>,
  activeAgentIdRef: { current: number | null },
  nextAgentIdRef: { current: number },
  agents: Map<number, AgentState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
  persistAgents: () => void,
): void {
  let files: string[];
  try {
    files = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(projectDir, f));
  } catch {
    return;
  }

  for (const file of files) {
    if (!knownJsonlFiles.has(file)) {
      knownJsonlFiles.add(file);
      if (activeAgentIdRef.current !== null) {
        // Active agent focused → /clear reassignment
        console.log(
          `[Pixel Agents] New JSONL detected: ${path.basename(file)}, reassigning to agent ${activeAgentIdRef.current}`,
        );
        reassignAgentToFile(
          activeAgentIdRef.current,
          file,
          agents,
          fileWatchers,
          pollingTimers,
          waitingTimers,
          permissionTimers,
          webview,
          persistAgents,
        );
      } else {
        // No active agent → try to adopt any unowned terminal
        for (const terminal of vscode.window.terminals) {
          let owned = false;
          for (const agent of agents.values()) {
            if (agent.terminalRef === terminal) {
              owned = true;
              break;
            }
          }
          if (!owned) {
            adoptTerminalForFile(
              terminal,
              file,
              projectDir,
              nextAgentIdRef,
              agents,
              activeAgentIdRef,
              fileWatchers,
              pollingTimers,
              waitingTimers,
              permissionTimers,
              webview,
              persistAgents,
            );
            break;
          }
        }
      }
    }
  }
}

function adoptTerminalForFile(
  terminal: vscode.Terminal,
  jsonlFile: string,
  projectDir: string,
  nextAgentIdRef: { current: number },
  agents: Map<number, AgentState>,
  activeAgentIdRef: { current: number | null },
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
  persistAgents: () => void,
): void {
  const id = nextAgentIdRef.current++;
  const agent: AgentState = {
    id,
    terminalRef: terminal,
    projectDir,
    jsonlFile,
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
  };

  agents.set(id, agent);
  activeAgentIdRef.current = id;
  persistAgents();

  console.log(
    `[Pixel Agents] Agent ${id}: adopted terminal "${terminal.name}" for ${path.basename(jsonlFile)}`,
  );
  webview?.postMessage({ type: 'agentCreated', id });

  startFileWatching(
    id,
    jsonlFile,
    agents,
    fileWatchers,
    pollingTimers,
    waitingTimers,
    permissionTimers,
    webview,
  );
  readNewLines(id, agents, waitingTimers, permissionTimers, webview);
}

export function reassignAgentToFile(
  agentId: number,
  newFilePath: string,
  agents: Map<number, AgentState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
  persistAgents: () => void,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  // Stop old file watching
  fileWatchers.get(agentId)?.close();
  fileWatchers.delete(agentId);
  const pt = pollingTimers.get(agentId);
  if (pt) {
    clearInterval(pt);
  }
  pollingTimers.delete(agentId);
  try {
    fs.unwatchFile(agent.jsonlFile);
  } catch {
    /* ignore */
  }

  // Clear activity
  cancelWaitingTimer(agentId, waitingTimers);
  cancelPermissionTimer(agentId, permissionTimers);
  clearAgentActivity(agent, agentId, permissionTimers, webview);

  // Swap to new file
  agent.jsonlFile = newFilePath;
  agent.fileOffset = 0;
  agent.lineBuffer = '';
  persistAgents();

  // Start watching new file
  startFileWatching(
    agentId,
    newFilePath,
    agents,
    fileWatchers,
    pollingTimers,
    waitingTimers,
    permissionTimers,
    webview,
  );
  readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
}

// ── Global Agent Discovery ──────────────────────────────────────────

/**
 * Check if a JSONL file represents an active Claude session.
 * Active = file is >3KB AND was modified within the last 10 minutes.
 */
function isActiveJsonl(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return (
      stat.size >= ACTIVE_JSONL_MIN_SIZE && Date.now() - stat.mtimeMs < ACTIVE_JSONL_MAX_AGE_MS
    );
  } catch {
    return false;
  }
}

/**
 * Check if a JSONL file is already being tracked by any agent.
 */
function isTrackedByAgent(filePath: string, agents: Map<number, AgentState>): boolean {
  for (const agent of agents.values()) {
    if (agent.jsonlFile === filePath) return true;
  }
  return false;
}

/**
 * Derive a human-readable folder name from a Claude project directory name.
 * e.g. "-home-cmdshadow-shadowops-bot" → "shadowops-bot"
 */
function folderNameFromProjectDir(dirName: string): string {
  // Strip leading dashes and common home prefix
  const parts = dirName.replace(/^-+/, '').split('-');
  // Skip "home" and username parts, return the rest
  // Typical: home-cmdshadow-GuildScout → GuildScout
  if (parts.length >= 3 && parts[0] === 'home') {
    return parts.slice(2).join('-') || parts[parts.length - 1];
  }
  return dirName;
}

/**
 * Scan all directories under ~/.claude/projects/ for active JSONL files
 * and create headless agents for any that aren't already tracked.
 * Also scans session subdirectories for subagent JSONL files.
 */
export function globalScanForAgents(
  knownJsonlFiles: Set<string>,
  nextAgentIdRef: { current: number },
  agents: Map<number, AgentState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
  persistAgents: () => void,
): void {
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  let projectDirs: string[];
  try {
    projectDirs = fs
      .readdirSync(projectsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return;
  }

  for (const dirName of projectDirs) {
    const dirPath = path.join(projectsRoot, dirName);
    const folderName = folderNameFromProjectDir(dirName);

    // 1. Scan top-level JSONL files
    try {
      const files = fs
        .readdirSync(dirPath, { withFileTypes: true })
        .filter((f) => f.isFile() && f.name.endsWith('.jsonl'))
        .map((f) => path.join(dirPath, f.name));

      for (const file of files) {
        if (knownJsonlFiles.has(file)) continue;
        if (!isActiveJsonl(file)) continue;
        if (isTrackedByAgent(file, agents)) continue;

        // New active JSONL — create headless agent
        knownJsonlFiles.add(file);
        createHeadlessAgent(
          file,
          dirPath,
          folderName,
          nextAgentIdRef,
          agents,
          fileWatchers,
          pollingTimers,
          waitingTimers,
          permissionTimers,
          webview,
          persistAgents,
        );
      }
    } catch {
      /* dir may not be readable */
    }

    // 2. Scan session subdirectories for subagent JSONL files
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subagentDir = path.join(dirPath, entry.name, 'subagents');
        try {
          if (!fs.existsSync(subagentDir)) continue;
          const subFiles = fs
            .readdirSync(subagentDir)
            .filter((f) => f.endsWith('.jsonl'))
            .map((f) => path.join(subagentDir, f));

          for (const subFile of subFiles) {
            if (knownJsonlFiles.has(subFile)) continue;
            if (!isActiveJsonl(subFile)) continue;
            if (isTrackedByAgent(subFile, agents)) continue;

            knownJsonlFiles.add(subFile);
            createHeadlessAgent(
              subFile,
              dirPath,
              `${folderName} (subagent)`,
              nextAgentIdRef,
              agents,
              fileWatchers,
              pollingTimers,
              waitingTimers,
              permissionTimers,
              webview,
              persistAgents,
            );
          }
        } catch {
          /* subagent dir may not exist */
        }
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * Create a headless agent (no terminal) for a discovered JSONL file.
 */
function createHeadlessAgent(
  jsonlFile: string,
  projectDir: string,
  folderName: string,
  nextAgentIdRef: { current: number },
  agents: Map<number, AgentState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
  persistAgents: () => void,
): void {
  const id = nextAgentIdRef.current++;
  const agent: AgentState = {
    id,
    isHeadless: true,
    projectDir,
    jsonlFile,
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
    folderName,
    lastActivityMs: Date.now(),
  };

  agents.set(id, agent);
  persistAgents();

  console.log(
    `[Pixel Agents] Agent ${id}: headless agent for ${path.basename(jsonlFile)} (${folderName})`,
  );
  webview?.postMessage({ type: 'agentCreated', id, folderName });

  // Start watching — read from beginning to catch up on tool state
  startFileWatching(
    id,
    jsonlFile,
    agents,
    fileWatchers,
    pollingTimers,
    waitingTimers,
    permissionTimers,
    webview,
  );
  readNewLines(id, agents, waitingTimers, permissionTimers, webview);
}

/**
 * Check all headless agents for inactivity and despawn those whose
 * JSONL files haven't grown for HEADLESS_INACTIVITY_TIMEOUT_MS.
 */
export function checkHeadlessActivity(
  agents: Map<number, AgentState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  webview: vscode.Webview | undefined,
  persistAgents: () => void,
  timeoutMs: number,
): void {
  const now = Date.now();
  const toRemove: number[] = [];

  for (const [id, agent] of agents) {
    if (!agent.isHeadless) continue;

    // Check if JSONL is still being written to
    try {
      const stat = fs.statSync(agent.jsonlFile);
      if (now - stat.mtimeMs < timeoutMs) {
        agent.lastActivityMs = now;
        continue;
      }
    } catch {
      // File gone — mark for removal
    }

    // Check last known activity
    const lastActivity = agent.lastActivityMs || 0;
    if (now - lastActivity > timeoutMs) {
      toRemove.push(id);
    }
  }

  for (const id of toRemove) {
    console.log(`[Pixel Agents] Agent ${id}: headless agent inactive, despawning`);
    // Remove agent (reuse existing removeAgent logic)
    const agent = agents.get(id);
    if (!agent) continue;

    fileWatchers.get(id)?.close();
    fileWatchers.delete(id);
    const pt = pollingTimers.get(id);
    if (pt) clearInterval(pt);
    pollingTimers.delete(id);
    try {
      fs.unwatchFile(agent.jsonlFile);
    } catch {
      /* ignore */
    }
    cancelWaitingTimer(id, waitingTimers);
    cancelPermissionTimer(id, permissionTimers);
    agents.delete(id);
    persistAgents();
    webview?.postMessage({ type: 'agentClosed', id });
  }
}
