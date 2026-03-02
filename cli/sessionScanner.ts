/**
 * Session Scanner — Detects Claude Code CLI sessions by watching ~/.claude/projects/
 *
 * On startup, seeds all existing JSONL files as "known" (no agents for old sessions).
 * Polls every 2s for new JSONL files across all project directories.
 * When a new JSONL appears → creates an agent and starts file watching.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentState } from '../src/types.js';
import { startFileWatching, readNewLines } from '../src/fileWatcher.js';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const SCAN_INTERVAL_MS = 2000;

export interface SessionScannerOptions {
	agents: Map<number, AgentState>;
	nextAgentId: { current: number };
	knownJsonlFiles: Set<string>;
	fileWatchers: Map<number, fs.FSWatcher>;
	pollingTimers: Map<number, ReturnType<typeof setInterval>>;
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>;
	webview: { postMessage(msg: unknown): void } | undefined;
	onAgentCreated: (agentId: number, folderName: string) => void;
}

/** Reverse the path encoding used by Claude Code: convert `-` back to `/` */
function decodeFolderName(dirName: string): string {
	// Claude Code hashes: path.replace(/[^a-zA-Z0-9-]/g, '-')
	// We can't perfectly reverse this, but we can derive a short name from the last segment
	const parts = dirName.split('-').filter(Boolean);
	// Return last non-empty segment as a readable name
	return parts[parts.length - 1] || dirName;
}

export function startSessionScanner(opts: SessionScannerOptions): { dispose(): void } {
	const {
		agents, nextAgentId, knownJsonlFiles,
		fileWatchers, pollingTimers, waitingTimers, permissionTimers,
		onAgentCreated,
	} = opts;

	// Seed all existing JSONL files on startup
	seedKnownFiles(knownJsonlFiles);

	const timer = setInterval(() => {
		scanForNewSessions(opts);
	}, SCAN_INTERVAL_MS);

	return {
		dispose() {
			clearInterval(timer);
		},
	};
}

function seedKnownFiles(knownJsonlFiles: Set<string>): void {
	try {
		if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return;
		const projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR);
		for (const dirName of projectDirs) {
			const dirPath = path.join(CLAUDE_PROJECTS_DIR, dirName);
			try {
				const stat = fs.statSync(dirPath);
				if (!stat.isDirectory()) continue;
				const files = fs.readdirSync(dirPath)
					.filter(f => f.endsWith('.jsonl'))
					.map(f => path.join(dirPath, f));
				for (const f of files) {
					knownJsonlFiles.add(f);
				}
			} catch { /* skip inaccessible dirs */ }
		}
	} catch { /* projects dir may not exist */ }
}

function scanForNewSessions(opts: SessionScannerOptions): void {
	const {
		agents, nextAgentId, knownJsonlFiles,
		fileWatchers, pollingTimers, waitingTimers, permissionTimers,
		onAgentCreated,
	} = opts;

	try {
		if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return;
		const projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR);

		for (const dirName of projectDirs) {
			const dirPath = path.join(CLAUDE_PROJECTS_DIR, dirName);
			try {
				const stat = fs.statSync(dirPath);
				if (!stat.isDirectory()) continue;

				const files = fs.readdirSync(dirPath)
					.filter(f => f.endsWith('.jsonl'))
					.map(f => path.join(dirPath, f));

				for (const file of files) {
					if (knownJsonlFiles.has(file)) continue;
					knownJsonlFiles.add(file);

					// Check if this JSONL is actively being written to (recent mtime)
					try {
						const fstat = fs.statSync(file);
						const ageMs = Date.now() - fstat.mtimeMs;
						// Only create agents for files modified in the last 30 seconds
						if (ageMs > 30000) continue;
					} catch { continue; }

					// New active session found — create agent
					const id = nextAgentId.current++;
					const folderName = decodeFolderName(dirName);
					const agent: AgentState = {
						id,
						projectDir: dirPath,
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
						folderName,
					};

					agents.set(id, agent);
					console.log(`[CLI] New session detected: ${path.basename(file)} in ${dirName} → agent ${id}`);
					onAgentCreated(id, folderName);

					startFileWatching(
						id, file, agents,
						fileWatchers, pollingTimers, waitingTimers, permissionTimers,
						opts.webview as never,
					);
					readNewLines(id, agents, waitingTimers, permissionTimers, opts.webview as never);
				}
			} catch { /* skip inaccessible dirs */ }
		}
	} catch { /* ignore scan errors */ }
}
