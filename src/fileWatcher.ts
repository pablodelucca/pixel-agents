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
      // Use args= (full command line incl. path) so "Code Helper (Plugin)" isn't truncated.
      // ps -o comm= caps at ~16 chars and loses "(Plugin)", causing false vscode_terminal matches.
      const args = execSync(`ps -p ${ppid} -o args=`, {
        encoding: 'utf-8',
        timeout: 1000,
      }).trim();
      const argsLower = args.toLowerCase();

      // Extension host process (Code Helper (Plugin), Cursor Helper (Plugin)) → ignore
      if (argsLower.includes('plugin')) return 'ignore';

      // Regular VS Code / Cursor terminal process → adopt as terminal agent
      for (const vs of VS_CODE_PROCESSES) {
        if (argsLower.includes(vs)) return 'vscode_terminal';
      }

      // Known external terminal emulator → headless agent
      for (const term of KNOWN_TERMINALS) {
        if (argsLower.includes(term.toLowerCase())) return term;
      }

      checkPid = ppid;
    } catch {
      break;
    }
  }
  return null;
}

type DetectionResult = {
  label: string | null | undefined;
  claudePid?: number; // set when label === VSCODE_TERMINAL_SESSION, used for terminal matching
};

/** Classify a claude PID to a label via its process-tree ancestry. */
function treeClassify(pid: number): string {
  const result = walkProcessTree(pid);
  if (result === 'vscode_terminal') return VSCODE_TERMINAL_SESSION;
  if (result === 'ignore') return EXTERNAL_AGENT_FOLDER_NAME; // extension-host parent → Ext agent
  if (result !== null) return result; // Ghostty, iTerm2, etc.
  return EXTERNAL_AGENT_FOLDER_NAME; // unrecognised ancestor
}

/** Try to identify the terminal emulator running a claude session by walking the process tree.
 * label:
 *   null                  — already tracked (+button --session-id agent); skip entirely
 *   VSCODE_TERMINAL_SESSION — VS Code terminal session; claudePid is set for terminal matching
 *   string (other)        — external/extension name (create headless agent with that label)
 *   undefined             — ps error; caller should create headless as a safe fallback */
/** Parse `ps etime` string ([[DD-]hh:]mm:ss) to total seconds. */
function parseElapsedSeconds(etime: string): number {
  const parts = etime.trim().split(':');
  if (parts.length === 3) {
    const hPart = parts[0];
    const h = hPart.includes('-')
      ? hPart.split('-').reduce((s, p, i) => s + parseInt(p) * (i === 0 ? 86400 : 3600), 0)
      : parseInt(hPart) * 3600;
    return h + parseInt(parts[1]) * 60 + parseInt(parts[2]);
  }
  if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  return isNaN(parseInt(etime.trim())) ? Infinity : parseInt(etime.trim());
}

function detectExternalTerminalName(
  jsonlFile: string,
  usedClaudePids: Set<number> = new Set(),
): DetectionResult {
  const fileBase = path.basename(jsonlFile, '.jsonl').slice(0, 8); // short ID for logs
  try {
    const sessionId = path.basename(jsonlFile, '.jsonl');
    // ps auxww: wide output so long arg lists (e.g. --output-format) aren't truncated
    const psOutput = execSync('ps auxww', { encoding: 'utf-8', timeout: 2000 });
    const lines = psOutput.split('\n');

    // Fast path: claude process that explicitly carries this session UUID in its args.
    const uuidLine = lines.find((l) => l.includes('claude') && l.includes(sessionId));
    if (uuidLine) {
      if (uuidLine.includes('--session-id')) {
        console.log(`[Pixel Agents] detect ${fileBase}: uuid match → tracked (+button), skip`);
        return { label: null };
      }
      if (uuidLine.includes('--output-format')) {
        console.log(`[Pixel Agents] detect ${fileBase}: uuid match → --output-format → Ext`);
        return { label: EXTERNAL_AGENT_FOLDER_NAME };
      }
      const pid = parseInt(uuidLine.trim().split(/\s+/)[1]);
      if (!pid || isNaN(pid)) return { label: EXTERNAL_AGENT_FOLDER_NAME };
      const label = treeClassify(pid);
      console.log(`[Pixel Agents] detect ${fileBase}: uuid match pid=${pid} → ${label}`);
      return { label, claudePid: label === VSCODE_TERMINAL_SESSION ? pid : undefined };
    }

    // UUID not in args — bare `claude`, extension, or external terminal.
    const candidateLines = lines.filter(
      (l) => l.includes(' claude') && !l.includes('--session-id') && !l.includes('grep'),
    );
    console.log(
      `[Pixel Agents] detect ${fileBase}: no uuid match, candidates=${candidateLines.length} [${candidateLines.map((l) => l.trim().split(/\s+/)[1]).join(',')}]`,
    );
    if (candidateLines.length === 0) return { label: undefined };

    // Primary: lsof -a -p <pid> <file> exits 0 iff that specific process has the file open.
    // (-a = AND both filters; without -a lsof uses OR and always matches something)
    for (const l of candidateLines) {
      const pid = parseInt(l.trim().split(/\s+/)[1]);
      if (!pid || isNaN(pid)) continue;
      try {
        execSync(`lsof -a -p ${pid} "${jsonlFile}"`, { encoding: 'utf-8', timeout: 2000 });
        const hasOutputFormat = l.includes('--output-format');
        console.log(
          `[Pixel Agents] detect ${fileBase}: lsof hit pid=${pid} outputFmt=${hasOutputFormat}`,
        );
        if (hasOutputFormat) return { label: EXTERNAL_AGENT_FOLDER_NAME };
        const label = treeClassify(pid);
        console.log(`[Pixel Agents] detect ${fileBase}: tree pid=${pid} → ${label}`);
        return { label, claudePid: label === VSCODE_TERMINAL_SESSION ? pid : undefined };
      } catch {
        /* file not open by this process */
      }
    }
    console.log(`[Pixel Agents] detect ${fileBase}: lsof found nothing — using fallback`);

    // Fallback: classify by process tree heuristics.
    const extensionLines = candidateLines.filter((l) => l.includes('--output-format'));
    const bareLines = candidateLines.filter((l) => !l.includes('--output-format'));
    console.log(
      `[Pixel Agents] detect ${fileBase}: fallback ext=${extensionLines.length} bare=${bareLines.length}`,
    );

    // Both extension and bare claudes running → can't attribute without lsof → headless.
    if (extensionLines.length > 0 && bareLines.length > 0) {
      console.log(`[Pixel Agents] detect ${fileBase}: both types → Ext (ambiguous)`);
      return { label: EXTERNAL_AGENT_FOLDER_NAME };
    }

    // Only bare claudes — sort by elapsed time (most recent first) to pick the newest.
    // Skip PIDs already matched to existing agents so they don't steal future JSONLs.
    // Also skip processes far older than the JSONL file itself — they can't be the owner.
    let fileAgeSec = 0;
    try {
      fileAgeSec = (Date.now() - fs.statSync(jsonlFile).mtimeMs) / 1000;
    } catch {
      /* use 0 if stat fails */
    }
    const sortedBare = bareLines
      .map((l) => {
        const pid = parseInt(l.trim().split(/\s+/)[1]);
        if (!pid || isNaN(pid)) return null;
        if (usedClaudePids.has(pid)) return null; // already matched to another agent
        try {
          const etime = execSync(`ps -p ${pid} -o etime=`, {
            encoding: 'utf-8',
            timeout: 500,
          }).trim();
          const elapsed = parseElapsedSeconds(etime);
          // If the process is much older than the file (> 5 min tolerance), it can't be
          // the owner of a newly-created session. This filters out long-lived extension
          // processes (e.g. claude binary running inside Code Helper for 2+ days).
          if (elapsed > fileAgeSec + 300) {
            console.log(
              `[Pixel Agents] detect ${fileBase}: bare pid=${pid} elapsed=${elapsed}s too old vs file age ${fileAgeSec}s, skip`,
            );
            return null;
          }
          return { l, pid, elapsed };
        } catch {
          return { l, pid, elapsed: Infinity };
        }
      })
      .filter((x): x is { l: string; pid: number; elapsed: number } => x !== null)
      .sort((a, b) => a.elapsed - b.elapsed); // ascending = most recent first

    for (const { l, pid, elapsed } of sortedBare) {
      const result = walkProcessTree(pid);
      console.log(
        `[Pixel Agents] detect ${fileBase}: bare pid=${pid} elapsed=${elapsed}s tree=${result}`,
      );
      if (result === 'vscode_terminal') return { label: VSCODE_TERMINAL_SESSION, claudePid: pid };
      if (result === 'ignore') continue;
      if (result !== null) return { label: result };
    }

    if (extensionLines.length > 0) {
      console.log(`[Pixel Agents] detect ${fileBase}: only extension → Ext`);
      return { label: EXTERNAL_AGENT_FOLDER_NAME };
    }
    if (bareLines.length > 0) {
      console.log(`[Pixel Agents] detect ${fileBase}: bare no match → Ext fallback`);
      return { label: EXTERNAL_AGENT_FOLDER_NAME };
    }

    return { label: undefined };
  } catch {
    return { label: undefined };
  }
}

/** Walk the claude process's ancestor chain, then find the VS Code terminal whose shell
 * PID is in that chain. Returns null if no match (caller falls back to first unowned). */
async function findOwningTerminal(
  claudePid: number,
  agents: Map<number, AgentState>,
): Promise<vscode.Terminal | null> {
  const ancestors = new Set<number>();
  let p = claudePid;
  for (let i = 0; i < 12; i++) {
    try {
      const ppid = parseInt(
        execSync(`ps -p ${p} -o ppid=`, { encoding: 'utf-8', timeout: 500 }).trim(),
      );
      if (!ppid || isNaN(ppid) || ppid <= 1 || ppid === p) break;
      ancestors.add(ppid);
      p = ppid;
    } catch {
      break;
    }
  }

  // Build set of shell PIDs already owned by existing agents by looking up
  // the parent PID (shell) of each agent's tracked claude process.
  // This works even when terminalRef objects are stale after restoreAgents().
  const ownedShellPids = new Set<number>();
  for (const agent of agents.values()) {
    if (!agent.claudePid) continue;
    try {
      const ppid = parseInt(
        execSync(`ps -p ${agent.claudePid} -o ppid=`, { encoding: 'utf-8', timeout: 500 }).trim(),
      );
      if (ppid && !isNaN(ppid)) ownedShellPids.add(ppid);
    } catch {
      /* process may be gone */
    }
  }

  for (const terminal of vscode.window.terminals) {
    const shellPid = await terminal.processId;
    const isOwnedByRef = [...agents.values()].some((a) => a.terminalRef === terminal);
    const isOwnedByPid = shellPid !== undefined && ownedShellPids.has(shellPid);
    console.log(
      `[Pixel Agents] findOwning: terminal="${terminal.name}" shellPid=${shellPid} ownedByRef=${isOwnedByRef} ownedByPid=${isOwnedByPid} inAncestors=${shellPid !== undefined && ancestors.has(shellPid)}`,
    );
    if (isOwnedByRef || isOwnedByPid) continue;
    if (shellPid !== undefined && ancestors.has(shellPid)) return terminal;
  }
  console.log(
    `[Pixel Agents] findOwning: no terminal matched ancestors=[${[...ancestors].join(',')}]`,
  );
  return null;
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
    void scanForNewJsonlFiles(
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

async function scanForNewJsonlFiles(
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
): Promise<void> {
  let files: string[];
  try {
    files = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(projectDir, f));
  } catch {
    return;
  }

  // Build set of claude PIDs already matched to existing agents so we don't re-match them.
  const usedClaudePids = new Set(
    [...agents.values()].map((a) => a.claudePid).filter((p): p is number => p !== undefined),
  );

  for (const file of files) {
    if (!knownJsonlFiles.has(file)) {
      knownJsonlFiles.add(file);

      const { label: externalName, claudePid } = detectExternalTerminalName(file, usedClaudePids);
      // Add to used set immediately so subsequent files in the same scan don't steal this PID.
      if (claudePid !== undefined) usedClaudePids.add(claudePid);

      if (externalName === null) {
        // Already tracked (+button --session-id agent) — ignore silently.
        console.log(`[Pixel Agents] Ignoring tracked session: ${path.basename(file)}`);
      } else if (externalName === VSCODE_TERMINAL_SESSION) {
        // VS Code terminal running `claude` manually.
        // Use claudePid to find the exact terminal by process ancestry, then fall
        // back to first unowned terminal (e.g. /clear case with no new terminal).
        let adoptedTerminal: vscode.Terminal | null = null;
        if (claudePid !== undefined) {
          adoptedTerminal = await findOwningTerminal(claudePid, agents);
        }
        if (adoptedTerminal === null) {
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
            false,
            claudePid,
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
        // External terminal (Ghostty, iTerm2, etc.), extension session, or ps error.
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
          false,
          claudePid,
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
  claudePid?: number,
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
    claudePid,
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
        const { label: terminalName } = detectExternalTerminalName(f);
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
