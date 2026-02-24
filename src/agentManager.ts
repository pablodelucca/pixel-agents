import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentRuntime, AgentState, PersistedAgent } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer } from './timerManager.js';
import { startFileWatching, readNewLines, ensureProjectScan } from './fileWatcher.js';
import type { ProjectScanState } from './fileWatcher.js';
import { JSONL_POLL_INTERVAL_MS, WORKSPACE_KEY_AGENTS, WORKSPACE_KEY_AGENT_SEATS } from './constants.js';
import { migrateAndLoadLayout } from './layoutPersistence.js';
import {
	DEFAULT_AGENT_RUNTIME,
	normalizeAgentRuntime,
	getProjectDirPathForRuntime,
	getClaudeSessionsRootPath,
	getRuntimeLaunchCommand,
	getTerminalNamePrefix,
} from './runtime.js';

function createAgentState(
	id: number,
	runtime: AgentRuntime,
	terminalRef: vscode.Terminal,
	projectDir: string,
	jsonlFile: string,
	pendingSessionId?: string,
): AgentState {
	return {
		id,
		runtime,
		pendingSessionId,
		terminalRef,
		projectDir,
		jsonlFile,
		fileOffset: 0,
		lineBuffer: '',
		activeToolIds: new Set(),
		activeToolStatuses: new Map(),
		activeToolNames: new Map(),
		activeToolCallToName: new Map(),
		activeSubagentToolIds: new Map(),
		activeSubagentToolNames: new Map(),
		isWaiting: false,
		permissionSent: false,
		hadToolsInTurn: false,
	};
}

export function getProjectDirPath(cwd?: string, runtime: AgentRuntime = DEFAULT_AGENT_RUNTIME): string | null {
	return getProjectDirPathForRuntime(runtime, cwd);
}

export function launchNewTerminal(
	runtime: AgentRuntime,
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
	projectScanStateRef: ProjectScanState,
	webview: vscode.Webview | undefined,
	persistAgents: () => void,
): void {
	const idx = nextTerminalIndexRef.current++;
	const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	const terminal = vscode.window.createTerminal({
		name: `${getTerminalNamePrefix(runtime)} #${idx}`,
		cwd,
	});
	terminal.show();

	const sessionId = crypto.randomUUID();
	terminal.sendText(getRuntimeLaunchCommand(runtime, cwd, sessionId));

	const projectDir = getProjectDirPath(cwd, runtime) ?? (runtime === 'claude' ? getClaudeSessionsRootPath() : null);
	if (!projectDir) {
		console.log(`[Pixel Agents] No project dir for runtime ${runtime}, cannot track agent`);
		return;
	}

	let jsonlFile = '';
	if (runtime === 'claude' && cwd) {
		// Pre-register expected JSONL file so project scan won't treat it as a /clear file.
		jsonlFile = path.join(projectDir, `${sessionId}.jsonl`);
		knownJsonlFiles.add(jsonlFile);
	}

	const id = nextAgentIdRef.current++;
	const agent = createAgentState(id, runtime, terminal, projectDir, jsonlFile, runtime === 'claude' ? sessionId : undefined);
	agents.set(id, agent);
	activeAgentIdRef.current = id;
	persistAgents();
	console.log(`[Pixel Agents] Agent ${id}: created for terminal ${terminal.name} (runtime=${runtime})`);
	webview?.postMessage({ type: 'agentCreated', id });

	ensureProjectScan(
		runtime,
		projectDir,
		knownJsonlFiles,
		projectScanStateRef,
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

	if (runtime !== 'claude' || !agent.jsonlFile) {
		return;
	}

	// Claude only: poll for the specific JSONL file to appear.
	const pollTimer = setInterval(() => {
		try {
			if (agent.jsonlFile && fs.existsSync(agent.jsonlFile)) {
				console.log(`[Pixel Agents] Agent ${id}: found JSONL file ${path.basename(agent.jsonlFile)}`);
				clearInterval(pollTimer);
				jsonlPollTimers.delete(id);
				startFileWatching(id, agent.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
				readNewLines(id, agents, waitingTimers, permissionTimers, webview);
			}
		} catch {
			// File may not exist yet.
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
			runtime: agent.runtime,
			terminalName: agent.terminalRef.name,
			jsonlFile: agent.jsonlFile,
			projectDir: agent.projectDir,
		});
	}
	context.workspaceState.update(WORKSPACE_KEY_AGENTS, persisted);
}

export function restoreAgents(
	context: vscode.ExtensionContext,
	nextAgentIdRef: { current: number },
	nextTerminalIndexRef: { current: number },
	agents: Map<number, AgentState>,
	knownJsonlFilesByRuntime: Record<AgentRuntime, Set<string>>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	projectScanStateRefs: Record<AgentRuntime, ProjectScanState>,
	activeAgentIdRef: { current: number | null },
	webview: vscode.Webview | undefined,
	doPersist: () => void,
): void {
	const persisted = context.workspaceState.get<PersistedAgent[]>(WORKSPACE_KEY_AGENTS, []);
	if (persisted.length === 0) return;

	const liveTerminals = vscode.window.terminals;
	let maxId = 0;
	let maxIdx = 0;
	const scanTargets = new Map<AgentRuntime, string>();

	for (const p of persisted) {
		const terminal = liveTerminals.find((t) => t.name === p.terminalName);
		if (!terminal) continue;

		const runtime = normalizeAgentRuntime(p.runtime);
		const knownJsonlFiles = knownJsonlFilesByRuntime[runtime];
		const initialJsonl = runtime === 'codex' ? (p.jsonlFile || '') : p.jsonlFile;
		const agent = createAgentState(p.id, runtime, terminal, p.projectDir, initialJsonl);
		agents.set(p.id, agent);
		if (agent.jsonlFile) {
			knownJsonlFiles.add(agent.jsonlFile);
		}
		console.log(`[Pixel Agents] Restored agent ${p.id} → terminal "${p.terminalName}" (runtime=${runtime})`);

		if (p.id > maxId) maxId = p.id;
		const match = p.terminalName.match(/#(\d+)$/);
		if (match) {
			const idx = parseInt(match[1], 10);
			if (idx > maxIdx) maxIdx = idx;
		}
		scanTargets.set(runtime, p.projectDir);

		try {
			if (agent.jsonlFile && fs.existsSync(agent.jsonlFile)) {
				const stat = fs.statSync(agent.jsonlFile);
				agent.fileOffset = stat.size;
				startFileWatching(p.id, agent.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
			} else if (runtime === 'claude' && agent.jsonlFile) {
				const pollTimer = setInterval(() => {
					try {
						if (agent.jsonlFile && fs.existsSync(agent.jsonlFile)) {
							console.log(`[Pixel Agents] Restored agent ${p.id}: found JSONL file`);
							clearInterval(pollTimer);
							jsonlPollTimers.delete(p.id);
							const stat = fs.statSync(agent.jsonlFile);
							agent.fileOffset = stat.size;
							startFileWatching(p.id, agent.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
						}
					} catch {
						// File may not exist yet.
					}
				}, JSONL_POLL_INTERVAL_MS);
				jsonlPollTimers.set(p.id, pollTimer);
			} else if (runtime === 'codex') {
				agent.jsonlFile = '';
			}
		} catch {
			// Ignore errors during restore.
		}
	}

	if (maxId >= nextAgentIdRef.current) {
		nextAgentIdRef.current = maxId + 1;
	}
	if (maxIdx >= nextTerminalIndexRef.current) {
		nextTerminalIndexRef.current = maxIdx + 1;
	}

	doPersist();

	for (const [runtime, projectDir] of scanTargets) {
		ensureProjectScan(
			runtime,
			projectDir,
			knownJsonlFilesByRuntime[runtime],
			projectScanStateRefs[runtime],
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

	const agentMeta = context.workspaceState.get<Record<string, { palette?: number; seatId?: string }>>(WORKSPACE_KEY_AGENT_SEATS, {});
	console.log(`[Pixel Agents] sendExistingAgents: agents=${JSON.stringify(agentIds)}, meta=${JSON.stringify(agentMeta)}`);

	webview.postMessage({
		type: 'existingAgents',
		agents: agentIds,
		agentMeta,
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
	const layout = migrateAndLoadLayout(context, defaultLayout);
	webview.postMessage({
		type: 'layoutLoaded',
		layout,
	});
}
