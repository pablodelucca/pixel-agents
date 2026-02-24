import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState, PersistedAgent, CliProvider } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer } from './timerManager.js';
import { startFileWatching, readNewLines, ensureProjectScan, type ProjectScanConfig } from './fileWatcher.js';
import { JSONL_POLL_INTERVAL_MS, WORKSPACE_KEY_AGENTS, WORKSPACE_KEY_AGENT_SEATS } from './constants.js';
import { migrateAndLoadLayout } from './layoutPersistence.js';
import { getActiveProvider, getLaunchCommand, getTerminalPrefix, getTranscriptRoot, getWorkspaceRoot } from './providerConfig.js';

type LegacyPersistedAgent = Omit<PersistedAgent, 'provider'> & { provider?: CliProvider };

function normalizePersistedAgent(p: LegacyPersistedAgent): PersistedAgent {
	return {
		id: p.id,
		provider: p.provider === 'codex' ? 'codex' : 'claude',
		terminalName: p.terminalName,
		jsonlFile: p.jsonlFile,
		projectDir: p.projectDir,
	};
}

function createAgentState(
	id: number,
	provider: CliProvider,
	terminalRef: vscode.Terminal,
	projectDir: string,
	jsonlFile: string,
): AgentState {
	return {
		id,
		provider,
		terminalRef,
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
}

export function launchNewTerminal(
	provider: CliProvider,
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
): void {
	const idx = nextTerminalIndexRef.current++;
	const workspaceRoot = getWorkspaceRoot();
	const terminal = vscode.window.createTerminal({
		name: `${getTerminalPrefix(provider)} #${idx}`,
		cwd: workspaceRoot || undefined,
	});
	terminal.show();

	const transcriptRoot = getTranscriptRoot(provider, workspaceRoot || undefined);
	if (!transcriptRoot) {
		console.log('[Pixel Agents] No transcript root available, cannot track agent');
		terminal.sendText(getLaunchCommand(provider));
		return;
	}

	const scanConfig: ProjectScanConfig = {
		provider,
		transcriptRoot,
		workspaceRoot,
	};

	if (provider === 'claude') {
		const sessionId = crypto.randomUUID();
		terminal.sendText(getLaunchCommand(provider, sessionId));

		const expectedFile = path.join(transcriptRoot, `${sessionId}.jsonl`);
		knownJsonlFiles.add(expectedFile);

		const id = nextAgentIdRef.current++;
		const agent = createAgentState(id, provider, terminal, transcriptRoot, expectedFile);

		agents.set(id, agent);
		activeAgentIdRef.current = id;
		persistAgents();
		console.log(`[Pixel Agents] Agent ${id}: created for terminal ${terminal.name}`);
		webview?.postMessage({ type: 'agentCreated', id });

		ensureProjectScan(
			scanConfig,
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

		const pollTimer = setInterval(() => {
			try {
				if (fs.existsSync(agent.jsonlFile)) {
					console.log(`[Pixel Agents] Agent ${id}: found JSONL file ${path.basename(agent.jsonlFile)}`);
					clearInterval(pollTimer);
					jsonlPollTimers.delete(id);
					startFileWatching(id, agent.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
					readNewLines(id, agents, waitingTimers, permissionTimers, webview);
				}
			} catch {
				// file may not exist yet
			}
		}, JSONL_POLL_INTERVAL_MS);
		jsonlPollTimers.set(id, pollTimer);
		return;
	}

	activeAgentIdRef.current = null;
	terminal.sendText(getLaunchCommand(provider));
	ensureProjectScan(
		scanConfig,
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
	const providersInMemory = new Set<CliProvider>([getActiveProvider()]);
	const persistedForCurrentMap: PersistedAgent[] = [];
	for (const agent of agents.values()) {
		providersInMemory.add(agent.provider);
		persistedForCurrentMap.push({
			id: agent.id,
			provider: agent.provider,
			terminalName: agent.terminalRef.name,
			jsonlFile: agent.jsonlFile,
			projectDir: agent.projectDir,
		});
	}

	const existing = context.workspaceState.get<LegacyPersistedAgent[]>(WORKSPACE_KEY_AGENTS, []);
	const preservedOtherProviders: PersistedAgent[] = [];
	for (const existingAgent of existing) {
		const normalized = normalizePersistedAgent(existingAgent);
		if (providersInMemory.has(normalized.provider)) continue;
		preservedOtherProviders.push(normalized);
	}

	context.workspaceState.update(
		WORKSPACE_KEY_AGENTS,
		[...preservedOtherProviders, ...persistedForCurrentMap],
	);
}

export function restoreAgents(
	provider: CliProvider,
	workspaceRoot: string | null,
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
	const persisted = context.workspaceState.get<LegacyPersistedAgent[]>(WORKSPACE_KEY_AGENTS, []);
	if (persisted.length === 0) return;

	const liveTerminals = vscode.window.terminals;
	let maxId = 0;
	let maxIdx = 0;
	let restoredProjectDir: string | null = null;

	for (const p of persisted) {
		const persistedProvider = normalizePersistedAgent(p).provider;
		if (persistedProvider !== provider) continue;

		const terminal = liveTerminals.find((t) => t.name === p.terminalName);
		if (!terminal) continue;

		const agent = createAgentState(p.id, persistedProvider, terminal, p.projectDir, p.jsonlFile);

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

		try {
			if (fs.existsSync(p.jsonlFile)) {
				const stat = fs.statSync(p.jsonlFile);
				agent.fileOffset = stat.size;
				startFileWatching(p.id, p.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
			} else {
				const pollTimer = setInterval(() => {
					try {
						if (fs.existsSync(agent.jsonlFile)) {
							console.log(`[Pixel Agents] Restored agent ${p.id}: found JSONL file`);
							clearInterval(pollTimer);
							jsonlPollTimers.delete(p.id);
							const stat = fs.statSync(agent.jsonlFile);
							agent.fileOffset = stat.size;
							startFileWatching(p.id, agent.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
						}
					} catch {
						// file may not exist yet
					}
				}, JSONL_POLL_INTERVAL_MS);
				jsonlPollTimers.set(p.id, pollTimer);
			}
		} catch {
			// ignore errors during restore
		}
	}

	if (maxId >= nextAgentIdRef.current) {
		nextAgentIdRef.current = maxId + 1;
	}
	if (maxIdx >= nextTerminalIndexRef.current) {
		nextTerminalIndexRef.current = maxIdx + 1;
	}

	doPersist();

	if (restoredProjectDir) {
		ensureProjectScan(
			{
				provider,
				transcriptRoot: restoredProjectDir,
				workspaceRoot,
			},
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
