import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';
import type { AgentState } from './types.js';
import { startFileWatching, readNewLines } from './fileWatcher.js';
import {
	EXTERNAL_SCAN_INTERVAL_MS,
	EXTERNAL_STALE_TIMEOUT_MS,
	EXTERNAL_ACTIVE_THRESHOLD_MS,
	EXTERNAL_STALE_CHECK_INTERVAL_MS,
} from './constants.js';
import { removeAgent } from './agentManager.js';

/** Check if a JSONL file is already tracked by any agent */
function isFileTracked(filePath: string, agents: Map<number, AgentState>): boolean {
	for (const agent of agents.values()) {
		if (agent.jsonlFile === filePath) return true;
	}
	return false;
}

export function startExternalAgentScanning(
	projectDir: string,
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
	persistAgents: () => void,
): ReturnType<typeof setInterval> {
	return setInterval(() => {
		scanForExternalJsonlFiles(
			projectDir, nextAgentIdRef, agents,
			fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			webview, persistAgents,
		);
	}, EXTERNAL_SCAN_INTERVAL_MS);
}

function scanForExternalJsonlFiles(
	projectDir: string,
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

	const now = Date.now();

	for (const file of files) {
		if (isFileTracked(file, agents)) continue;

		// Check if the file was recently modified (active session)
		try {
			const stat = fs.statSync(file);
			if (now - stat.mtimeMs > EXTERNAL_ACTIVE_THRESHOLD_MS) continue;
		} catch { continue; }

		// Create external agent
		const id = nextAgentIdRef.current++;
		const agent: AgentState = {
			id,
			terminalRef: null,
			projectDir,
			jsonlFile: file,
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
			isExternal: true,
			isTmux: false,
			tmuxSessionName: null,
			tmuxWindowName: null,
			lastDataTimestamp: now,
		};

		agents.set(id, agent);
		persistAgents();

		console.log(`[Pixel Agents] External agent ${id}: detected ${path.basename(file)}`);
		webview?.postMessage({ type: 'agentCreated', id, isExternal: true });

		// Start file watching — reads from offset 0 to reconstruct full tool state
		startFileWatching(id, file, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
		readNewLines(id, agents, waitingTimers, permissionTimers, webview);
	}
}

export function startStaleExternalAgentCheck(
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	webview: vscode.Webview | undefined,
	persistAgents: () => void,
): ReturnType<typeof setInterval> {
	return setInterval(() => {
		const now = Date.now();
		const toRemove: number[] = [];

		for (const [id, agent] of agents) {
			if (!agent.isExternal) continue;

			// Check if file still exists
			let fileExists = false;
			let fileMtime = 0;
			try {
				const stat = fs.statSync(agent.jsonlFile);
				fileExists = true;
				fileMtime = stat.mtimeMs;
			} catch { /* file deleted */ }

			if (!fileExists) {
				toRemove.push(id);
				continue;
			}

			// Stale if both file mtime and last data timestamp are older than threshold
			const fileAge = now - fileMtime;
			const dataAge = now - agent.lastDataTimestamp;
			if (fileAge > EXTERNAL_STALE_TIMEOUT_MS && dataAge > EXTERNAL_STALE_TIMEOUT_MS) {
				toRemove.push(id);
			}
		}

		for (const id of toRemove) {
			console.log(`[Pixel Agents] Removing stale external agent ${id}`);
			removeAgent(id, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents);
			webview?.postMessage({ type: 'agentClosed', id });
		}
	}, EXTERNAL_STALE_CHECK_INTERVAL_MS);
}
