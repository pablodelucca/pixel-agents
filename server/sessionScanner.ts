import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentState } from './types.js';
import { startFileWatching, readNewLines } from './fileWatcher.js';
import { SESSION_SCAN_INTERVAL_MS, SESSION_ACTIVE_THRESHOLD_MS } from './constants.js';

/**
 * Scan ~/.claude/projects/ for existing JSONL sessions and create agents for active ones.
 * "Active" = file modified within SESSION_ACTIVE_THRESHOLD_MS.
 */
export function startSessionScanner(
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	emit: (msg: unknown) => void,
	persistAgents: () => void,
): ReturnType<typeof setInterval> {
	// Run immediately on startup
	scanAllProjects(
		nextAgentIdRef, agents, knownJsonlFiles,
		fileWatchers, pollingTimers, waitingTimers, permissionTimers,
		emit, persistAgents,
	);

	// Then periodically
	return setInterval(() => {
		scanAllProjects(
			nextAgentIdRef, agents, knownJsonlFiles,
			fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			emit, persistAgents,
		);
	}, SESSION_SCAN_INTERVAL_MS);
}

/** Decode Claude's project dir encoding (e.g. "-Users-bob-my-project" → "my-project") */
function decodeProjectDir(encoded: string): string {
	// Claude encodes paths as: / → -, so "-Users-bob-projects-my-app" = "/Users/bob/projects/my-app"
	// We want just the last path segment
	const decoded = encoded.replace(/^-/, '/').replace(/-/g, '/')
	return path.basename(decoded)
}

function scanAllProjects(
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	emit: (msg: unknown) => void,
	persistAgents: () => void,
): void {
	const projectsRoot = path.join(os.homedir(), '.claude', 'projects');

	let projectDirs: string[];
	try {
		projectDirs = fs.readdirSync(projectsRoot, { withFileTypes: true })
			.filter(d => d.isDirectory())
			.map(d => path.join(projectsRoot, d.name));
	} catch {
		return; // ~/.claude/projects/ doesn't exist
	}

	const now = Date.now();

	for (const projectDir of projectDirs) {
		let jsonlFiles: string[];
		try {
			jsonlFiles = fs.readdirSync(projectDir)
				.filter(f => f.endsWith('.jsonl'))
				.map(f => path.join(projectDir, f));
		} catch { continue; }

		for (const jsonlFile of jsonlFiles) {
			if (knownJsonlFiles.has(jsonlFile)) continue;

			// Check if file is actively being written to
			try {
				const stat = fs.statSync(jsonlFile);
				const age = now - stat.mtimeMs;
				if (age > SESSION_ACTIVE_THRESHOLD_MS) continue;
				if (stat.size === 0) continue;

				// Active session found — create agent
				knownJsonlFiles.add(jsonlFile);
				const id = nextAgentIdRef.current++;

				const agent: AgentState = {
					id,
					ptyProcess: null,
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
					isExternal: true,
					label: decodeProjectDir(path.basename(projectDir)),
				};

				// Skip to near end of file, read last chunk for current state
				const skipTo = Math.max(0, stat.size - 4096);
				agent.fileOffset = skipTo;

				agents.set(id, agent);
				persistAgents();

				console.log(`[SessionScanner] Detected active session: ${path.basename(jsonlFile)} in ${path.basename(projectDir)}`);
				emit({ type: 'agentCreated', id, folderName: agent.label });

				startFileWatching(id, jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, emit);
				readNewLines(id, agents, waitingTimers, permissionTimers, emit);
			} catch { /* ignore individual file errors */ }
		}
	}
}
