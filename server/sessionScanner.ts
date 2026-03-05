import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentState } from './types.js';
import { startFileWatching, readNewLines } from './fileWatcher.js';
import { removeAgent } from './agentManager.js';
import { SESSION_SCAN_INTERVAL_MS, SESSION_ACTIVE_THRESHOLD_MS } from './constants.js';
import { getPersonaForSession } from './prompts/personas.js';

/** How long after last write before an external session is considered closed */
const STALE_THRESHOLD_MS = 5 * 60_000;

/**
 * Scan ~/.claude/projects/ for existing JSONL sessions and create agents for active ones.
 * Also removes external agents whose sessions have gone stale.
 */
export function startSessionScanner(
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	emit: (msg: unknown) => void,
	persistAgents: () => void,
): ReturnType<typeof setInterval> {
	const scan = () => {
		cleanupStaleAgents(agents, knownJsonlFiles, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, emit, persistAgents);
		scanAllProjects(
			nextAgentIdRef, agents, knownJsonlFiles,
			fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			emit, persistAgents,
		);
	};

	scan();
	return setInterval(scan, SESSION_SCAN_INTERVAL_MS);
}

/** Remove external agents whose JSONL files haven't been written to recently */
function cleanupStaleAgents(
	agents: Map<number, AgentState>,
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	emit: (msg: unknown) => void,
	persistAgents: () => void,
): void {
	const now = Date.now();
	for (const [id, agent] of agents) {
		if (!agent.isExternal) continue;

		try {
			const stat = fs.statSync(agent.jsonlFile);
			const age = now - stat.mtimeMs;
			if (age < STALE_THRESHOLD_MS) continue;
		} catch {
			// File gone — remove agent
		}

		console.log(`[SessionScanner] Removing stale session: ${path.basename(agent.jsonlFile)}`);
		knownJsonlFiles.delete(agent.jsonlFile);
		removeAgent(id, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents);
		emit({ type: 'agentClosed', id });
	}
}

/** Decode Claude's project dir encoding (e.g. "-Users-bob-cludo-pixel-agents" → "cludo-pixel-agents") */
function decodeProjectDir(encoded: string): string {
	const homeEncoded = os.homedir().replace(/[/\\:]/g, '-')
	if (encoded.startsWith('-' + homeEncoded + '-')) {
		return encoded.slice(1 + homeEncoded.length + 1)
	}
	return encoded.replace(/^-/, '')
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

				const sessionId = path.basename(jsonlFile, '.jsonl');
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
					sessionId,
					label: decodeProjectDir(path.basename(projectDir)),
				};

				// Skip to near end of file, read last chunk for current state
				const skipTo = Math.max(0, stat.size - 4096);
				agent.fileOffset = skipTo;

				agents.set(id, agent);
				persistAgents();

				console.log(`[SessionScanner] Detected active session: ${path.basename(jsonlFile)} in ${path.basename(projectDir)}`);
				const persona = getPersonaForSession(agent.sessionId ?? '');
				emit({ type: 'agentCreated', id, folderName: agent.label, personaTagline: persona.tagline });

				startFileWatching(id, jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, emit);
				readNewLines(id, agents, waitingTimers, permissionTimers, emit);
			} catch { /* ignore individual file errors */ }
		}
	}
}
