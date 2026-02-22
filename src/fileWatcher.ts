import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer, clearAgentActivity } from './timerManager.js';
import { processTranscriptLine } from './transcriptParser.js';
import { FILE_WATCHER_POLL_INTERVAL_MS, PROJECT_SCAN_INTERVAL_MS, ACTIVE_SESSION_THRESHOLD_MS } from './constants.js';

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
	// Primary: fs.watch
	try {
		const watcher = fs.watch(filePath, () => {
			readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
		});
		fileWatchers.set(agentId, watcher);
	} catch (e) {
		console.log(`[Pixel Agents] fs.watch failed for agent ${agentId}: ${e}`);
	}

	// Backup: poll every 2s
	const interval = setInterval(() => {
		if (!agents.has(agentId)) { clearInterval(interval); return; }
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

export function isClaudeTerminal(terminal: vscode.Terminal): boolean {
	return terminal.name.toLowerCase().includes('claude');
}

function adoptExistingSessions(
	projectDir: string,
	knownJsonlFiles: Set<string>,
	adoptableFiles: Set<string>,
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
	// 1. Find all JSONL files
	let files: string[];
	try {
		files = fs.readdirSync(projectDir)
			.filter(f => f.endsWith('.jsonl'))
			.map(f => path.join(projectDir, f));
	} catch { return; }

	// 2. Filter to recently-active files not already owned by restored agents
	const now = Date.now();
	const ownedFiles = new Set<string>();
	for (const agent of agents.values()) {
		ownedFiles.add(agent.jsonlFile);
	}

	const activeFiles: Array<{ path: string; mtime: number }> = [];
	for (const file of files) {
		if (knownJsonlFiles.has(file) || ownedFiles.has(file)) continue;
		try {
			const stat = fs.statSync(file);
			if (now - stat.mtimeMs < ACTIVE_SESSION_THRESHOLD_MS) {
				activeFiles.push({ path: file, mtime: stat.mtimeMs });
			}
		} catch { continue; }
	}

	if (activeFiles.length === 0) return;

	// Sort by most recently modified first
	activeFiles.sort((a, b) => b.mtime - a.mtime);

	// 3. Find unowned terminals, preferring Claude-named ones
	const ownedTerminals = new Set<vscode.Terminal>();
	for (const agent of agents.values()) {
		ownedTerminals.add(agent.terminalRef);
	}

	const allUnowned = vscode.window.terminals.filter(t => !ownedTerminals.has(t));
	// Sort: Claude-named terminals first, then others
	const unownedTerminals = [
		...allUnowned.filter(t => isClaudeTerminal(t)),
		...allUnowned.filter(t => !isClaudeTerminal(t)),
	];

	if (unownedTerminals.length === 0) {
		// No terminals to pair with — mark all active files as adoptable for later
		for (const f of activeFiles) {
			adoptableFiles.add(f.path);
		}
		console.log(`[Pixel Agents] Startup: ${activeFiles.length} active session(s) found but no unowned terminals`);
		return;
	}

	// 4. Pair terminals with active files
	const pairCount = Math.min(unownedTerminals.length, activeFiles.length);
	for (let i = 0; i < pairCount; i++) {
		const terminal = unownedTerminals[i];
		const file = activeFiles[i];

		knownJsonlFiles.add(file.path);
		adoptTerminalForFile(
			terminal, file.path, projectDir,
			nextAgentIdRef, agents, activeAgentIdRef,
			fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			webview, persistAgents,
		);
		console.log(`[Pixel Agents] Startup: adopted terminal "${terminal.name}" for active session ${path.basename(file.path)}`);
	}

	// Any remaining active files become adoptable for later
	for (let i = pairCount; i < activeFiles.length; i++) {
		adoptableFiles.add(activeFiles[i].path);
	}
}

export function ensureProjectScan(
	projectDir: string,
	knownJsonlFiles: Set<string>,
	adoptableFiles: Set<string>,
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

	// Attempt to adopt active pre-existing sessions before seeding knownJsonlFiles
	adoptExistingSessions(
		projectDir, knownJsonlFiles, adoptableFiles,
		nextAgentIdRef, agents, activeAgentIdRef,
		fileWatchers, pollingTimers, waitingTimers, permissionTimers,
		webview, persistAgents,
	);

	// Seed with all existing JSONL files so we only react to truly new ones
	// (skip files in adoptableFiles — they should remain adoptable, not "known")
	try {
		const files = fs.readdirSync(projectDir)
			.filter(f => f.endsWith('.jsonl'))
			.map(f => path.join(projectDir, f));
		for (const f of files) {
			if (!adoptableFiles.has(f)) {
				knownJsonlFiles.add(f);
			}
		}
	} catch { /* dir may not exist yet */ }

	projectScanTimerRef.current = setInterval(() => {
		scanForNewJsonlFiles(
			projectDir, knownJsonlFiles, adoptableFiles, activeAgentIdRef, nextAgentIdRef,
			agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			webview, persistAgents,
		);
	}, PROJECT_SCAN_INTERVAL_MS);
}

function scanForNewJsonlFiles(
	projectDir: string,
	knownJsonlFiles: Set<string>,
	adoptableFiles: Set<string>,
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
		if (!knownJsonlFiles.has(file) && !adoptableFiles.has(file)) {
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

	// Check adoptable files — when an unowned terminal is focused, adopt the most recent one
	if (adoptableFiles.size > 0) {
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
				// Pick the most recently modified adoptable file
				let bestFile: string | null = null;
				let bestMtime = 0;
				for (const file of adoptableFiles) {
					try {
						const stat = fs.statSync(file);
						if (stat.mtimeMs > bestMtime) {
							bestMtime = stat.mtimeMs;
							bestFile = file;
						}
					} catch {
						adoptableFiles.delete(file);
					}
				}
				if (bestFile) {
					adoptableFiles.delete(bestFile);
					knownJsonlFiles.add(bestFile);
					adoptTerminalForFile(
						activeTerminal, bestFile, projectDir,
						nextAgentIdRef, agents, activeAgentIdRef,
						fileWatchers, pollingTimers, waitingTimers, permissionTimers,
						webview, persistAgents,
					);
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
