import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer, clearAgentActivity } from './timerManager.js';
import { processTranscriptLine } from './transcriptParser.js';
import { FILE_WATCHER_POLL_INTERVAL_MS, PROJECT_SCAN_INTERVAL_MS } from './constants.js';
import { createAgentState } from './agentFactory.js';

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
): void {
	if (projectScanTimerRef.current) return;
	// Seed with all existing JSONL files so we only react to truly new ones
	try {
		const files = fs.readdirSync(projectDir)
			.filter(f => f.endsWith('.jsonl'))
			.map(f => path.join(projectDir, f));
		for (const f of files) {
			knownJsonlFiles.add(f);
		}
	} catch { /* dir may not exist yet */ }

	projectScanTimerRef.current = setInterval(() => {
		scanForNewJsonlFiles(
			projectDir, knownJsonlFiles, activeAgentIdRef, nextAgentIdRef,
			agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			webview, persistAgents,
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
				// No active agent → try to adopt an unowned terminal
				const ownedTerminals = new Set<vscode.Terminal>();
				for (const agent of agents.values()) {
					ownedTerminals.add(agent.terminalRef);
				}
				const unowned = vscode.window.terminals.filter(t => !ownedTerminals.has(t));

				if (unowned.length === 1) {
					// Exactly 1 unowned terminal → auto-adopt
					adoptTerminalForFile(
						unowned[0], file, projectDir,
						nextAgentIdRef, agents, activeAgentIdRef,
						fileWatchers, pollingTimers, waitingTimers, permissionTimers,
						webview, persistAgents,
					);
				} else {
					// Multiple unowned → try focused terminal (original behavior)
					const activeTerminal = vscode.window.activeTerminal;
					if (activeTerminal && !ownedTerminals.has(activeTerminal)) {
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

export function adoptTerminalForFile(
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
): number | null {
	// Guard: prevent double-adoption of the same terminal
	for (const agent of agents.values()) {
		if (agent.terminalRef === terminal) {
			console.log(`[Pixel Agents] Terminal "${terminal.name}" already owned, skipping adoption`);
			return null;
		}
	}

	const id = nextAgentIdRef.current++;
	const agent = createAgentState(id, terminal, projectDir, jsonlFile);

	agents.set(id, agent);
	activeAgentIdRef.current = id;
	persistAgents();

	console.log(`[Pixel Agents] Agent ${id}: adopted terminal "${terminal.name}" for ${path.basename(jsonlFile)}`);
	webview?.postMessage({ type: 'agentCreated', id });

	startFileWatching(id, jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
	readNewLines(id, agents, waitingTimers, permissionTimers, webview);

	return id;
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
