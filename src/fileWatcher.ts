import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer, clearAgentActivity } from './timerManager.js';
import { FILE_WATCHER_POLL_INTERVAL_MS, PROJECT_SCAN_INTERVAL_MS } from './constants.js';
import type { ActivityProvider } from './activityProviders.js';

const OPENCLAW_OBSERVER_TERMINAL_NAME = 'OpenClaw Observer';

export function startFileWatching(
	agentId: number,
	filePath: string,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
	activityProvider: ActivityProvider,
): void {
	// Primary: fs.watch (unreliable on macOS — may miss events)
	try {
		const watcher = fs.watch(filePath, () => {
			readNewLines(agentId, agents, waitingTimers, permissionTimers, webview, activityProvider);
		});
		fileWatchers.set(agentId, watcher);
	} catch (e) {
		console.log(`[Pixel Agents] fs.watch failed for agent ${agentId}: ${e}`);
	}

	// Secondary: fs.watchFile (stat-based polling, reliable on macOS)
	try {
		fs.watchFile(filePath, { interval: FILE_WATCHER_POLL_INTERVAL_MS }, () => {
			readNewLines(agentId, agents, waitingTimers, permissionTimers, webview, activityProvider);
		});
	} catch (e) {
		console.log(`[Pixel Agents] fs.watchFile failed for agent ${agentId}: ${e}`);
	}

	// Tertiary: manual poll as last resort
	const interval = setInterval(() => {
		if (!agents.has(agentId)) {
			clearInterval(interval);
			try { fs.unwatchFile(filePath); } catch { /* ignore */ }
			return;
		}
		readNewLines(agentId, agents, waitingTimers, permissionTimers, webview, activityProvider);
	}, FILE_WATCHER_POLL_INTERVAL_MS);
	pollingTimers.set(agentId, interval);
}

export function readNewLines(
	agentId: number,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
	activityProvider: ActivityProvider,
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

		const hasLines = lines.some(l => l.trim());
		if (hasLines) {
			// New data arriving — treat as live activity unless overridden by a later waiting event.
			cancelWaitingTimer(agentId, waitingTimers);
			cancelPermissionTimer(agentId, permissionTimers);
			agent.isWaiting = false;
			webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
			if (agent.permissionSent) {
				agent.permissionSent = false;
				webview?.postMessage({ type: 'agentToolPermissionClear', id: agentId });
			}
		}

		for (const line of lines) {
			if (!line.trim()) continue;
			activityProvider.processLine(line, {
				agentId,
				agents,
				waitingTimers,
				permissionTimers,
				webview,
			});
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
	activityProvider: ActivityProvider,
): void {
	if (projectScanTimerRef.current) return;
	// In terminal mode (Claude), seed existing files and react only to truly new ones.
	// In session-observer mode (OpenClaw), do not seed so existing sessions can be adopted.
	if (activityProvider.mode === 'terminal') {
		try {
			const files = fs.readdirSync(projectDir)
				.filter(f => f.endsWith('.jsonl'))
				.map(f => path.join(projectDir, f));
			for (const f of files) {
				knownJsonlFiles.add(f);
			}
		} catch { /* dir may not exist yet */ }
	}

	projectScanTimerRef.current = setInterval(() => {
		scanForNewJsonlFiles(
			projectDir, knownJsonlFiles, activeAgentIdRef, nextAgentIdRef,
			agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			webview, persistAgents, activityProvider,
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
	activityProvider: ActivityProvider,
): void {
	let files: string[];
	try {
		files = fs.readdirSync(projectDir)
			.filter(f => f.endsWith('.jsonl'))
			.map(f => path.join(projectDir, f));
	} catch { return; }

	if (activityProvider.mode === 'session-observer') {
		const maxAgeMinutes = activityProvider.maxSessionAgeMinutes ?? 30;
		const cutoffMs = Date.now() - (maxAgeMinutes * 60 * 1000);
		files = files.filter(file => {
			try {
				return fs.statSync(file).mtimeMs >= cutoffMs;
			} catch {
				return false;
			}
		});
	}

	let unknownFiles = files.filter(file => !knownJsonlFiles.has(file));
	if (unknownFiles.length === 0) return;

	// First observer scan: adopt only the newest session and ignore historical backlog.
	if (activityProvider.mode === 'session-observer' && knownJsonlFiles.size === 0) {
		unknownFiles = [...unknownFiles].sort((a, b) => {
			try {
				return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
			} catch {
				return 0;
			}
		});
		for (const historical of unknownFiles.slice(1)) {
			knownJsonlFiles.add(historical);
		}
		unknownFiles = unknownFiles.slice(0, 1);
	}

	// In observer mode adopt newest first, one file per scan to avoid terminal storms.
	const candidates = activityProvider.mode === 'session-observer'
		? [...unknownFiles]
			.sort((a, b) => {
				try {
					return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
				} catch {
					return 0;
				}
			})
			.slice(0, 1)
		: unknownFiles;

	for (const file of candidates) {
		knownJsonlFiles.add(file);
		if (activityProvider.mode === 'session-observer') {
			const maxObserved = activityProvider.maxObservedAgents ?? 1;
			if (agents.size >= maxObserved) {
				const replaceId = pickObserverAgentToRotate(agents);
				if (replaceId !== null) {
					reassignAgentToFile(
						replaceId,
						file,
						agents,
						fileWatchers,
						pollingTimers,
						waitingTimers,
						permissionTimers,
						webview,
						persistAgents,
						activityProvider,
					)
				}
				continue;
			}
		}
		if (activeAgentIdRef.current !== null && activityProvider.mode === 'terminal') {
			// Active agent focused → /clear reassignment
			console.log(`[Pixel Agents] New JSONL detected: ${path.basename(file)}, reassigning to agent ${activeAgentIdRef.current}`);
			reassignAgentToFile(
				activeAgentIdRef.current, file,
				agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
				webview, persistAgents, activityProvider,
			);
			continue;
		}

		let terminal = vscode.window.activeTerminal;
		let owned = false;
		if (terminal) {
			for (const existingAgent of agents.values()) {
				if (existingAgent.terminalRef === terminal) {
					owned = true;
					break;
				}
			}
		}

		if (!terminal || owned || activityProvider.mode === 'session-observer') {
			terminal = activityProvider.mode === 'session-observer'
				? getObserverTerminal()
				: vscode.window.createTerminal({ name: `OpenClaw Session #${nextAgentIdRef.current}` });
		}

		adoptTerminalForFile(
			terminal, file, projectDir,
			nextAgentIdRef, agents, activeAgentIdRef,
			fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			webview, persistAgents, activityProvider,
		);
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
	activityProvider: ActivityProvider,
): void {
	const id = nextAgentIdRef.current++;
	let initialOffset = 0;
	if (activityProvider.mode === 'session-observer') {
		try {
			initialOffset = fs.statSync(jsonlFile).size;
		} catch {
			initialOffset = 0;
		}
	}

	const observerLabel = activityProvider.mode === 'session-observer'
		? detectOpenClawObserverLabel(jsonlFile)
		: undefined;

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
		folderName: observerLabel,
	};

	agents.set(id, agent);
	activeAgentIdRef.current = id;
	persistAgents();

	console.log(`[Pixel Agents] Agent ${id}: adopted terminal "${terminal.name}" for ${path.basename(jsonlFile)}`);
	webview?.postMessage({ type: 'agentCreated', id });

	startFileWatching(id, jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview, activityProvider);
	readNewLines(id, agents, waitingTimers, permissionTimers, webview, activityProvider);
}

function getObserverTerminal(): vscode.Terminal {
	const existing = vscode.window.terminals.find(t => t.name === OPENCLAW_OBSERVER_TERMINAL_NAME);
	if (existing) {
		return existing;
	}
	return vscode.window.createTerminal({ name: OPENCLAW_OBSERVER_TERMINAL_NAME });
}

function pickObserverAgentToRotate(agents: Map<number, AgentState>): number | null {
	let candidateId: number | null = null;
	let candidateMtime = Number.POSITIVE_INFINITY;
	for (const [id, agent] of agents) {
		let mtime = Number.POSITIVE_INFINITY;
		try {
			mtime = fs.statSync(agent.jsonlFile).mtimeMs;
		} catch {
			mtime = Number.NEGATIVE_INFINITY;
		}
		if (candidateId === null || mtime < candidateMtime) {
			candidateId = id;
			candidateMtime = mtime;
		}
	}
	return candidateId;
}

function detectOpenClawObserverLabel(jsonlFile: string): string {
	const fallback = path.basename(jsonlFile, '.jsonl').slice(0, 8);
	try {
		const content = fs.readFileSync(jsonlFile, 'utf-8');
		const head = content.slice(0, 8000).toLowerCase();
		if (head.includes('trading:news-radar') || head.includes('trading-radar')) {
			return 'Trading Radar';
		}
		if (head.includes('trading:risk') || head.includes('trading-risk')) {
			return 'Trading Risk';
		}
		if (head.includes('trading:exec') || head.includes('trading-exec')) {
			return 'Trading Exec';
		}
		if (head.includes('agent:main:main') || head.includes('channel":"webchat')) {
			return 'Sam';
		}
	} catch {
		// ignore read errors, use fallback
	}
	return `Session ${fallback}`;
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
	activityProvider: ActivityProvider,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;

	// Stop old file watching
	fileWatchers.get(agentId)?.close();
	fileWatchers.delete(agentId);
	const pt = pollingTimers.get(agentId);
	if (pt) { clearInterval(pt); }
	pollingTimers.delete(agentId);
	try { fs.unwatchFile(agent.jsonlFile); } catch { /* ignore */ }

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
	startFileWatching(agentId, newFilePath, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview, activityProvider);
	readNewLines(agentId, agents, waitingTimers, permissionTimers, webview, activityProvider);
}
