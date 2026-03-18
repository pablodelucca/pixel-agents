import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { AgentAdapter } from './agentAdapter.js';
import { getAgentAdapterByName } from './agentAdapter.js';
import {
  JSONL_POLL_INTERVAL_MS,
  WORKSPACE_KEY_AGENT_SEATS,
  WORKSPACE_KEY_AGENTS,
} from './constants.js';
import { ensureProjectScan, readNewLines, startFileWatching } from './fileWatcher.js';
import { migrateAndLoadLayout } from './layoutPersistence.js';
import { cancelPermissionTimer, cancelWaitingTimer } from './timerManager.js';
import type { AgentBackend, AgentState, PersistedAgent } from './types.js';

export function getProjectDirPath(adapter: AgentAdapter, cwd?: string): string | null {
  const workspacePath = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) return null;
  const projectDir = adapter.getProjectDirPath(workspacePath);
  console.log(
    `[Pixel Agents] ${adapter.displayName} project dir: ${workspacePath} → ${projectDir}`,
  );
  return projectDir;
}

export async function launchNewTerminal(
  adapter: AgentAdapter,
  nextAgentIdRef: { current: number },
  nextTerminalIndexRef: { current: number },
  agents: Map<number, AgentState>,
  activeAgentIdRef: { current: number | null },
  knownJsonlFiles: Set<string>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  projectScanTimerRef: Map<string, ReturnType<typeof setInterval>>,
  webview: vscode.Webview | undefined,
  persistAgents: () => void,
  folderPath?: string,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  const cwd = folderPath || folders?.[0]?.uri.fsPath;
  const projectDir = getProjectDirPath(adapter, cwd);
  if (!projectDir) {
    console.log(`[Pixel Agents] No project dir, cannot track agent`);
    void vscode.window.showWarningMessage(
      `Pixel Agents: Open the project folder in this VS Code window before launching a ${adapter.displayName} agent.`,
    );
    return;
  }

  const isMultiRoot = !!(folders && folders.length > 1);
  const idx = nextTerminalIndexRef.current++;
  const terminal = vscode.window.createTerminal({
    name: `${adapter.terminalNamePrefix} #${idx}`,
    cwd,
  });
  terminal.show();

  const sessionId = crypto.randomUUID();
  terminal.sendText(adapter.getTerminalCommand(sessionId));

  const id = nextAgentIdRef.current++;
  const folderName = isMultiRoot && cwd ? path.basename(cwd) : undefined;
  const expectedJsonlFile = adapter.getExpectedJsonlFile(projectDir, sessionId);
  if (expectedJsonlFile) {
    knownJsonlFiles.add(expectedJsonlFile);
  }
  const jsonlFile = expectedJsonlFile || path.join(projectDir, `pending-${id}.jsonl`);

  const agent: AgentState = {
    id,
    terminalRef: terminal,
    adapterName: adapter.name,
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
  };

  agents.set(id, agent);
  activeAgentIdRef.current = id;
  persistAgents();
  console.log(`[Pixel Agents] Agent ${id}: created for terminal ${terminal.name}`);
  webview?.postMessage({ type: 'agentCreated', id, folderName });

  ensureProjectScan(
    projectDir,
    adapter,
    knownJsonlFiles,
    projectScanTimerRef,
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

  if (expectedJsonlFile) {
    const pollTimer = setInterval(() => {
      try {
        if (fs.existsSync(agent.jsonlFile)) {
          console.log(
            `[Pixel Agents] Agent ${id}: found JSONL file ${path.basename(agent.jsonlFile)}`,
          );
          clearInterval(pollTimer);
          jsonlPollTimers.delete(id);
          startFileWatching(
            id,
            agent.jsonlFile,
            agents,
            fileWatchers,
            pollingTimers,
            waitingTimers,
            permissionTimers,
            webview,
          );
          readNewLines(id, agents, waitingTimers, permissionTimers, webview);
        }
      } catch {
        /* file may not exist yet */
      }
    }, JSONL_POLL_INTERVAL_MS);
    jsonlPollTimers.set(id, pollTimer);
  }
}

export function removeAgent(
  agentId: number,
  agents: Map<number, AgentState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  persistAgents: () => void,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  const jpTimer = jsonlPollTimers.get(agentId);
  if (jpTimer) {
    clearInterval(jpTimer);
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

  agents.delete(agentId);
  persistAgents();
}

export function persistAgents(
  agents: Map<number, AgentState>,
  context: vscode.ExtensionContext,
): void {
  const persisted: PersistedAgent[] = [];
  for (const agent of agents.values()) {
    persisted.push({
      id: agent.id,
      terminalName: agent.terminalRef.name,
      adapterName: agent.adapterName,
      jsonlFile: agent.jsonlFile,
      projectDir: agent.projectDir,
      folderName: agent.folderName,
    });
  }
  context.workspaceState.update(WORKSPACE_KEY_AGENTS, persisted);
}

export function restoreAgents(
  context: vscode.ExtensionContext,
  nextAgentIdRef: { current: number },
  nextTerminalIndexRef: { current: number },
  agents: Map<number, AgentState>,
  knownJsonlFiles: Set<string>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  projectScanTimerRef: Map<string, ReturnType<typeof setInterval>>,
  activeAgentIdRef: { current: number | null },
  webview: vscode.Webview | undefined,
  doPersist: () => void,
): void {
  const persisted = context.workspaceState.get<PersistedAgent[]>(WORKSPACE_KEY_AGENTS, []);
  if (persisted.length === 0) return;

  const liveTerminals = vscode.window.terminals;
  let maxId = 0;
  let maxIdx = 0;
  let restoredProjectDir: string | null = null;
  let restoredAdapterName: AgentBackend | null = null;

  for (const p of persisted) {
    const terminal = liveTerminals.find((t) => t.name === p.terminalName);
    if (!terminal) continue;

    const adapterName = p.adapterName ?? 'codex';
    const agent: AgentState = {
      id: p.id,
      terminalRef: terminal,
      adapterName,
      projectDir: p.projectDir,
      jsonlFile: p.jsonlFile,
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
      folderName: p.folderName,
    };

    agents.set(p.id, agent);
    knownJsonlFiles.add(p.jsonlFile);
    console.log(`[Pixel Agents] Restored agent ${p.id} → terminal "${p.terminalName}"`);

    if (p.id > maxId) maxId = p.id;
    const match = p.terminalName.match(/#(\d+)$/);
    if (match) {
      const idx = parseInt(match[1], 10);
      if (idx > maxIdx) maxIdx = idx;
    }

    restoredProjectDir = p.projectDir;
    restoredAdapterName = adapterName;

    try {
      if (fs.existsSync(p.jsonlFile)) {
        const stat = fs.statSync(p.jsonlFile);
        agent.fileOffset = stat.size;
        startFileWatching(
          p.id,
          p.jsonlFile,
          agents,
          fileWatchers,
          pollingTimers,
          waitingTimers,
          permissionTimers,
          webview,
        );
      } else {
        const pollTimer = setInterval(() => {
          try {
            if (fs.existsSync(agent.jsonlFile)) {
              console.log(`[Pixel Agents] Restored agent ${p.id}: found JSONL file`);
              clearInterval(pollTimer);
              jsonlPollTimers.delete(p.id);
              const stat = fs.statSync(agent.jsonlFile);
              agent.fileOffset = stat.size;
              startFileWatching(
                p.id,
                agent.jsonlFile,
                agents,
                fileWatchers,
                pollingTimers,
                waitingTimers,
                permissionTimers,
                webview,
              );
            }
          } catch {
            /* file may not exist yet */
          }
        }, JSONL_POLL_INTERVAL_MS);
        jsonlPollTimers.set(p.id, pollTimer);
      }
    } catch {
      /* ignore errors during restore */
    }
  }

  if (maxId >= nextAgentIdRef.current) {
    nextAgentIdRef.current = maxId + 1;
  }
  if (maxIdx >= nextTerminalIndexRef.current) {
    nextTerminalIndexRef.current = maxIdx + 1;
  }

  doPersist();

  if (restoredProjectDir && restoredAdapterName) {
    ensureProjectScan(
      restoredProjectDir,
      getAgentAdapterByName(restoredAdapterName),
      knownJsonlFiles,
      projectScanTimerRef,
      activeAgentIdRef,
      nextAgentIdRef,
      agents,
      fileWatchers,
      pollingTimers,
      waitingTimers,
      permissionTimers,
      webview,
      doPersist,
    );
  }
}

export function sendExistingAgents(
  agents: Map<number, AgentState>,
  context: vscode.ExtensionContext,
  webview: vscode.Webview | undefined,
): void {
  if (!webview) return;
  const agentIds: number[] = [];
  for (const id of agents.keys()) {
    agentIds.push(id);
  }
  agentIds.sort((a, b) => a - b);

  const agentMeta = context.workspaceState.get<
    Record<string, { palette?: number; seatId?: string }>
  >(WORKSPACE_KEY_AGENT_SEATS, {});

  const folderNames: Record<number, string> = {};
  for (const [id, agent] of agents) {
    if (agent.folderName) {
      folderNames[id] = agent.folderName;
    }
  }
  console.log(
    `[Pixel Agents] sendExistingAgents: agents=${JSON.stringify(agentIds)}, meta=${JSON.stringify(agentMeta)}`,
  );

  webview.postMessage({
    type: 'existingAgents',
    agents: agentIds,
    agentMeta,
    folderNames,
  });

  sendCurrentAgentStatuses(agents, webview);
}

export function sendCurrentAgentStatuses(
  agents: Map<number, AgentState>,
  webview: vscode.Webview | undefined,
): void {
  if (!webview) return;
  for (const [agentId, agent] of agents) {
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

export function sendLayout(
  context: vscode.ExtensionContext,
  webview: vscode.Webview | undefined,
  defaultLayout?: Record<string, unknown> | null,
): void {
  if (!webview) return;
  const result = migrateAndLoadLayout(context, defaultLayout);
  webview.postMessage({
    type: 'layoutLoaded',
    layout: result?.layout ?? null,
    wasReset: result?.wasReset ?? false,
  });
}
