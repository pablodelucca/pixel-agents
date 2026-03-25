import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  JSONL_POLL_INTERVAL_MS,
  TERMINAL_NAME_PREFIX,
  WORKSPACE_KEY_AGENT_SEATS,
  WORKSPACE_KEY_AGENTS,
} from './constants.js';
import { ensureProjectScan, readNewLines, startFileWatching } from './fileWatcher.js';
import { migrateAndLoadLayout } from './layoutPersistence.js';
import { cancelPermissionTimer, cancelWaitingTimer } from './timerManager.js';
import type { AgentState, PersistedAgent } from './types.js';

export function getProjectDirPath(cwd?: string): string {
  // Fall back to home directory when no workspace folder is open.
  // This is the common case on Linux/macOS when VS Code is launched without a folder
  // (e.g. `code` with no arguments). Claude Code writes JSONL files to
  // ~/.claude/projects/<hash>/ where <hash> is derived from the process cwd, so we
  // must use the same directory as the terminal's working directory.
  const workspacePath = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
  const dirName = workspacePath.replace(/[^a-zA-Z0-9-]/g, '-');
  const projectDir = path.join(os.homedir(), '.claude', 'projects', dirName);
  console.log(`[Pixel Agents] Project dir: ${workspacePath} → ${dirName}`);

  // Verify the directory exists; if not, try fuzzy matching against existing dirs
  if (!fs.existsSync(projectDir)) {
    const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
    try {
      if (fs.existsSync(projectsRoot)) {
        const candidates = fs.readdirSync(projectsRoot);
        // Try case-insensitive match (handles Windows drive letter casing)
        const lowerDirName = dirName.toLowerCase();
        const match = candidates.find((c) => c.toLowerCase() === lowerDirName);
        if (match && match !== dirName) {
          const matchedDir = path.join(projectsRoot, match);
          console.log(
            `[Pixel Agents] Project dir not found, using case-insensitive match: ${dirName} → ${match}`,
          );
          return matchedDir;
        }
        if (!match) {
          console.warn(
            `[Pixel Agents] Project dir does not exist: ${projectDir}. ` +
              `Available dirs (${candidates.length}): ${candidates.slice(0, 5).join(', ')}${candidates.length > 5 ? '...' : ''}`,
          );
        }
      }
    } catch {
      // Ignore scan errors
    }
  }
  return projectDir;
}

export async function launchNewTerminal(
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
  projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
  webview: vscode.Webview | undefined,
  persistAgents: () => void,
  folderPath?: string,
  bypassPermissions?: boolean,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  // Use home directory as fallback cwd when no workspace is open (common on Linux/macOS).
  // This ensures the terminal starts in a predictable location that matches the project
  // dir hash Claude Code will use for JSONL transcript files.
  const cwd = folderPath || folders?.[0]?.uri.fsPath || os.homedir();
  const isMultiRoot = !!(folders && folders.length > 1);
  const idx = nextTerminalIndexRef.current++;
  const terminal = vscode.window.createTerminal({
    name: `${TERMINAL_NAME_PREFIX} #${idx}`,
    cwd,
  });
  terminal.show();

  const sessionId = crypto.randomUUID();
  const claudeCmd = bypassPermissions
    ? `claude --session-id ${sessionId} --dangerously-skip-permissions`
    : `claude --session-id ${sessionId}`;
  terminal.sendText(claudeCmd);

  const projectDir = getProjectDirPath(cwd);

  // Pre-register expected JSONL file so project scan won't treat it as a /clear file
  const expectedFile = path.join(projectDir, `${sessionId}.jsonl`);
  knownJsonlFiles.add(expectedFile);

  // Create agent immediately (before JSONL file exists)
  const id = nextAgentIdRef.current++;
  const folderName = isMultiRoot && cwd ? path.basename(cwd) : undefined;
  const agent: AgentState = {
    id,
    terminalRef: terminal,
    projectDir,
    jsonlFile: expectedFile,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    folderName,
  };

  agents.set(id, agent);
  activeAgentIdRef.current = id;
  persistAgents();
  console.log(`[Pixel Agents] Agent ${id}: created for terminal ${terminal.name}`);
  webview?.postMessage({ type: 'agentCreated', id, folderName });

  ensureProjectScan(
    projectDir,
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

  // Poll for the specific JSONL file to appear
  let pollCount = 0;
  console.log(`[Pixel Agents] Agent ${id}: waiting for JSONL at ${agent.jsonlFile}`);
  const pollTimer = setInterval(() => {
    pollCount++;
    try {
      if (fs.existsSync(agent.jsonlFile)) {
        console.log(
          `[Pixel Agents] Agent ${id}: found JSONL file ${path.basename(agent.jsonlFile)} (after ${pollCount}s)`,
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
      } else if (pollCount === 10) {
        // After 10s of polling, warn with path details to help diagnose path encoding mismatches
        const dirExists = fs.existsSync(projectDir);
        let dirContents = '';
        if (dirExists) {
          try {
            const files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
            dirContents =
              files.length > 0
                ? `Dir has ${files.length} JSONL file(s): ${files.slice(0, 3).join(', ')}${files.length > 3 ? '...' : ''}`
                : 'Dir exists but has no JSONL files';
          } catch {
            dirContents = 'Dir exists but unreadable';
          }
        } else {
          dirContents = 'Dir does not exist';
        }
        console.warn(
          `[Pixel Agents] Agent ${id}: JSONL file not found after 10s. ` +
            `Expected: ${agent.jsonlFile}. ${dirContents}`,
        );
      }
    } catch {
      /* file may not exist yet */
    }
  }, JSONL_POLL_INTERVAL_MS);
  jsonlPollTimers.set(id, pollTimer);
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

  // Stop JSONL poll timer
  const jpTimer = jsonlPollTimers.get(agentId);
  if (jpTimer) {
    clearInterval(jpTimer);
  }
  jsonlPollTimers.delete(agentId);

  // Stop file watching
  fileWatchers.get(agentId)?.close();
  fileWatchers.delete(agentId);
  const pt = pollingTimers.get(agentId);
  if (pt) {
    clearInterval(pt);
  }
  pollingTimers.delete(agentId);

  // Cancel timers
  cancelWaitingTimer(agentId, waitingTimers);
  cancelPermissionTimer(agentId, permissionTimers);

  // Remove from maps
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
  projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
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

  for (const p of persisted) {
    const terminal = liveTerminals.find((t) => t.name === p.terminalName);
    if (!terminal) continue;

    const agent: AgentState = {
      id: p.id,
      terminalRef: terminal,
      projectDir: p.projectDir,
      jsonlFile: p.jsonlFile,
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      backgroundAgentToolIds: new Set(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      lastDataAt: 0,
      linesProcessed: 0,
      seenUnknownRecordTypes: new Set(),
      folderName: p.folderName,
    };

    agents.set(p.id, agent);
    knownJsonlFiles.add(p.jsonlFile);
    console.log(`[Pixel Agents] Restored agent ${p.id} → terminal "${p.terminalName}"`);

    if (p.id > maxId) maxId = p.id;
    // Extract terminal index from name like "Claude Code #3"
    const match = p.terminalName.match(/#(\d+)$/);
    if (match) {
      const idx = parseInt(match[1], 10);
      if (idx > maxIdx) maxIdx = idx;
    }

    restoredProjectDir = p.projectDir;

    // Start file watching if JSONL exists, skipping to end of file
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
        // Poll for the file to appear
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

  // Advance counters past restored IDs
  if (maxId >= nextAgentIdRef.current) {
    nextAgentIdRef.current = maxId + 1;
  }
  if (maxIdx >= nextTerminalIndexRef.current) {
    nextTerminalIndexRef.current = maxIdx + 1;
  }

  // Re-persist cleaned-up list (removes entries whose terminals are gone)
  doPersist();

  // Start project scan for /clear detection
  if (restoredProjectDir) {
    ensureProjectScan(
      restoredProjectDir,
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

  // Include persisted palette/seatId from separate key
  const agentMeta = context.workspaceState.get<
    Record<string, { palette?: number; seatId?: string }>
  >(WORKSPACE_KEY_AGENT_SEATS, {});

  // Include folderName per agent
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
    // Re-send active tools
    for (const [toolId, status] of agent.activeToolStatuses) {
      webview.postMessage({
        type: 'agentToolStart',
        id: agentId,
        toolId,
        status,
      });
    }
    // Re-send waiting status
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
