import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer, clearAgentActivity } from './timerManager.js';
import { processTranscriptLine } from './transcriptParser.js';
import { FILE_WATCHER_POLL_INTERVAL_MS, PROJECT_SCAN_INTERVAL_MS } from './constants.js';
import { getCursorProjectDirPath } from './agentManager.js';

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
			try { fs.unwatchFile(filePath); } catch { /* ignore */ }
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

		const hasLines = lines.some(l => l.trim());
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
	projectDir: string | null,
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

	if (projectDir) {
		try {
			const files = fs.readdirSync(projectDir)
				.filter(f => f.endsWith('.jsonl'))
				.map(f => path.join(projectDir, f));
			for (const f of files) {
				knownJsonlFiles.add(f);
			}
		} catch { /* dir may not exist yet */ }
	}

	const cursorDir = getCursorProjectDirPath();
	if (cursorDir) {
		seedCursorJsonlFiles(cursorDir, knownJsonlFiles);
	}

	projectScanTimerRef.current = setInterval(() => {
		if (projectDir) {
			scanForNewJsonlFiles(
				projectDir, knownJsonlFiles, activeAgentIdRef, nextAgentIdRef,
				agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
				webview, persistAgents,
			);
		}
		if (cursorDir) {
			scanForNewCursorJsonlFiles(
				cursorDir, knownJsonlFiles, nextAgentIdRef,
				agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
				webview, persistAgents,
			);
		}
	}, PROJECT_SCAN_INTERVAL_MS);
}

function seedCursorJsonlFiles(cursorDir: string, knownJsonlFiles: Set<string>): void {
	try {
		const entries = fs.readdirSync(cursorDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const jsonlPath = path.join(cursorDir, entry.name, `${entry.name}.jsonl`);
			if (fs.existsSync(jsonlPath)) {
				knownJsonlFiles.add(jsonlPath);
			}
		}
	} catch { /* dir may not exist */ }
}

function scanForNewCursorJsonlFiles(
	cursorDir: string,
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
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(cursorDir, { withFileTypes: true });
	} catch { return; }

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const jsonlPath = path.join(cursorDir, entry.name, `${entry.name}.jsonl`);
		if (knownJsonlFiles.has(jsonlPath)) continue;
		if (!fs.existsSync(jsonlPath)) continue;

		// Only pick up transcripts modified in the last 30 seconds (active sessions)
		try {
			const stat = fs.statSync(jsonlPath);
			const ageMs = Date.now() - stat.mtimeMs;
			if (ageMs > 30_000) {
				knownJsonlFiles.add(jsonlPath);
				continue;
			}
		} catch { continue; }

		knownJsonlFiles.add(jsonlPath);
		console.log(`[Pixel Agents] New Cursor transcript: ${entry.name}`);

		const id = nextAgentIdRef.current++;
		const agent: AgentState = {
			id,
			terminalRef: null as unknown as vscode.Terminal,
			projectDir: cursorDir,
			jsonlFile: jsonlPath,
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
			isCursorAgent: true,
		};

		agents.set(id, agent);
		persistAgents();
		webview?.postMessage({ type: 'agentCreated', id });

		startFileWatching(id, jsonlPath, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
		readNewLines(id, agents, waitingTimers, permissionTimers, webview);
	}
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
		files = fs.readdirSync(projectDir)
			.filter(f => f.endsWith('.jsonl'))
			.map(f => path.join(projectDir, f));
	} catch { return; }

	for (const file of files) {
		if (!knownJsonlFiles.has(file)) {
			knownJsonlFiles.add(file);
			if (activeAgentIdRef.current !== null) {
				// Active agent focused → /clear reassignment
				console.log(`[Pixel Agents] New JSONL detected: ${path.basename(file)}, reassigning to agent ${activeAgentIdRef.current}`);
				reassignAgentToFile(
					activeAgentIdRef.current, file,
					agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
					webview, persistAgents,
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
							activeTerminal, file, projectDir,
							nextAgentIdRef, agents, activeAgentIdRef,
							fileWatchers, pollingTimers, waitingTimers, permissionTimers,
							webview, persistAgents,
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
	startFileWatching(agentId, newFilePath, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
	readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
}
