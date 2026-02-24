import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState, CliProvider } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer, clearAgentActivity } from './timerManager.js';
import { processTranscriptLine } from './transcriptParser.js';
import {
	FILE_WATCHER_POLL_INTERVAL_MS,
	PROJECT_SCAN_INTERVAL_MS,
	CODEX_SESSION_META_READ_CHUNK_BYTES,
	CODEX_SESSION_META_READ_MAX_BYTES,
} from './constants.js';
import { getCodexDateDirs, getTerminalPrefix } from './providerConfig.js';

export interface ProjectScanConfig {
	provider: CliProvider;
	transcriptRoot: string;
	workspaceRoot: string | null;
}

const projectScanConfigKeys = new WeakMap<object, string>();

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
	try {
		const watcher = fs.watch(filePath, () => {
			readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
		});
		fileWatchers.set(agentId, watcher);
	} catch (e) {
		console.log(`[Pixel Agents] fs.watch failed for agent ${agentId}: ${e}`);
	}

	const interval = setInterval(() => {
		if (!agents.has(agentId)) {
			clearInterval(interval);
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
	scanConfig: ProjectScanConfig,
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
	const configKey = makeScanConfigKey(scanConfig);
	if (projectScanTimerRef.current) {
		const previousKey = projectScanConfigKeys.get(projectScanTimerRef);
		if (previousKey === configKey) return;

		clearInterval(projectScanTimerRef.current);
		projectScanTimerRef.current = null;
	}
	projectScanConfigKeys.set(projectScanTimerRef, configKey);

	for (const f of listDiscoverableJsonlFiles(scanConfig)) {
		knownJsonlFiles.add(f);
	}

	projectScanTimerRef.current = setInterval(() => {
		scanForNewJsonlFiles(
			scanConfig,
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
	scanConfig: ProjectScanConfig,
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
	const files = listDiscoverableJsonlFiles(scanConfig);

	for (const file of files) {
		if (knownJsonlFiles.has(file)) continue;
		knownJsonlFiles.add(file);

		const terminalForAdoption = findAdoptableTerminal(scanConfig.provider, agents);
		if (terminalForAdoption) {
			adoptTerminalForFile(
				terminalForAdoption,
				scanConfig.provider,
				file,
				scanConfig.transcriptRoot,
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
			continue;
		}

		if (activeAgentIdRef.current !== null) {
			console.log(`[Pixel Agents] New JSONL detected: ${path.basename(file)}, reassigning to agent ${activeAgentIdRef.current}`);
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
			continue;
		}
	}
}

function makeScanConfigKey(scanConfig: ProjectScanConfig): string {
	return `${scanConfig.provider}|${scanConfig.transcriptRoot}|${scanConfig.workspaceRoot || ''}`;
}

function isTerminalOwnedByAgent(terminal: vscode.Terminal, agents: Map<number, AgentState>): boolean {
	for (const agent of agents.values()) {
		if (agent.terminalRef === terminal) {
			return true;
		}
	}
	return false;
}

function findAdoptableTerminal(
	provider: CliProvider,
	agents: Map<number, AgentState>,
): vscode.Terminal | null {
	const expectedPrefix = `${getTerminalPrefix(provider)} #`;
	const activeTerminal = vscode.window.activeTerminal;

	if (
		activeTerminal
		&& activeTerminal.name.startsWith(expectedPrefix)
		&& !isTerminalOwnedByAgent(activeTerminal, agents)
	) {
		return activeTerminal;
	}

	const terminals = vscode.window.terminals;
	for (let i = terminals.length - 1; i >= 0; i -= 1) {
		const terminal = terminals[i];
		if (!terminal.name.startsWith(expectedPrefix)) continue;
		if (isTerminalOwnedByAgent(terminal, agents)) continue;
		return terminal;
	}

	if (activeTerminal && !isTerminalOwnedByAgent(activeTerminal, agents)) {
		return activeTerminal;
	}

	return null;
}

function listDiscoverableJsonlFiles(scanConfig: ProjectScanConfig): string[] {
	if (scanConfig.provider === 'codex') {
		return listCodexWorkspaceJsonlFiles(scanConfig.transcriptRoot, scanConfig.workspaceRoot);
	}
	return listFlatJsonlFiles(scanConfig.transcriptRoot);
}

function listFlatJsonlFiles(projectDir: string): string[] {
	try {
		return fs.readdirSync(projectDir)
			.filter((f) => f.endsWith('.jsonl'))
			.map((f) => path.join(projectDir, f));
	} catch {
		return [];
	}
}

function listCodexWorkspaceJsonlFiles(sessionsRoot: string, workspaceRoot: string | null): string[] {
	if (!workspaceRoot) return [];

	const files: string[] = [];
	const dateDirs = getCodexDateDirs(sessionsRoot);
	for (const dir of dateDirs) {
		let entries: string[];
		try {
			entries = fs.readdirSync(dir);
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (!entry.endsWith('.jsonl')) continue;
			const filePath = path.join(dir, entry);
			if (codexJsonlMatchesWorkspace(filePath, workspaceRoot)) {
				files.push(filePath);
			}
		}
	}

	return files;
}

function codexJsonlMatchesWorkspace(filePath: string, workspaceRoot: string): boolean {
	const firstLine = readFirstLine(filePath);
	if (!firstLine) return false;

	try {
		const record = JSON.parse(firstLine) as { type?: string; payload?: { cwd?: string } };
		return record.type === 'session_meta' && record.payload?.cwd === workspaceRoot;
	} catch {
		return false;
	}
}

function readFirstLine(filePath: string): string | null {
	let fd: number | null = null;
	const parts: string[] = [];
	let position = 0;
	let remainingBytes = CODEX_SESSION_META_READ_MAX_BYTES;

	try {
		fd = fs.openSync(filePath, 'r');
		const buffer = Buffer.alloc(CODEX_SESSION_META_READ_CHUNK_BYTES);

		while (remainingBytes > 0) {
			const bytesToRead = Math.min(buffer.length, remainingBytes);
			const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, position);
			if (bytesRead <= 0) break;

			position += bytesRead;
			remainingBytes -= bytesRead;

			const chunk = buffer.toString('utf-8', 0, bytesRead);
			const newlineIdx = chunk.indexOf('\n');
			if (newlineIdx >= 0) {
				parts.push(chunk.slice(0, newlineIdx));
				return parts.join('');
			}
			parts.push(chunk);
		}
	} catch {
		return null;
	} finally {
		if (fd !== null) {
			try {
				fs.closeSync(fd);
			} catch {
				// ignore close failures
			}
		}
	}

	if (parts.length === 0) return null;
	return parts.join('');
}

function adoptTerminalForFile(
	terminal: vscode.Terminal,
	provider: CliProvider,
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

	fileWatchers.get(agentId)?.close();
	fileWatchers.delete(agentId);
	const pt = pollingTimers.get(agentId);
	if (pt) {
		clearInterval(pt);
	}
	pollingTimers.delete(agentId);

	cancelWaitingTimer(agentId, waitingTimers);
	cancelPermissionTimer(agentId, permissionTimers);
	clearAgentActivity(agent, agentId, permissionTimers, webview);

	agent.jsonlFile = newFilePath;
	agent.fileOffset = 0;
	agent.lineBuffer = '';
	persistAgents();

	startFileWatching(agentId, newFilePath, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
	readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
}
