import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentProvider, AgentState } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer, clearAgentActivity } from './timerManager.js';
import { processTranscriptLine } from './transcriptParser.js';
import { FILE_WATCHER_POLL_INTERVAL_MS, PROJECT_SCAN_INTERVAL_MS } from './constants.js';
import { getProviderFromTerminalName } from './providers.js';

const CODEX_CWD_SCAN_BYTES = 1024 * 1024;

interface CodexSessionMeta {
	sessionId: string | null;
	cwd: string | null;
	parentThreadId: string | null;
	nickname: string | null;
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
				// ignore
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
	if (!agent || !agent.jsonlFile) return;
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

		const shouldClearTimers = lines.some((line) => {
			if (!line.trim()) return false;
			return shouldClearTimersForIncomingLine(agent.provider, line);
		});
		if (shouldClearTimers) {
			// New meaningful activity — cancel timers.
			// For Codex, ignore token_count/noise lines so approval waits still surface.
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

function listJsonlFiles(projectDir: string, provider: AgentProvider): string[] {
	if (provider === 'claude') {
		return fs.readdirSync(projectDir)
			.filter(f => f.endsWith('.jsonl'))
			.map(f => path.join(projectDir, f));
	}

	const files: string[] = [];
	const dirs: string[] = [projectDir];
	while (dirs.length > 0) {
		const dir = dirs.pop();
		if (!dir) continue;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				dirs.push(fullPath);
			} else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
				files.push(fullPath);
			}
		}
	}
	return files;
}

function normalizePathForCompare(filePath: string): string {
	const resolved = path.resolve(filePath);
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSameOrChildPath(candidate: string, parent: string): boolean {
	const normalizedCandidate = normalizePathForCompare(candidate);
	const normalizedParent = normalizePathForCompare(parent);
	return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(normalizedParent + path.sep);
}

function asRecord(value: unknown): Record<string, unknown> {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

function shouldClearTimersForIncomingLine(provider: AgentProvider, line: string): boolean {
	// Keep existing behavior for Claude transcripts: any data means active turn progress.
	if (provider !== 'codex') return true;

	try {
		const record = JSON.parse(line) as Record<string, unknown>;
		if (record.type === 'response_item') {
			const payload = asRecord(record.payload);
			const payloadType = typeof payload.type === 'string' ? payload.type : '';
			return payloadType === 'function_call'
				|| payloadType === 'function_call_output'
				|| payloadType === 'custom_tool_call'
				|| payloadType === 'custom_tool_call_output'
				|| payloadType === 'web_search_call';
		}
		if (record.type === 'event_msg') {
			const payload = asRecord(record.payload);
			const eventType = typeof payload.type === 'string' ? payload.type : '';
			return eventType === 'task_started' || eventType === 'task_complete';
		}
	} catch {
		// Ignore malformed lines
	}
	return false;
}

function readCodexSessionMeta(filePath: string): CodexSessionMeta {
	const meta: CodexSessionMeta = {
		sessionId: null,
		cwd: null,
		parentThreadId: null,
		nickname: null,
	};

	try {
		const fd = fs.openSync(filePath, 'r');
		const buf = Buffer.alloc(CODEX_CWD_SCAN_BYTES);
		const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
		fs.closeSync(fd);
		const text = buf.toString('utf-8', 0, bytesRead);
		const lines = text.split('\n');
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const record = JSON.parse(line) as Record<string, unknown>;
				if (record.type === 'session_meta') {
					const payload = asRecord(record.payload);
					if (typeof payload.id === 'string') {
						meta.sessionId = payload.id;
					}
					if (typeof payload.cwd === 'string') {
						meta.cwd = payload.cwd;
					}
					if (typeof payload.agent_nickname === 'string') {
						meta.nickname = payload.agent_nickname;
					}

					const source = asRecord(payload.source);
					const subagent = asRecord(source.subagent);
					const threadSpawn = asRecord(subagent.thread_spawn);
					if (typeof threadSpawn.parent_thread_id === 'string') {
						meta.parentThreadId = threadSpawn.parent_thread_id;
					}
				}

				if (!meta.cwd && record.type === 'turn_context') {
					const payload = asRecord(record.payload);
					if (typeof payload.cwd === 'string') {
						meta.cwd = payload.cwd;
					}
				}
			} catch {
				// ignore malformed JSON lines
			}
			if (meta.sessionId && meta.cwd && meta.parentThreadId) {
				break;
			}
		}
	} catch {
		// ignore read failures
	}

	return meta;
}

function getCodexSessionCwd(filePath: string): string | null {
	return readCodexSessionMeta(filePath).cwd;
}

function isCodexFileLikelyForAgent(filePath: string, agent: AgentState): boolean {
	if (!agent.pendingSessionLink) return false;
	const meta = readCodexSessionMeta(filePath);
	if (meta.parentThreadId) {
		return false;
	}
	if (agent.cwd) {
		const fileCwd = meta.cwd ?? getCodexSessionCwd(filePath);
		if (fileCwd) {
			return isSameOrChildPath(fileCwd, agent.cwd);
		}
	}
	if (typeof agent.launchTimestamp === 'number') {
		try {
			const stat = fs.statSync(filePath);
			return stat.mtimeMs >= agent.launchTimestamp - 2000;
		} catch {
			return false;
		}
	}
	return true;
}

function findPendingCodexAgentForFile(filePath: string, agents: Map<number, AgentState>): AgentState | null {
	const pending = [...agents.values()]
		.filter(agent => agent.provider === 'codex' && agent.pendingSessionLink)
		.sort((a, b) => (b.launchTimestamp || 0) - (a.launchTimestamp || 0));
	for (const agent of pending) {
		if (isCodexFileLikelyForAgent(filePath, agent)) {
			return agent;
		}
	}
	return null;
}

function findCodexAgentBySessionId(
	parentSessionId: string,
	agents: Map<number, AgentState>,
): AgentState | null {
	for (const agent of agents.values()) {
		if (agent.provider !== 'codex') continue;
		if (agent.codexSessionId === parentSessionId) {
			return agent;
		}
	}
	return null;
}

export function ensureProjectScan(
	projectDir: string,
	provider: AgentProvider,
	knownJsonlFiles: Set<string>,
	projectScanTimers: Map<string, ReturnType<typeof setInterval>>,
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
	const scanKey = `${provider}:${projectDir}`;
	if (projectScanTimers.has(scanKey)) return;

	// Seed with all existing JSONL files so we only react to truly new ones
	try {
		const files = listJsonlFiles(projectDir, provider);
		for (const f of files) {
			knownJsonlFiles.add(f);
		}
	} catch {
		// dir may not exist yet
	}

	const timer = setInterval(() => {
		scanForNewJsonlFiles(
			projectDir,
			provider,
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
	projectScanTimers.set(scanKey, timer);
}

function scanForNewJsonlFiles(
	projectDir: string,
	provider: AgentProvider,
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
		files = listJsonlFiles(projectDir, provider);
	} catch {
		return;
	}

	for (const file of files) {
		if (knownJsonlFiles.has(file)) continue;
		knownJsonlFiles.add(file);

		let codexMeta: CodexSessionMeta | null = null;
		if (provider === 'codex') {
			codexMeta = readCodexSessionMeta(file);
			if (codexMeta.parentThreadId) {
				const parentAgent = findCodexAgentBySessionId(codexMeta.parentThreadId, agents);
				if (parentAgent && codexMeta.sessionId) {
					const parentToolId = `codex-subagent:${codexMeta.sessionId}`;
					const label = (codexMeta.nickname || 'Sub-agent').trim() || 'Sub-agent';
					parentAgent.codexSubagentParentToolIds.set(codexMeta.sessionId, parentToolId);
					parentAgent.codexSubagentLabels.set(codexMeta.sessionId, label);
					webview?.postMessage({
						type: 'codexSubagentLinked',
						id: parentAgent.id,
						parentToolId,
						subagentId: codexMeta.sessionId,
						label,
					});
					console.log(`[Pixel Agents] Linked Codex sub-agent session ${codexMeta.sessionId} -> parent agent ${parentAgent.id}`);
				}
				// Never treat Codex thread_spawn files as primary terminal transcripts.
				continue;
			}
		}

		const activeAgentId = activeAgentIdRef.current;
		if (activeAgentId !== null) {
			const activeAgent = agents.get(activeAgentId);
			if (!activeAgent) continue;
			if (activeAgent.provider !== provider) continue;
			if (provider === 'codex' && !isCodexFileLikelyForAgent(file, activeAgent)) {
				continue;
			}
			console.log(`[Pixel Agents] New JSONL detected: ${path.basename(file)}, reassigning to agent ${activeAgentId}`);
			reassignAgentToFile(
				activeAgentId,
				file,
				agents,
				fileWatchers,
				pollingTimers,
				waitingTimers,
				permissionTimers,
				webview,
				persistAgents,
			);
			continue;
		}

		if (provider === 'codex') {
			const pendingAgent = findPendingCodexAgentForFile(file, agents);
			if (!pendingAgent) continue;
			console.log(`[Pixel Agents] New Codex JSONL detected: ${path.basename(file)}, assigning to pending agent ${pendingAgent.id}`);
			reassignAgentToFile(
				pendingAgent.id,
				file,
				agents,
				fileWatchers,
				pollingTimers,
				waitingTimers,
				permissionTimers,
				webview,
				persistAgents,
			);
			continue;
		}

		// No active agent: preserve external-terminal adoption for Claude only.
		if (provider !== 'claude') continue;
		const activeTerminal = vscode.window.activeTerminal;
		if (!activeTerminal) continue;
		if (getProviderFromTerminalName(activeTerminal.name) !== 'claude') continue;

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
				provider,
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

function adoptTerminalForFile(
	terminal: vscode.Terminal,
	jsonlFile: string,
	projectDir: string,
	provider: AgentProvider,
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
		provider,
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
		codexPendingSpawnCalls: new Map(),
		codexSubagentLabels: new Map(),
		codexSubagentParentToolIds: new Map(),
		codexWaitCallMap: new Map(),
		isWaiting: false,
		permissionSent: false,
		hadToolsInTurn: false,
	};

	agents.set(id, agent);
	activeAgentIdRef.current = id;
	persistAgents();

	console.log(`[Pixel Agents] Agent ${id}: adopted terminal "${terminal.name}" for ${path.basename(jsonlFile)}`);
	webview?.postMessage({ type: 'agentCreated', id });

	startFileWatching(id, jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
	readNewLines(id, agents, waitingTimers, permissionTimers, webview);
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
		if (agent.jsonlFile) {
			fs.unwatchFile(agent.jsonlFile);
		}
	} catch {
		// ignore
	}

	// Clear activity
	cancelWaitingTimer(agentId, waitingTimers);
	cancelPermissionTimer(agentId, permissionTimers);
	clearAgentActivity(agent, agentId, permissionTimers, webview);

	// Swap to new file
	agent.jsonlFile = newFilePath;
	agent.codexSessionId = undefined;
	agent.pendingSessionLink = false;
	agent.launchTimestamp = undefined;
	agent.fileOffset = 0;
	agent.lineBuffer = '';
	agent.codexPendingSpawnCalls.clear();
	agent.codexSubagentLabels.clear();
	agent.codexSubagentParentToolIds.clear();
	agent.codexWaitCallMap.clear();
	persistAgents();

	// Start watching new file
	startFileWatching(agentId, newFilePath, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
	readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
}
