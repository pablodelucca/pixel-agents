import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentProvider, AgentState, PersistedAgent } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer } from './timerManager.js';
import { startFileWatching, readNewLines, ensureProjectScan } from './fileWatcher.js';
import { JSONL_POLL_INTERVAL_MS, WORKSPACE_KEY_AGENTS, WORKSPACE_KEY_AGENT_SEATS } from './constants.js';
import { migrateAndLoadLayout } from './layoutPersistence.js';
import { PROVIDER_DEFINITIONS } from './providers.js';

function findNewestSessionFile(
	rootDir: string,
	match: (name: string) => boolean,
	claimedSessionFiles: Set<string>,
): string | null {
	if (!rootDir || !fs.existsSync(rootDir)) return null;
	const stack: string[] = [rootDir];
	let newestUnclaimed: { file: string; mtime: number } | null = null;
	let newestAny: { file: string; mtime: number } | null = null;

	while (stack.length > 0) {
		const dir = stack.pop();
		if (!dir) break;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				stack.push(full);
				continue;
			}
			if (!entry.isFile() || !match(entry.name)) continue;
			let stat: fs.Stats;
			try {
				stat = fs.statSync(full);
			} catch {
				continue;
			}
			if (!newestAny || stat.mtimeMs > newestAny.mtime) {
				newestAny = { file: full, mtime: stat.mtimeMs };
			}
			if (!claimedSessionFiles.has(full) && (!newestUnclaimed || stat.mtimeMs > newestUnclaimed.mtime)) {
				newestUnclaimed = { file: full, mtime: stat.mtimeMs };
			}
		}
	}

	return newestUnclaimed?.file ?? newestAny?.file ?? null;
}

export function getProjectDirPath(provider: AgentProvider, cwd?: string): string | null {
	return PROVIDER_DEFINITIONS[provider].getProjectDirPath(cwd);
}

export async function launchNewTerminal(
	nextAgentIdRef: { current: number },
	nextTerminalIndexRef: { current: number },
	agents: Map<number, AgentState>,
	activeAgentIdRef: { current: number | null },
	knownJsonlFiles: Set<string>,
	claimedSessionFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
	webview: vscode.Webview | undefined,
	persistAgentsFn: () => void,
	provider: AgentProvider,
	folderPath?: string,
): Promise<void> {
	const folders = vscode.workspace.workspaceFolders;
	const cwd = folderPath || folders?.[0]?.uri.fsPath;
	if (!cwd) {
		vscode.window.showErrorMessage('Pixel Agents: Open a workspace folder in this window before creating an agent.');
		return;
	}
	const isMultiRoot = !!(folders && folders.length > 1);
	const def = PROVIDER_DEFINITIONS[provider];
	const idx = nextTerminalIndexRef.current++;
	const terminal = vscode.window.createTerminal({
		name: `${def.terminalPrefix} #${idx}`,
		cwd,
	});
	terminal.show();

	const launchTime = Date.now();
	const sessionId = provider === 'claude' ? crypto.randomUUID() : undefined;
	terminal.sendText(def.commandForLaunch(sessionId));

	const projectDir = def.getProjectDirPath(cwd) || '';
	const id = nextAgentIdRef.current++;
	const folderName = isMultiRoot && cwd ? path.basename(cwd) : undefined;
	const expected = def.resolveSessionFile(cwd, { sessionId, launchedAt: launchTime }, claimedSessionFiles);
	if (expected) {
		knownJsonlFiles.add(expected);
	}

	const agent: AgentState = {
		id,
		terminalRef: terminal,
		provider,
		projectDir,
		jsonlFile: expected || '',
		sessionFormat: def.sessionFormat,
		sessionId,
		launchTime,
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
	persistAgentsFn();
	webview?.postMessage({ type: 'agentCreated', id, folderName, provider });

	// Keep /clear detection only for Claude projects.
	if (provider === 'claude' && projectDir) {
		ensureProjectScan(
			projectDir, knownJsonlFiles, projectScanTimerRef, activeAgentIdRef,
			nextAgentIdRef, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			webview, persistAgentsFn,
		);
	}

	let pollAttempts = 0;
	const pollTimer = setInterval(() => {
		pollAttempts++;
		let found = def.resolveSessionFile(cwd, { sessionId, launchedAt: launchTime }, claimedSessionFiles);
		// Some CLIs reuse an existing session file and may not emit fresh metadata immediately.
		// After a short delay, fall back to the newest provider session file so the agent can bind.
		if (!found && provider !== 'claude' && pollAttempts >= 15) {
			const providerRoot = def.getProjectDirPath(cwd) || '';
			found = provider === 'codex'
				? findNewestSessionFile(providerRoot, name => name.startsWith('rollout-') && name.endsWith('.jsonl'), claimedSessionFiles)
				: findNewestSessionFile(providerRoot, name => /^session-.*\.json$/.test(name), claimedSessionFiles);
		}
		if (!found) return;
		try {
			if (fs.existsSync(found)) {
				agent.jsonlFile = found;
				knownJsonlFiles.add(found);
				claimedSessionFiles.add(found);
				clearInterval(pollTimer);
				jsonlPollTimers.delete(id);
				startFileWatching(id, found, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
				readNewLines(id, agents, waitingTimers, permissionTimers, webview);
				persistAgentsFn();
			}
		} catch {
			// wait for session file
		}
	}, JSONL_POLL_INTERVAL_MS);
	jsonlPollTimers.set(id, pollTimer);
}

export function removeAgent(
	agentId: number,
	agents: Map<number, AgentState>,
	claimedSessionFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	persistAgentsFn: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;

	const jpTimer = jsonlPollTimers.get(agentId);
	if (jpTimer) { clearInterval(jpTimer); }
	jsonlPollTimers.delete(agentId);

	fileWatchers.get(agentId)?.close();
	fileWatchers.delete(agentId);
	const pt = pollingTimers.get(agentId);
	if (pt) { clearInterval(pt); }
	pollingTimers.delete(agentId);
	try { fs.unwatchFile(agent.jsonlFile); } catch { /* ignore */ }

	cancelWaitingTimer(agentId, waitingTimers);
	cancelPermissionTimer(agentId, permissionTimers);
	if (agent.jsonlFile) {
		claimedSessionFiles.delete(agent.jsonlFile);
	}
	agents.delete(agentId);
	persistAgentsFn();
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
			provider: agent.provider,
			sessionFormat: agent.sessionFormat,
			sessionId: agent.sessionId,
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
	claimedSessionFiles: Set<string>,
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
	let restoredClaudeProjectDir: string | null = null;

	for (const p of persisted) {
		const terminal = liveTerminals.find(t => t.name === p.terminalName);
		if (!terminal) continue;
		const provider = p.provider || 'claude';
		const def = PROVIDER_DEFINITIONS[provider];
		const agent: AgentState = {
			id: p.id,
			terminalRef: terminal,
			provider,
			projectDir: p.projectDir,
			jsonlFile: p.jsonlFile,
			sessionFormat: p.sessionFormat || def.sessionFormat,
			sessionId: p.sessionId,
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
			claimedSessionFiles.add(p.jsonlFile);
		}

		if (p.id > maxId) maxId = p.id;
		const match = p.terminalName.match(/#(\d+)$/);
		if (match) {
			const idx = parseInt(match[1], 10);
			if (idx > maxIdx) maxIdx = idx;
		}
		if (provider === 'claude' && p.projectDir) {
			restoredClaudeProjectDir = p.projectDir;
		}

		try {
			if (p.jsonlFile && fs.existsSync(p.jsonlFile)) {
				const stat = fs.statSync(p.jsonlFile);
				agent.fileOffset = stat.size;
				startFileWatching(p.id, p.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
			} else if (p.jsonlFile) {
				const pollTimer = setInterval(() => {
					try {
						if (fs.existsSync(agent.jsonlFile)) {
							clearInterval(pollTimer);
							jsonlPollTimers.delete(p.id);
							const stat = fs.statSync(agent.jsonlFile);
							agent.fileOffset = stat.size;
							startFileWatching(p.id, agent.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
						}
					} catch {
						// keep polling
					}
				}, JSONL_POLL_INTERVAL_MS);
				jsonlPollTimers.set(p.id, pollTimer);
			}
		} catch {
			// ignore restore errors
		}
	}

	if (maxId >= nextAgentIdRef.current) {
		nextAgentIdRef.current = maxId + 1;
	}
	if (maxIdx >= nextTerminalIndexRef.current) {
		nextTerminalIndexRef.current = maxIdx + 1;
	}

	doPersist();

	if (restoredClaudeProjectDir) {
		ensureProjectScan(
			restoredClaudeProjectDir, knownJsonlFiles, projectScanTimerRef, activeAgentIdRef,
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
	const providers: Record<number, AgentProvider> = {};
	for (const [id, agent] of agents) {
		agentIds.push(id);
		providers[id] = agent.provider;
	}
	agentIds.sort((a, b) => a - b);

	const agentMeta = context.workspaceState.get<Record<string, { palette?: number; seatId?: string }>>(WORKSPACE_KEY_AGENT_SEATS, {});
	const folderNames: Record<number, string> = {};
	for (const [id, agent] of agents) {
		if (agent.folderName) {
			folderNames[id] = agent.folderName;
		}
	}

	webview.postMessage({
		type: 'existingAgents',
		agents: agentIds,
		agentMeta,
		folderNames,
		providers,
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

