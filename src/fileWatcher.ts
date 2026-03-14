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
  'Cursor', // Cursor IDE treated as external app — shows as headless agent
];
const VS_CODE_PROCESSES = ['code', 'code-insiders', 'electron'];

// Sentinel: the JSONL belongs to a VS Code terminal (not extension host).
// Caller should look for an unowned VS Code terminal and adopt it.
const VSCODE_TERMINAL_SESSION = '__vscode_terminal__';

/** Walk the process tree upward from pid.
 * Returns 'vscode_terminal' if a regular Code Helper (non-plugin) ancestor is found,
 * 'ignore' if an extension-host (Plugin) or other VS Code process is found,
 * the terminal name if a known external terminal is found,
 * or null if nothing matched within the depth limit. */
function walkProcessTree(pid: number): 'vscode_terminal' | 'ignore' | string | null {
  let checkPid = pid;
  for (let i = 0; i < 8; i++) {
    try {
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

      // Extension host process (Code Helper (Plugin), Cursor Helper (Plugin)) → ignore
      if (commLower.includes('plugin')) return 'ignore';

      // Regular VS Code / Cursor terminal process → adopt as terminal agent
      for (const vs of VS_CODE_PROCESSES) {
        if (commLower.includes(vs)) return 'vscode_terminal';
      }

      // Known external terminal emulator → headless agent
      for (const term of KNOWN_TERMINALS) {
        if (commLower.includes(term.toLowerCase())) return term;
      }

      checkPid = ppid;
    } catch {
      break;
    }
  }
  return null;
}

/** Try to identify the terminal emulator running a claude session by walking the process tree.
 * Returns:
 *   null                  — ignore (Claude Code extension / extension-host session)
 *   VSCODE_TERMINAL_SESSION — VS Code terminal session; caller should adopt an unowned terminal
 *   string (other)        — external terminal name (or EXTERNAL_AGENT_FOLDER_NAME); create headless
 *   undefined             — ps error; caller should create headless as a safe fallback */
function detectExternalTerminalName(jsonlFile: string): string | null | undefined {
  try {
    const sessionId = path.basename(jsonlFile, '.jsonl');
    const psOutput = execSync('ps aux', { encoding: 'utf-8', timeout: 2000 });
    const line = psOutput.split('\n').find((l) => l.includes('claude') && l.includes(sessionId));

    if (!line) {
      // Process not found by UUID — claude was started without a session ID in its args
      // (bare `claude` in Ghostty, manually typed in a VS Code terminal, or the Claude Code
      // extension which uses --output-format stream-json instead of --session-id).
      //
      // Use lsof to find which process actually has the JSONL file open for writing,
      // then classify that process directly.
      try {
        const lsofOut = execSync(`lsof -t -- "${jsonlFile}"`, {
          encoding: 'utf-8',
          timeout: 2000,
        }).trim();
        for (const pidStr of lsofOut.split('\n')) {
          const writePid = parseInt(pidStr.trim());
          if (!writePid || isNaN(writePid)) continue;
          try {
            const ownComm = execSync(`ps -p ${writePid} -o comm=`, {
              encoding: 'utf-8',
              timeout: 1000,
            })
              .trim()
              .toLowerCase();
            // Code Helper (Plugin) is the extension host — it reads/monitors the file,
            // meaning this JSONL belongs to a Claude Code extension session → ignore.
            if (ownComm.includes('plugin')) return null;
            const procArgs = execSync(`ps -p ${writePid} -o args=`, {
              encoding: 'utf-8',
              timeout: 1000,
            }).trim();
            // Extension fast-path: --output-format stream-json → ignore
            if (procArgs.includes('--output-format')) return null;
            // Walk tree to classify
            const treeResult = walkProcessTree(writePid);
            if (treeResult === 'vscode_terminal') return VSCODE_TERMINAL_SESSION;
            if (treeResult === 'ignore') return null;
            if (treeResult !== null) return treeResult; // known external terminal
          } catch {
            /* this PID may have exited, try next */
          }
        }
      } catch {
        /* lsof unavailable or file not open yet — fall through */
      }
      // lsof found nothing (file not open, or lsof unavailable).
      // Last resort: check if any unaccounted claude process has a VS Code terminal parent.
      const unaccounted = psOutput
        .split('\n')
        .filter(
          (l) =>
            l.includes(' claude') &&
            !l.includes('--session-id') &&
            !l.includes('--output-format') &&
            !l.includes('grep'),
        );
      for (const uLine of unaccounted) {
        const uPid = parseInt(uLine.trim().split(/\s+/)[1]);
        if (!uPid || isNaN(uPid)) continue;
        const result = walkProcessTree(uPid);
        if (result === 'vscode_terminal') return VSCODE_TERMINAL_SESSION;
      }
      return EXTERNAL_AGENT_FOLDER_NAME;
    }

    // Fast path: VS Code's launchNewTerminal always passes --session-id.
    // These are already tracked by launchNewTerminal — should never reach the scanner,
    // but return null (ignore) as a safety net.
    if (line.includes('--session-id')) return null;

    // Fast path: Claude Code IDE extension uses --output-format stream-json.
    // Must be ignored, NOT adopted as a terminal agent.
    if (line.includes('--output-format')) return null;

    const pid = parseInt(line.trim().split(/\s+/)[1]);
    if (!pid || isNaN(pid)) return EXTERNAL_AGENT_FOLDER_NAME;

    const result = walkProcessTree(pid);
    if (result === 'vscode_terminal') return VSCODE_TERMINAL_SESSION;
    if (result === 'ignore') return null;
    if (result !== null) return result; // known terminal name
  } catch {
    return undefined;
  }
  // Process found but no recognised ancestor — probably external, unknown terminal type
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
      // null                  = extension/plugin-host session → ignore completely
      // VSCODE_TERMINAL_SESSION = VS Code terminal session → adopt unowned terminal
      // string (other)        = external terminal → headless agent
      // undefined             = ps error → headless agent (safe fallback)
      const externalName = detectExternalTerminalName(file);

      if (externalName === null) {
        // Claude Code extension or other plugin-host session — ignore silently.
        console.log(`[Pixel Agents] Ignoring extension session: ${path.basename(file)}`);
      } else if (externalName === VSCODE_TERMINAL_SESSION) {
        // VS Code terminal running `claude` manually — find an unowned terminal to adopt,
        // or fall back to /clear reassignment.
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
          // /clear — reassign active agent to the new file
          console.log(
            `[Pixel Agents] /clear detected: ${path.basename(file)}, reassigning agent ${activeAgentIdRef.current}`,
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
      } else {
        // External terminal (Ghostty, iTerm2, etc.) or ps error — create headless agent.
        let currentOffset = 0;
        try {
          currentOffset = fs.statSync(file).size;
        } catch {
          /* use 0 if stat fails */
        }
        const label = externalName ?? EXTERNAL_AGENT_FOLDER_NAME;
        console.log(
          `[Pixel Agents] New external session: ${path.basename(file)} (${label}), offset=${currentOffset}`,
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
          label,
        );
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
          // Definitely VS Code/Cursor — skip
          console.log(
            `[Pixel Agents] Skipping VS Code extension session on startup: ${path.basename(f)}`,
          );
          knownJsonlFiles.add(f);
          continue;
        }
        // undefined = can't determine, but it passed the size+recency filter so it's
        // likely an active external session (e.g. Ghostty `claude` with no UUID in args)
        const resolvedName = terminalName ?? EXTERNAL_AGENT_FOLDER_NAME;
        console.log(
          `[Pixel Agents] Adopting pre-existing session: ${path.basename(f)} (${resolvedName})`,
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
          resolvedName,
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
