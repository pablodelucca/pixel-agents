import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import type { AgentState, MessageEmitter } from './types.js';
import { startFileWatching, readNewLines } from './fileWatcher.js';
import {
	EXTERNAL_SESSION_SCAN_INTERVAL_MS,
	EXTERNAL_SESSION_STALE_THRESHOLD_MS,
	EXTERNAL_SESSION_REMOVE_THRESHOLD_MS,
} from './constants.js';
import { removeAgent } from './agentManager.js';

const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');

export interface ExternalScanState {
	timer: ReturnType<typeof setInterval> | null;
	/** JSONL files already tracked as external agents (path → agentId) */
	trackedFiles: Map<string, number>;
}

export function createExternalScanState(): ExternalScanState {
	return { timer: null, trackedFiles: new Map() };
}

export function startExternalScan(
	scanState: ExternalScanState,
	agents: Map<number, AgentState>,
	knownJsonlFiles: Set<string>,
	nextAgentIdRef: { current: number },
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	persistAgents: () => void,
	webview: MessageEmitter | undefined,
): void {
	if (scanState.timer) return;
	console.log('[Pixel Agents] Starting external session scanner');

	// Run immediately, then on interval
	runExternalScan(scanState, agents, knownJsonlFiles, nextAgentIdRef,
		fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers,
		persistAgents, webview);

	scanState.timer = setInterval(() => {
		runExternalScan(scanState, agents, knownJsonlFiles, nextAgentIdRef,
			fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers,
			persistAgents, webview);
	}, EXTERNAL_SESSION_SCAN_INTERVAL_MS);
}

export function stopExternalScan(
	scanState: ExternalScanState,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	persistAgents: () => void,
	webview: MessageEmitter | undefined,
): void {
	if (scanState.timer) {
		clearInterval(scanState.timer);
		scanState.timer = null;
	}

	// Remove all external agents
	for (const [filePath, agentId] of scanState.trackedFiles) {
		removeAgent(agentId, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents);
		webview?.postMessage({ type: 'agentClosed', id: agentId });
	}
	scanState.trackedFiles.clear();
	console.log('[Pixel Agents] External session scanner stopped');
}

function runExternalScan(
	scanState: ExternalScanState,
	agents: Map<number, AgentState>,
	knownJsonlFiles: Set<string>,
	nextAgentIdRef: { current: number },
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	persistAgents: () => void,
	webview: MessageEmitter | undefined,
): void {
	const scope = vscode.workspace.getConfiguration('pixel-agents').get<string>('externalSessions.scope', 'currentProject');
	const now = Date.now();

	// Collect directories to scan
	const dirsToScan: string[] = [];
	if (scope === 'allProjects') {
		try {
			const entries = fs.readdirSync(claudeProjectsDir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isDirectory()) {
					dirsToScan.push(path.join(claudeProjectsDir, entry.name));
				}
			}
		} catch { /* ~/.claude/projects may not exist */ }
	} else {
		// Current project only
		const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (workspacePath) {
			const dirName = workspacePath.replace(/[^a-zA-Z0-9-]/g, '-');
			const projectDir = path.join(claudeProjectsDir, dirName);
			dirsToScan.push(projectDir);
		}
	}

	// Find active JSONL files
	const activeFiles = new Set<string>();
	for (const dir of dirsToScan) {
		try {
			const files = fs.readdirSync(dir)
				.filter(f => f.endsWith('.jsonl'))
				.map(f => path.join(dir, f));

			for (const file of files) {
				// Skip files already tracked by the extension (non-external agents)
				if (knownJsonlFiles.has(file)) continue;

				try {
					const stat = fs.statSync(file);
					const age = now - stat.mtimeMs;

					if (age < EXTERNAL_SESSION_STALE_THRESHOLD_MS) {
						activeFiles.add(file);

						// Not yet tracked as external → create agent
						if (!scanState.trackedFiles.has(file)) {
							const id = nextAgentIdRef.current++;
							const projectDir = path.dirname(file);

							// Derive a readable folder name from the project dir name
							// Dir name is the workspace path with : \ / replaced by -
							const dirBaseName = path.basename(projectDir);
							const decodedPath = dirBaseName.replace(/^-/, '/').replace(/-/g, '/');
							const home = os.homedir();
							const folderName = decodedPath.startsWith(home)
								? decodedPath.slice(home.length + 1)
								: decodedPath;

							const agent: AgentState = {
								id,
								isExternal: true,
								projectDir,
								jsonlFile: file,
								fileOffset: stat.size, // Skip past history
								lineBuffer: '',
								activeToolIds: new Set(),
								activeToolStatuses: new Map(),
								activeToolNames: new Map(),
								activeSubagentToolIds: new Map(),
								activeSubagentToolNames: new Map(),
								isWaiting: false,
								permissionSent: false,
								hadToolsInTurn: false,
								tasks: new Map(),
								folderName,
							};

							agents.set(id, agent);
							scanState.trackedFiles.set(file, id);
							console.log(`[Pixel Agents] External agent ${id}: tracking ${path.basename(file)}`);

							const projectId = path.basename(projectDir);
							webview?.postMessage({ type: 'agentCreated', id, isExternal: true, folderName, projectId });

							// Start file watching to track tool activity
							startFileWatching(id, file, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
							readNewLines(id, agents, waitingTimers, permissionTimers, webview);
						}
					} else if (age > EXTERNAL_SESSION_REMOVE_THRESHOLD_MS) {
						// Stale beyond remove threshold — remove if tracked
						const trackedId = scanState.trackedFiles.get(file);
						if (trackedId !== undefined) {
							console.log(`[Pixel Agents] External agent ${trackedId}: removing stale session`);
							removeAgent(trackedId, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents);
							webview?.postMessage({ type: 'agentClosed', id: trackedId });
							scanState.trackedFiles.delete(file);
						}
					}
				} catch { /* stat error, skip file */ }
			}
		} catch { /* dir read error, skip */ }
	}

	// Remove agents for files that no longer exist or have gone stale
	for (const [filePath, agentId] of scanState.trackedFiles) {
		if (!activeFiles.has(filePath)) {
			try {
				const stat = fs.statSync(filePath);
				const age = now - stat.mtimeMs;
				if (age > EXTERNAL_SESSION_REMOVE_THRESHOLD_MS) {
					console.log(`[Pixel Agents] External agent ${agentId}: session gone stale, removing`);
					removeAgent(agentId, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents);
					webview?.postMessage({ type: 'agentClosed', id: agentId });
					scanState.trackedFiles.delete(filePath);
				}
			} catch {
				// File no longer exists
				console.log(`[Pixel Agents] External agent ${agentId}: file gone, removing`);
				removeAgent(agentId, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents);
				webview?.postMessage({ type: 'agentClosed', id: agentId });
				scanState.trackedFiles.delete(filePath);
			}
		}
	}
}
