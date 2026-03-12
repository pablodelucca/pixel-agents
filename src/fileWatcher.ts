import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  ADOPT_MIN_FILE_SIZE_BYTES,
  ADOPT_RECENT_FILE_THRESHOLD_MS,
  EXTERNAL_AGENT_FOLDER_NAME,
  FILE_WATCHER_POLL_INTERVAL_MS,
  PROJECT_SCAN_INTERVAL_MS,
} from './constants.js';
import { cancelPermissionTimer, cancelWaitingTimer, clearAgentActivity } from './timerManager.js';
import { processTranscriptLine } from './transcriptParser.js';
import type { AgentState } from './types.js';

const KNOWN_TERMINALS = [
  'Ghostty',
  'iTerm2',
  'Terminal',
  'Hyper',
  'WezTerm',
  'Alacritty',
  'kitty',
  'tmux',
];
const VS_CODE_PROCESSES = ['code', 'code-insiders', 'electron', 'cursor'];

/** Try to identify the terminal emulator running a claude session by walking the process tree.
 * Returns the terminal name, EXTERNAL_AGENT_FOLDER_NAME for unknown external terminals,
 * or null if the session belongs to a VS Code instance (should be skipped). */
function detectExternalTerminalName(jsonlFile: string): string | null {
  try {
    const sessionId = path.basename(jsonlFile, '.jsonl');
    const psOutput = execSync('ps aux', { encoding: 'utf-8', timeout: 2000 });
    const line = psOutput.split('\n').find((l) => l.includes('claude') && l.includes(sessionId));
    if (!line) return EXTERNAL_AGENT_FOLDER_NAME;

    const pid = parseInt(line.trim().split(/\s+/)[1]);
    if (!pid || isNaN(pid)) return EXTERNAL_AGENT_FOLDER_NAME;

    let checkPid = pid;
    for (let i = 0; i < 8; i++) {
      const ppidStr = execSync(`ps -p ${checkPid} -o ppid=`, {
        encoding: 'utf-8',
        timeout: 1000,
      }).trim();
      const ppid = parseInt(ppidStr);
      if (!ppid || isNaN(ppid) || ppid === checkPid || ppid <= 1) break;
      const comm = execSync(`ps -p ${ppid} -o comm=`, {
        encoding: 'utf-8',
        timeout: 1000,
      }).trim();
      const commLower = comm.toLowerCase();
      // VS Code extension sessions — signal to skip
      for (const vs of VS_CODE_PROCESSES) {
        if (commLower.includes(vs)) return null;
      }
      for (const term of KNOWN_TERMINALS) {
        if (commLower.includes(term.toLowerCase())) return term;
      }
      checkPid = ppid;
    }
  } catch {
    /* detection failed — fall back to generic label */
  }
  return EXTERNAL_AGENT_FOLDER_NAME;
}

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
  // Seed with existing JSONL files, skipping large+recent ones (adoptExistingJsonlFiles handles those)
  try {
    const files = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(projectDir, f));
    const now = Date.now();
    for (const f of files) {
      if (knownJsonlFiles.has(f)) continue; // already tracked (e.g. by adoptExistingJsonlFiles)
      try {
        const stat = fs.statSync(f);
        const isRecent = now - stat.mtimeMs < ADOPT_RECENT_FILE_THRESHOLD_MS;
        const isLarge = stat.size >= ADOPT_MIN_FILE_SIZE_BYTES;
        if (!(isLarge && isRecent)) {
          knownJsonlFiles.add(f);
        }
      } catch {
        knownJsonlFiles.add(f); // if can't stat, seed it anyway
      }
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

      // Detect the terminal emulator that owns this session.
      // Returns null = VS Code process (skip as extension session or treat as /clear).
      // Returns a string (including EXTERNAL_AGENT_FOLDER_NAME) = external terminal.
      const externalName = detectExternalTerminalName(file);

      if (externalName !== null) {
        // External terminal (Ghostty, iTerm2, etc.) — always create a new agent,
        // even if a VS Code agent is active (avoids misidentifying as /clear).
        let currentOffset = 0;
        try {
          currentOffset = fs.statSync(file).size;
        } catch {
          /* use 0 if stat fails */
        }
        console.log(
          `[Pixel Agents] New external session: ${path.basename(file)} (${externalName}), offset=${currentOffset}`,
        );
        adoptTerminalForFile(
          null,
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
          currentOffset,
          externalName,
        );
      } else {
        // VS Code session: search for an unowned terminal first, then fall back to /clear.
        let adoptedTerminal: vscode.Terminal | null = null;
        for (const t of vscode.window.terminals) {
          let owned = false;
          for (const agent of agents.values()) {
            if (agent.terminalRef === t) {
              owned = true;
              break;
            }
          }
          if (!owned) {
            adoptedTerminal = t;
            break;
          }
        }

        if (adoptedTerminal !== null) {
          // Unowned VS Code terminal found — adopt it as new agent
          console.log(
            `[Pixel Agents] New VS Code session: ${path.basename(file)}, adopting terminal "${adoptedTerminal.name}"`,
          );
          adoptTerminalForFile(
            adoptedTerminal,
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
            0,
            undefined,
          );
        } else if (activeAgentIdRef.current !== null) {
          // No unowned terminal and active agent exists → /clear reassignment
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
        }
        // else: VS Code session, no unowned terminal, no active agent → skip
      }
    }
  }
}

export function adoptTerminalForFile(
  terminal: vscode.Terminal | null,
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
  initialOffset = 0,
  overrideFolderName?: string,
  /** Skip agentCreated message — caller will notify webview via sendExistingAgents instead */
  silent = false,
): void {
  const id = nextAgentIdRef.current++;
  const isExternal = terminal === null;
  const folderName = overrideFolderName ?? (isExternal ? EXTERNAL_AGENT_FOLDER_NAME : undefined);
  const agent: AgentState = {
    id,
    terminalRef: terminal,
    projectDir,
    jsonlFile,
    fileOffset: initialOffset,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    isExternal: isExternal || undefined,
    folderName,
  };

  agents.set(id, agent);
  if (terminal !== null) {
    activeAgentIdRef.current = id;
  }
  persistAgents();

  if (isExternal) {
    console.log(
      `[Pixel Agents] Agent ${id}: adopted external session ${path.basename(jsonlFile)} (${folderName})`,
    );
  } else {
    console.log(
      `[Pixel Agents] Agent ${id}: adopted terminal "${terminal!.name}" for ${path.basename(jsonlFile)}`,
    );
  }
  if (!silent) {
    webview?.postMessage({ type: 'agentCreated', id, folderName });
  }

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

export function adoptExistingJsonlFiles(
  projectDir: string,
  knownJsonlFiles: Set<string>,
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
  let files: string[];
  try {
    files = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(projectDir, f));
  } catch {
    return;
  }

  const now = Date.now();
  for (const f of files) {
    if (knownJsonlFiles.has(f)) continue; // already tracked (restored agent)
    try {
      const stat = fs.statSync(f);
      const isRecent = now - stat.mtimeMs < ADOPT_RECENT_FILE_THRESHOLD_MS;
      const isLarge = stat.size >= ADOPT_MIN_FILE_SIZE_BYTES;
      if (isLarge && isRecent) {
        const terminalName = detectExternalTerminalName(f);
        if (terminalName === null) {
          console.log(
            `[Pixel Agents] Skipping VS Code extension session on startup: ${path.basename(f)}`,
          );
          knownJsonlFiles.add(f);
          continue;
        }
        console.log(
          `[Pixel Agents] Adopting pre-existing session: ${path.basename(f)} (${terminalName})`,
        );
        adoptTerminalForFile(
          null,
          f,
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
          stat.size, // skip history — only watch for new activity
          terminalName,
          true, // silent — sendExistingAgents will notify the webview
        );
        knownJsonlFiles.add(f);
      }
    } catch {
      /* ignore stat errors */
    }
  }

  // Seed all remaining files so the scan timer only reacts to truly new ones
  for (const f of files) {
    knownJsonlFiles.add(f);
  }
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
