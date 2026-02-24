import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentRuntime, AgentState } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer, clearAgentActivity } from './timerManager.js';
import { processTranscriptLine } from './transcriptParser.js';
import { FILE_WATCHER_POLL_INTERVAL_MS, PROJECT_SCAN_INTERVAL_MS } from './constants.js';
import { getClaudeSessionsRootPath } from './runtime.js';
import { listJsonlFilesRecursive } from './sessionFiles.js';
import {
	findNewestUnassignedMatchingCodexFile,
	findPendingCodexAgent,
	listCodexJsonlFiles,
	matchesWorkspaceCodexSession,
} from './codex/session.js';

export interface ProjectScanState {
	current: ReturnType<typeof setInterval> | null;
	runtime: AgentRuntime | null;
	projectDir: string | null;
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
	runtime: AgentRuntime,
	projectDir: string,
	knownJsonlFiles: Set<string>,
	projectScanStateRef: ProjectScanState,
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
	if (
		projectScanStateRef.current &&
		projectScanStateRef.runtime === runtime &&
		projectScanStateRef.projectDir === projectDir
	) {
		return;
	}

	if (projectScanStateRef.current) {
		clearInterval(projectScanStateRef.current);
	}
	projectScanStateRef.current = null;
	projectScanStateRef.runtime = runtime;
	projectScanStateRef.projectDir = projectDir;

	seedKnownJsonlFiles(runtime, projectDir, knownJsonlFiles);

	projectScanStateRef.current = setInterval(() => {
		scanForNewJsonlFiles(
			runtime,
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

function seedKnownJsonlFiles(
	runtime: AgentRuntime,
	projectDir: string,
	knownJsonlFiles: Set<string>,
): void {
	try {
		const files = runtime === 'codex' || path.resolve(projectDir) === path.resolve(getClaudeSessionsRootPath())
			? listJsonlFilesRecursive(projectDir)
			: fs.readdirSync(projectDir)
				.filter((f) => f.endsWith('.jsonl'))
				.map((f) => path.join(projectDir, f));
		for (const file of files) {
			knownJsonlFiles.add(file);
		}
	} catch {
		// Directory may not exist yet.
	}
}

function scanForNewJsonlFiles(
	runtime: AgentRuntime,
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
	if (runtime === 'codex') {
		scanForNewCodexJsonlFiles(
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
		return;
	}

	scanForNewClaudeJsonlFiles(
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
}

function scanForNewClaudeJsonlFiles(
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
		files = listCodexJsonlFiles(projectDir);
	} catch {
		return;
	}
	const isGlobalClaudeRoot = path.resolve(projectDir) === path.resolve(getClaudeSessionsRootPath());

	for (const file of files) {
		if (knownJsonlFiles.has(file)) continue;
		knownJsonlFiles.add(file);

		const pendingMatch = findPendingClaudeAgentForFile(agents, file);
		if (pendingMatch) {
			reassignAgentToFile(
				pendingMatch.id,
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

		// When scanning the global Claude sessions root (no workspace cwd available),
		// do not run /clear/adoption heuristics on unrelated files.
		if (isGlobalClaudeRoot) continue;

		if (activeAgentIdRef.current !== null) {
			console.log(`[Pixel Agents] New Claude JSONL detected: ${path.basename(file)}, reassigning to agent ${activeAgentIdRef.current}`);
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

		const activeTerminal = vscode.window.activeTerminal;
		if (!activeTerminal) continue;
		let owned = false;
		for (const agent of agents.values()) {
			if (agent.terminalRef === activeTerminal) {
				owned = true;
				break;
			}
		}
		if (!owned) {
			adoptTerminalForFile(
				'claude',
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

function findPendingClaudeAgentForFile(
	agents: Map<number, AgentState>,
	filePath: string,
): AgentState | undefined {
	const sessionId = path.basename(filePath, '.jsonl');
	return [...agents.values()]
		.filter((agent) => agent.runtime === 'claude' && !agent.jsonlFile && agent.pendingSessionId === sessionId)
		.sort((a, b) => b.id - a.id)[0];
}

function scanForNewCodexJsonlFiles(
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
		files = listJsonlFilesRecursive(projectDir);
	} catch {
		return;
	}

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	for (const file of files) {
		if (knownJsonlFiles.has(file)) continue;
		knownJsonlFiles.add(file);
		if (!matchesWorkspaceCodexSession(file, workspaceRoot)) continue;

		const activeAgent = activeAgentIdRef.current !== null ? agents.get(activeAgentIdRef.current) : undefined;
		if (activeAgent && activeAgent.runtime === 'codex' && !activeAgent.jsonlFile) {
			reassignAgentToFile(
				activeAgent.id,
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

		const pendingAgent = findPendingCodexAgent(agents);
		if (pendingAgent) {
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

		const activeTerminal = vscode.window.activeTerminal;
		if (!activeTerminal) continue;
		let owned = false;
		for (const agent of agents.values()) {
			if (agent.terminalRef === activeTerminal) {
				owned = true;
				break;
			}
		}
		if (!owned) {
			adoptTerminalForFile(
				'codex',
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

	// Handle a race where the new file already existed during seedKnownJsonlFiles.
	// If a Codex agent is still pending, attach it to the newest unassigned matching session.
	const pendingAgent = findPendingCodexAgent(agents);
	if (!pendingAgent) return;

	const newestFile = findNewestUnassignedMatchingCodexFile(files, agents, workspaceRoot);
	if (!newestFile) return;

	reassignAgentToFile(
		pendingAgent.id,
		newestFile,
		agents,
		fileWatchers,
		pollingTimers,
		waitingTimers,
		permissionTimers,
		webview,
		persistAgents,
	);
}

function adoptTerminalForFile(
	runtime: AgentRuntime,
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
		runtime,
		terminalRef: terminal,
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

	agents.set(id, agent);
	activeAgentIdRef.current = id;
	persistAgents();

	console.log(`[Pixel Agents] Agent ${id}: adopted terminal "${terminal.name}" for ${path.basename(jsonlFile)} (runtime=${runtime})`);
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
	agent.pendingSessionId = undefined;
	agent.fileOffset = 0;
	agent.lineBuffer = '';
	persistAgents();

	startFileWatching(agentId, newFilePath, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
	readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
}
