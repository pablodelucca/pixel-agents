import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState, AgentType, PersistedAgent } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer } from './timerManager.js';
import { startFileWatching, readNewLines, ensureProjectScan } from './fileWatcher.js';
import { JSONL_POLL_INTERVAL_MS, WORKSPACE_KEY_AGENTS, WORKSPACE_KEY_AGENT_SEATS } from './constants.js';
import { migrateAndLoadLayout } from './layoutPersistence.js';
import { getAgentTypeConfig } from './agentTypeRegistry.js';

/**
 * Get the project directory path for a given agent type and workspace.
 * Falls back to Claude Code behavior for backwards compatibility.
 */
export function getProjectDirPath(cwd?: string, agentType: AgentType = 'claude-code'): string | null {
	const workspacePath = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!workspacePath) return null;
	const config = getAgentTypeConfig(agentType);
	const projectDir = config.getProjectDir(workspacePath);
	console.log(`[Pixel Agents] Project dir (${agentType}): ${workspacePath} → ${projectDir}`);
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
	agentType: AgentType = 'claude-code',
): Promise<void> {
	const config = getAgentTypeConfig(agentType);
	const folders = vscode.workspace.workspaceFolders;
	const cwd = folderPath || folders?.[0]?.uri.fsPath;
	const isMultiRoot = !!(folders && folders.length > 1);
	const idx = nextTerminalIndexRef.current++;
	const terminal = vscode.window.createTerminal({
		name: `${config.terminalPrefix} #${idx}`,
		cwd,
	});
	terminal.show();

	const sessionId = crypto.randomUUID();
	const launchCmd = config.launchCommand(sessionId);
	if (launchCmd) {
		terminal.sendText(launchCmd);
	}

	const projectDir = getProjectDirPath(cwd, agentType);
	const folderName = isMultiRoot && cwd ? path.basename(cwd) : undefined;

	// For agent types without transcript files (e.g. vscode-terminal), create a basic agent
	if (!config.hasTranscriptFiles || !projectDir) {
		const id = nextAgentIdRef.current++;
		const agent: AgentState = {
			id,
			agentType,
			terminalRef: terminal,
			projectDir: projectDir || '',
			jsonlFile: '',
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
		console.log(`[Pixel Agents] Agent ${id} (${agentType}): created for terminal ${terminal.name} (no transcript tracking)`);
		webview?.postMessage({ type: 'agentCreated', id, folderName, agentType });
		return;
	}

	// Pre-register expected transcript file so project scan won't treat it as a /clear file
	const expectedFile = config.getTranscriptFile(projectDir, sessionId);
	knownJsonlFiles.add(expectedFile);

	// Create agent immediately (before transcript file exists)
	const id = nextAgentIdRef.current++;
	const agent: AgentState = {
		id,
		agentType,
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
		isWaiting: false,
		permissionSent: false,
		hadToolsInTurn: false,
		folderName,
	};

	agents.set(id, agent);
	activeAgentIdRef.current = id;
	persistAgents();
	console.log(`[Pixel Agents] Agent ${id} (${agentType}): created for terminal ${terminal.name}`);
	webview?.postMessage({ type: 'agentCreated', id, folderName, agentType });

	if (config.hasProjectScan) {
		ensureProjectScan(
			projectDir, knownJsonlFiles, projectScanTimerRef, activeAgentIdRef,
			nextAgentIdRef, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			webview, persistAgents,
		);
	}

	// Poll for the specific transcript file to appear
	const pollTimer = setInterval(() => {
		try {
			if (fs.existsSync(agent.jsonlFile)) {
				console.log(`[Pixel Agents] Agent ${id}: found transcript file ${path.basename(agent.jsonlFile)}`);
				clearInterval(pollTimer);
				jsonlPollTimers.delete(id);
				startFileWatching(id, agent.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
				readNewLines(id, agents, waitingTimers, permissionTimers, webview);
			}
		} catch { /* file may not exist yet */ }
	}, JSONL_POLL_INTERVAL_MS);
	jsonlPollTimers.set(id, pollTimer);
}

/**
 * Adopt an existing VS Code terminal as an agent (for vscode-terminal type).
 * Allows users to connect any running terminal to the pixel agents display.
 */
export async function adoptExistingTerminal(
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	activeAgentIdRef: { current: number | null },
	webview: vscode.Webview | undefined,
	persistAgents: () => void,
): Promise<void> {
	// Get all terminals not already owned by an agent
	const ownedTerminals = new Set<vscode.Terminal>();
	for (const agent of agents.values()) {
		ownedTerminals.add(agent.terminalRef);
	}
	const availableTerminals = vscode.window.terminals.filter(t => !ownedTerminals.has(t));

	if (availableTerminals.length === 0) {
		vscode.window.showInformationMessage('Pixel Agents: No unassigned terminals found. Open a terminal first.');
		return;
	}

	const items = availableTerminals.map(t => ({
		label: t.name,
		terminal: t,
	}));

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a terminal to connect as an agent',
	});
	if (!picked) return;

	const terminal = picked.terminal;
	const folders = vscode.workspace.workspaceFolders;
	const isMultiRoot = !!(folders && folders.length > 1);

	const id = nextAgentIdRef.current++;
	const folderName = isMultiRoot ? path.basename(folders?.[0]?.uri.fsPath || '') : undefined;
	const agent: AgentState = {
		id,
		agentType: 'vscode-terminal',
		terminalRef: terminal,
		projectDir: '',
		jsonlFile: '',
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
	console.log(`[Pixel Agents] Agent ${id} (vscode-terminal): adopted terminal "${terminal.name}"`);
	webview?.postMessage({ type: 'agentCreated', id, folderName, agentType: 'vscode-terminal' });
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
	if (jpTimer) { clearInterval(jpTimer); }
	jsonlPollTimers.delete(agentId);

	// Stop file watching
	fileWatchers.get(agentId)?.close();
	fileWatchers.delete(agentId);
	const pt = pollingTimers.get(agentId);
	if (pt) { clearInterval(pt); }
	pollingTimers.delete(agentId);
	try { fs.unwatchFile(agent.jsonlFile); } catch { /* ignore */ }

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
			agentType: agent.agentType,
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
		const terminal = liveTerminals.find(t => t.name === p.terminalName);
		if (!terminal) continue;

		const agentType = p.agentType || 'claude-code'; // backwards compat

		const agent: AgentState = {
			id: p.id,
			agentType,
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
			isWaiting: false,
			permissionSent: false,
			hadToolsInTurn: false,
			folderName: p.folderName,
		};

		agents.set(p.id, agent);
		if (p.jsonlFile) {
			knownJsonlFiles.add(p.jsonlFile);
		}
		console.log(`[Pixel Agents] Restored agent ${p.id} (${agentType}) → terminal "${p.terminalName}"`);

		if (p.id > maxId) maxId = p.id;
		// Extract terminal index from name like "Claude Code #3" or "Opencode #3"
		const match = p.terminalName.match(/#(\d+)$/);
		if (match) {
			const idx = parseInt(match[1], 10);
			if (idx > maxIdx) maxIdx = idx;
		}

		restoredProjectDir = p.projectDir || restoredProjectDir;

		// Only set up file watching for agent types that have transcript files
		const typeConfig = getAgentTypeConfig(agentType);
		if (typeConfig.hasTranscriptFiles && p.jsonlFile) {
			// Start file watching if transcript exists, skipping to end of file
			try {
				if (fs.existsSync(p.jsonlFile)) {
					const stat = fs.statSync(p.jsonlFile);
					agent.fileOffset = stat.size;
					startFileWatching(p.id, p.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
				} else {
					// Poll for the file to appear
					const pollTimer = setInterval(() => {
						try {
							if (fs.existsSync(agent.jsonlFile)) {
								console.log(`[Pixel Agents] Restored agent ${p.id}: found transcript file`);
								clearInterval(pollTimer);
								jsonlPollTimers.delete(p.id);
								const stat = fs.statSync(agent.jsonlFile);
								agent.fileOffset = stat.size;
								startFileWatching(p.id, agent.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
							}
						} catch { /* file may not exist yet */ }
					}, JSONL_POLL_INTERVAL_MS);
					jsonlPollTimers.set(p.id, pollTimer);
				}
			} catch { /* ignore errors during restore */ }
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
			restoredProjectDir, knownJsonlFiles, projectScanTimerRef, activeAgentIdRef,
			nextAgentIdRef, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			webview, doPersist,
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
	const agentMeta = context.workspaceState.get<Record<string, { palette?: number; seatId?: string }>>(WORKSPACE_KEY_AGENT_SEATS, {});

	// Include folderName and agentType per agent
	const folderNames: Record<number, string> = {};
	const agentTypes: Record<number, string> = {};
	for (const [id, agent] of agents) {
		if (agent.folderName) {
			folderNames[id] = agent.folderName;
		}
		agentTypes[id] = agent.agentType;
	}
	console.log(`[Pixel Agents] sendExistingAgents: agents=${JSON.stringify(agentIds)}, meta=${JSON.stringify(agentMeta)}`);

	webview.postMessage({
		type: 'existingAgents',
		agents: agentIds,
		agentMeta,
		folderNames,
		agentTypes,
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
	const layout = migrateAndLoadLayout(context, defaultLayout);
	webview.postMessage({
		type: 'layoutLoaded',
		layout,
	});
}
