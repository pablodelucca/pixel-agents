import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { AgentAdapter } from './agentAdapter.js';
import { getAgentAdapterByName } from './agentAdapter.js';
import { FILE_WATCHER_POLL_INTERVAL_MS, PROJECT_SCAN_INTERVAL_MS } from './constants.js';
import { cancelPermissionTimer, cancelWaitingTimer, clearAgentActivity } from './timerManager.js';
import type { AgentBackend, AgentState } from './types.js';

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
  try {
    const watcher = fs.watch(filePath, () => {
      readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
    });
    fileWatchers.set(agentId, watcher);
  } catch (e) {
    console.log(`[Pixel Agents] fs.watch failed for agent ${agentId}: ${e}`);
  }

  try {
    fs.watchFile(filePath, { interval: FILE_WATCHER_POLL_INTERVAL_MS }, () => {
      readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
    });
  } catch (e) {
    console.log(`[Pixel Agents] fs.watchFile failed for agent ${agentId}: ${e}`);
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

    const text = agent.lineBuffer + buf.toString('utf-8');
    const lines = text.split('\n');
    agent.lineBuffer = lines.pop() || '';

    const hasLines = lines.some((l) => l.trim());
    if (hasLines) {
      cancelWaitingTimer(agentId, waitingTimers);
      cancelPermissionTimer(agentId, permissionTimers);
      if (agent.permissionSent) {
        agent.permissionSent = false;
        for (const activity of agent.activeToolActivities.values()) {
          activity.permissionState = 'granted';
        }
        for (const subActivities of agent.activeSubagentToolActivities.values()) {
          for (const activity of subActivities.values()) {
            activity.permissionState = 'granted';
          }
        }
        webview?.postMessage({ type: 'agentToolPermissionClear', id: agentId });
      }
      if (agent.isWaiting) {
        agent.isWaiting = false;
        agent.lastActivityAt = Date.now();
        agent.currentStatus = 'active';
        webview?.postMessage({
          type: 'agentStatus',
          id: agentId,
          status: 'active',
          source: 'heuristic',
          inferred: true,
          confidence: 'low',
        });
      }
    }

    const adapter = getAgentAdapterByName(agent.adapterName);
    for (const line of lines) {
      if (!line.trim()) continue;
      adapter.processTranscriptLine(agentId, line, {
        agents,
        waitingTimers,
        permissionTimers,
        webview,
      });
    }
  } catch (e) {
    console.log(`[Pixel Agents] Read error for agent ${agentId}: ${e}`);
  }
}

export function ensureProjectScan(
  projectDir: string,
  adapter: AgentAdapter,
  knownJsonlFiles: Set<string>,
  projectScanTimerRef: Map<string, ReturnType<typeof setInterval>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
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
  if (projectScanTimerRef.has(projectDir)) return;
  try {
    const files = adapter.findJsonlFiles(projectDir);
    for (const file of files) {
      const relevance = adapter.isRelevantToWorkspace(file, vscode.workspace.workspaceFolders);
      if (relevance !== null) {
        knownJsonlFiles.add(file);
      }
    }
  } catch {
    /* dir may not exist yet */
  }

  const timer = setInterval(() => {
    scanForNewJsonlFiles(
      projectDir,
      adapter,
      knownJsonlFiles,
      activeAgentIdRef,
      nextAgentIdRef,
      agents,
      fileWatchers,
      pollingTimers,
      jsonlPollTimers,
      waitingTimers,
      permissionTimers,
      webview,
      persistAgents,
    );
  }, PROJECT_SCAN_INTERVAL_MS);
  projectScanTimerRef.set(projectDir, timer);
}

function scanForNewJsonlFiles(
  projectDir: string,
  adapter: AgentAdapter,
  knownJsonlFiles: Set<string>,
  activeAgentIdRef: { current: number | null },
  nextAgentIdRef: { current: number },
  agents: Map<number, AgentState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
  persistAgents: () => void,
): void {
  let files: string[];
  try {
    files = adapter.findJsonlFiles(projectDir);
  } catch {
    return;
  }

  for (const file of files) {
    if (knownJsonlFiles.has(file)) {
      continue;
    }

    const relevance = adapter.isRelevantToWorkspace(file, vscode.workspace.workspaceFolders);
    if (relevance === false) {
      knownJsonlFiles.add(file);
      continue;
    }
    if (relevance === null) {
      continue;
    }

    const activeTerminal = vscode.window.activeTerminal;
    let activeTerminalOwnerId: number | null = null;
    if (activeTerminal) {
      for (const [id, agent] of agents) {
        if (agent.terminalRef === activeTerminal) {
          activeTerminalOwnerId = id;
          break;
        }
      }
    }

    if (activeAgentIdRef.current !== null) {
      console.log(
        `[Pixel Agents] New JSONL detected: ${path.basename(file)}, reassigning to agent ${activeAgentIdRef.current}`,
      );
      knownJsonlFiles.add(file);
      reassignAgentToFile(
        activeAgentIdRef.current,
        adapter.name,
        projectDir,
        file,
        agents,
        fileWatchers,
        pollingTimers,
        jsonlPollTimers,
        waitingTimers,
        permissionTimers,
        webview,
        persistAgents,
      );
      continue;
    }

    if (activeTerminalOwnerId !== null) {
      console.log(
        `[Pixel Agents] New JSONL detected: ${path.basename(file)}, reassigning to focused agent ${activeTerminalOwnerId}`,
      );
      activeAgentIdRef.current = activeTerminalOwnerId;
      knownJsonlFiles.add(file);
      reassignAgentToFile(
        activeTerminalOwnerId,
        adapter.name,
        projectDir,
        file,
        agents,
        fileWatchers,
        pollingTimers,
        jsonlPollTimers,
        waitingTimers,
        permissionTimers,
        webview,
        persistAgents,
      );
      continue;
    }

    if (activeTerminal) {
      console.log(
        `[Pixel Agents] New JSONL detected: ${path.basename(file)}, adopting focused terminal "${activeTerminal.name}"`,
      );
      knownJsonlFiles.add(file);
      adoptTerminalForFile(
        activeTerminal,
        adapter.name,
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
      continue;
    }

    // No adoption target available — mark as known to avoid repeated I/O
    knownJsonlFiles.add(file);
  }
}

function adoptTerminalForFile(
  terminal: vscode.Terminal,
  adapterName: AgentBackend,
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
    adapterName,
    projectDir,
    jsonlFile,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeToolActivities: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    activeSubagentToolActivities: new Map(),
    lastActivityAt: Date.now(),
    currentStatus: 'active',
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
  adapterName: AgentBackend,
  projectDir: string,
  newFilePath: string,
  agents: Map<number, AgentState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
  persistAgents: () => void,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  const jsonlPollTimer = jsonlPollTimers.get(agentId);
  if (jsonlPollTimer) {
    clearInterval(jsonlPollTimer);
  }
  jsonlPollTimers.delete(agentId);

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

  cancelWaitingTimer(agentId, waitingTimers);
  cancelPermissionTimer(agentId, permissionTimers);
  clearAgentActivity(agent, agentId, permissionTimers, webview);

  agent.adapterName = adapterName;
  agent.projectDir = projectDir;
  agent.jsonlFile = newFilePath;
  agent.fileOffset = 0;
  agent.lineBuffer = '';
  persistAgents();

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
