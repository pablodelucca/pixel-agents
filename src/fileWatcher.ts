import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { FILE_WATCHER_POLL_INTERVAL_MS, PROJECT_SCAN_INTERVAL_MS } from './constants.js';
import { cancelPermissionTimer, cancelWaitingTimer, clearAgentActivity } from './timerManager.js';
import { processTranscriptLine } from './transcriptParser.js';
import type { AgentState, TeamConfig } from './types.js';

/** Read teammate name from a .meta.json sidecar file */
function readTeammateMeta(jsonlFile: string): string | null {
  try {
    const metaFile = jsonlFile.replace(/\.jsonl$/, '.meta.json');
    if (fs.existsSync(metaFile)) {
      const data = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
      return typeof data.agentType === 'string' ? data.agentType : null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Read all team configs from ~/.claude/teams/ and find teams whose
 * leadSessionId matches one of the given session directory names.
 * Returns a map of teammateName → { teamName, teamDescription, teamColor }.
 */
function readTeamConfigs(
  sessionDirs: string[],
): Map<string, { teamName: string; teamDescription: string; teamColor?: string }> {
  const result = new Map<
    string,
    { teamName: string; teamDescription: string; teamColor?: string }
  >();
  const teamsDir = path.join(os.homedir(), '.claude', 'teams');
  let teamDirs: string[];
  try {
    teamDirs = fs
      .readdirSync(teamsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return result;
  }

  for (const teamDir of teamDirs) {
    try {
      const configPath = path.join(teamsDir, teamDir, 'config.json');
      const config: TeamConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      // Only include teams whose leader session matches one of our project sessions
      if (!sessionDirs.includes(config.leadSessionId)) continue;
      for (const member of config.members) {
        result.set(`${config.leadSessionId}:${member.name}`, {
          teamName: config.name,
          teamDescription: config.description,
          teamColor: member.color,
        });
      }
    } catch {
      /* ignore malformed configs */
    }
  }
  return result;
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

  // Also seed existing teammate JSONL files in subagents/ directories
  try {
    const sessionDirs = fs
      .readdirSync(projectDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const sessionDir of sessionDirs) {
      const subagentsDir = path.join(projectDir, sessionDir, 'subagents');
      try {
        const subFiles = fs
          .readdirSync(subagentsDir)
          .filter((f) => f.endsWith('.jsonl'))
          .map((f) => path.join(subagentsDir, f));
        for (const f of subFiles) {
          knownJsonlFiles.add(f);
        }
      } catch {
        /* subagents/ may not exist */
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
    scanForTeammateFiles(
      projectDir,
      knownJsonlFiles,
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
        // No active agent → try to adopt the focused terminal
        const activeTerminal = vscode.window.activeTerminal;
        if (activeTerminal) {
          let owned = false;
          for (const agent of agents.values()) {
            if (agent.terminalRef === activeTerminal) {
              owned = true;
              break;
            }
          }
          if (!owned) {
            adoptTerminalForFile(
              activeTerminal,
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

/**
 * Scan for Agent Teams teammate JSONL files inside subagents/ directories.
 * Teammates write their transcripts to: {projectDir}/{sessionId}/subagents/agent-{hash}.jsonl
 * with metadata in agent-{hash}.meta.json containing {"agentType": "teammate-name"}.
 * Also reads ~/.claude/teams/{name}/config.json for team names, descriptions, and colors.
 */
function scanForTeammateFiles(
  projectDir: string,
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
  // Look for session directories (UUIDs) that contain a subagents/ folder
  let sessionDirs: string[];
  try {
    sessionDirs = fs
      .readdirSync(projectDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return;
  }

  // Find the parent agent for teammate association
  // Deduplicate by session:name key (allows same name in different teams)
  let parentAgentId: number | null = null;
  const existingTeammateKeys = new Set<string>();
  for (const agent of agents.values()) {
    if (agent.isTeammate && agent.teammateName) {
      // Use the session dir from the JSONL path as part of the key
      const sessionFromPath = path.basename(path.dirname(path.dirname(agent.jsonlFile)));
      existingTeammateKeys.add(`${sessionFromPath}:${agent.teammateName}`);
    } else if (!agent.isTeammate) {
      parentAgentId = agent.id;
    }
  }

  // Read team configs to enrich teammates with team metadata
  const teamConfigMap = readTeamConfigs(sessionDirs);

  for (const sessionDir of sessionDirs) {
    const subagentsDir = path.join(projectDir, sessionDir, 'subagents');
    let files: string[];
    try {
      files = fs
        .readdirSync(subagentsDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => path.join(subagentsDir, f));
    } catch {
      continue; // subagents/ doesn't exist for this session
    }

    for (const file of files) {
      if (knownJsonlFiles.has(file)) continue;
      knownJsonlFiles.add(file);

      const teammateName = readTeammateMeta(file);
      if (!teammateName) continue; // Not a teammate, skip

      // Deduplicate by session + name (allows same name in different teams)
      const dedupKey = `${sessionDir}:${teammateName}`;
      if (existingTeammateKeys.has(dedupKey)) continue;
      existingTeammateKeys.add(dedupKey);

      // Look up team metadata from config
      const teamInfo = teamConfigMap.get(`${sessionDir}:${teammateName}`);

      console.log(
        `[Pixel Agents] Teammate JSONL detected: ${teammateName}` +
          (teamInfo ? ` (team: ${teamInfo.teamName})` : '') +
          ` (${path.basename(file)})`,
      );

      const id = nextAgentIdRef.current++;
      const dummyTerminal = { name: `Teammate: ${teammateName}` } as vscode.Terminal;
      const agent: AgentState = {
        id,
        terminalRef: dummyTerminal,
        projectDir,
        jsonlFile: file,
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
        isTeammate: true,
        teammateName,
        parentAgentId: parentAgentId ?? undefined,
        teamName: teamInfo?.teamName,
        teamDescription: teamInfo?.teamDescription,
        teamColor: teamInfo?.teamColor,
      };

      agents.set(id, agent);
      persistAgents();

      webview?.postMessage({
        type: 'agentCreated',
        id,
        isTeammate: true,
        teammateName,
        parentAgentId,
        teamName: teamInfo?.teamName,
        teamDescription: teamInfo?.teamDescription,
        teamColor: teamInfo?.teamColor,
      });

      startFileWatching(
        id,
        file,
        agents,
        fileWatchers,
        pollingTimers,
        waitingTimers,
        permissionTimers,
        webview,
      );
      readNewLines(id, agents, waitingTimers, permissionTimers, webview);
    }
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
