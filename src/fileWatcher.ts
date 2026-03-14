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

/** Classify a claude PID to a result string.
 * Returns VSCODE_TERMINAL_SESSION, EXTERNAL_AGENT_FOLDER_NAME, a terminal name, or null on error. */
function treeClassify(pid: number): string {
  const result = walkProcessTree(pid);
  if (result === 'vscode_terminal') return VSCODE_TERMINAL_SESSION;
  if (result === 'ignore') return EXTERNAL_AGENT_FOLDER_NAME; // extension-host parent → Ext agent
  if (result !== null) return result; // Ghostty, iTerm2, etc.
  return EXTERNAL_AGENT_FOLDER_NAME; // unrecognised ancestor
}

/** Try to identify the terminal emulator running a claude session by walking the process tree.
 * Returns:
 *   null                  — already tracked (+button --session-id agent); skip entirely
 *   VSCODE_TERMINAL_SESSION — VS Code terminal session; caller should adopt an unowned terminal
 *   string (other)        — external/extension name (create headless agent with that label)
 *   undefined             — ps error; caller should create headless as a safe fallback */
function detectExternalTerminalName(jsonlFile: string): string | null | undefined {
  try {
    const sessionId = path.basename(jsonlFile, '.jsonl');
    const psOutput = execSync('ps aux', { encoding: 'utf-8', timeout: 2000 });
    const lines = psOutput.split('\n');

    // Fast path: claude process that explicitly carries this session UUID in its args.
    const uuidLine = lines.find((l) => l.includes('claude') && l.includes(sessionId));
    if (uuidLine) {
      // + button agents use --session-id → already tracked by launchNewTerminal
      if (uuidLine.includes('--session-id')) return null;
      // Extension uses --output-format → headless Ext agent
      if (uuidLine.includes('--output-format')) return EXTERNAL_AGENT_FOLDER_NAME;
      const pid = parseInt(uuidLine.trim().split(/\s+/)[1]);
      if (!pid || isNaN(pid)) return EXTERNAL_AGENT_FOLDER_NAME;
      return treeClassify(pid);
    }

    // UUID not in args — bare `claude`, extension, or external terminal.
    // Collect all claude processes that aren't already tracked by launchNewTerminal.
    const candidateLines = lines.filter(
      (l) => l.includes(' claude') && !l.includes('--session-id') && !l.includes('grep'),
    );

    if (candidateLines.length === 0) return undefined;

    // Try to pinpoint which process created this specific JSONL using per-process lsof.
    // lsof -p <pid> only reports that process's open files — unlike lsof -t -- <file>
    // which also returns unrelated readers (e.g. Pixel Agents' own file watchers).
    const fileBase = path.basename(jsonlFile);
    for (const l of candidateLines) {
      const pid = parseInt(l.trim().split(/\s+/)[1]);
      if (!pid || isNaN(pid)) continue;
      try {
        const openFiles = execSync(`lsof -p ${pid}`, {
          encoding: 'utf-8',
          timeout: 2000,
        });
        if (!openFiles.includes(fileBase)) continue;
        // This process has our JSONL open — classify it.
        if (l.includes('--output-format')) return EXTERNAL_AGENT_FOLDER_NAME;
        return treeClassify(pid);
      } catch {
        /* lsof failed for this PID — try next */
      }
    }

    // Per-process lsof found nothing (claude closed the fd between writes, or lsof failed).
    // Fall back: classify by process tree heuristics.
    const extensionLines = candidateLines.filter((l) => l.includes('--output-format'));
    const bareLines = candidateLines.filter((l) => !l.includes('--output-format'));

    // Check bare claudes first — they might be Ghostty, VS Code terminal, etc.
    for (const l of bareLines) {
      const pid = parseInt(l.trim().split(/\s+/)[1]);
      if (!pid || isNaN(pid)) continue;
      const result = walkProcessTree(pid);
      if (result === 'vscode_terminal') return VSCODE_TERMINAL_SESSION;
      if (result === 'ignore') continue; // skip extension-spawned bare claude
      if (result !== null) return result; // specific terminal (Ghostty, etc.)
    }

    // Extension claudes exist → this JSONL likely belongs to one.
    if (extensionLines.length > 0) return EXTERNAL_AGENT_FOLDER_NAME;

    // Bare claudes exist but no specific terminal identified → external unknown.
    if (bareLines.length > 0) return EXTERNAL_AGENT_FOLDER_NAME;

    return undefined;
  } catch {
    return undefined;
  }
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
          // Already tracked (+button --session-id agent restored via restoreAgents) — skip.
          knownJsonlFiles.add(f);
          continue;
        }
        // At startup there are no terminals to adopt yet, so treat VSCODE_TERMINAL_SESSION
        // the same as an external session (create headless Ext agent).
        const resolvedName =
          terminalName === undefined || terminalName === VSCODE_TERMINAL_SESSION
            ? EXTERNAL_AGENT_FOLDER_NAME
            : terminalName;
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
