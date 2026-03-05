/**
 * CLI entry point for joining a remote Pixel Office as a peer.
 *
 * Usage: bun server/join.ts <ws-url> [--name <name>]
 * Example: bun server/join.ts ws://192.168.1.5:3000/ws --name Alice
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WebSocket } from 'ws';
import type { AgentState } from './types.js';
import { processTranscriptLine } from './transcriptParser.js';
import { cancelWaitingTimer, cancelPermissionTimer } from './timerManager.js';
import {
	SESSION_SCAN_INTERVAL_MS,
	SESSION_ACTIVE_THRESHOLD_MS,
	FILE_WATCHER_POLL_INTERVAL_MS,
} from './constants.js';

// -- Parse args --
const args = process.argv.slice(2);
let wsUrl = '';
let peerName = os.userInfo().username;

for (let i = 0; i < args.length; i++) {
	if (args[i] === '--name' && args[i + 1]) {
		peerName = args[++i];
	} else if (!wsUrl && !args[i].startsWith('-')) {
		wsUrl = args[i];
	}
}

if (!wsUrl) {
	console.error('Usage: bun server/join.ts <ws-url> [--name <name>]');
	console.error('Example: bun server/join.ts ws://192.168.1.5:3000/ws --name Alice');
	process.exit(1);
}

// Ensure /ws path
if (!wsUrl.endsWith('/ws')) {
	wsUrl = wsUrl.replace(/\/?$/, '/ws');
}

// -- Local state --
const localAgents = new Map<number, AgentState>();
const knownJsonlFiles = new Set<string>();
const fileWatchers = new Map<number, fs.FSWatcher>();
const pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
let nextLocalId = 1;

const STALE_THRESHOLD_MS = 5 * 60_000;
let ws: WebSocket | null = null;
let reconnectDelay = 2000;
let scanTimer: ReturnType<typeof setInterval> | null = null;

// -- Folder name from project dir --
function decodeProjectDir(encoded: string): string {
	// Encoded: "/Users/bob/cludo/pixel-agents" → "-Users-bob-cludo-pixel-agents"
	// Strip home dir prefix, keep the rest with hyphens intact
	const homeEncoded = os.homedir().replace(/[/\\:]/g, '-');
	let stripped = encoded;
	if (stripped.startsWith('-' + homeEncoded + '-')) {
		stripped = stripped.slice(1 + homeEncoded.length + 1);
	} else {
		stripped = stripped.replace(/^-/, '');
	}
	return stripped;
}

// -- Send peer message --
function send(msg: Record<string, unknown>): void {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(msg));
	}
}

// -- Emit translator: converts standard messages to peer protocol --
function createPeerEmit(localId: number): (msg: unknown) => void {
	return (msg: unknown) => {
		const m = msg as Record<string, unknown>;
		const type = m.type as string;

		switch (type) {
			case 'agentToolStart':
				send({ type: 'peerAgentToolStart', localId, toolId: m.toolId, status: m.status });
				break;
			case 'agentToolDone':
				send({ type: 'peerAgentToolDone', localId, toolId: m.toolId });
				break;
			case 'agentToolsClear':
				send({ type: 'peerAgentToolsClear', localId });
				break;
			case 'agentStatus':
				send({ type: 'peerAgentStatus', localId, status: m.status });
				break;
			case 'agentToolPermission':
				send({ type: 'peerAgentToolPermission', localId });
				break;
			case 'agentToolPermissionClear':
				send({ type: 'peerAgentToolPermissionClear', localId });
				break;
			case 'subagentToolStart':
				send({ type: 'peerSubagentToolStart', localId, parentToolId: m.parentToolId, toolId: m.toolId, status: m.status });
				break;
			case 'subagentToolDone':
				send({ type: 'peerSubagentToolDone', localId, parentToolId: m.parentToolId, toolId: m.toolId });
				break;
			case 'subagentClear':
				send({ type: 'peerSubagentClear', localId, parentToolId: m.parentToolId });
				break;
			case 'subagentToolPermission':
				send({ type: 'peerSubagentToolPermission', localId, parentToolId: m.parentToolId });
				break;
			case 'agentTokens':
				send({ type: 'peerAgentTokens', localId, input: m.input, output: m.output, cacheRead: m.cacheRead, cacheCreation: m.cacheCreation });
				break;
		}
	};
}

// -- File watching (simplified from fileWatcher.ts) --
function readNewLines(localId: number): void {
	const agent = localAgents.get(localId);
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
			cancelWaitingTimer(localId, waitingTimers);
			cancelPermissionTimer(localId, permissionTimers);
			if (agent.permissionSent) {
				agent.permissionSent = false;
				createPeerEmit(localId)({ type: 'agentToolPermissionClear', id: localId });
			}
		}

		const emit = createPeerEmit(localId);
		for (const line of lines) {
			if (!line.trim()) continue;
			processTranscriptLine(localId, line, localAgents, waitingTimers, permissionTimers, emit);
		}
	} catch {
		// ignore read errors
	}
}

function startFileWatching(localId: number, filePath: string): void {
	try {
		const watcher = fs.watch(filePath, () => readNewLines(localId));
		fileWatchers.set(localId, watcher);
	} catch { /* ignore */ }

	try {
		fs.watchFile(filePath, { interval: FILE_WATCHER_POLL_INTERVAL_MS }, () => readNewLines(localId));
	} catch { /* ignore */ }

	const interval = setInterval(() => {
		if (!localAgents.has(localId)) {
			clearInterval(interval);
			try { fs.unwatchFile(filePath); } catch { /* ignore */ }
			return;
		}
		readNewLines(localId);
	}, FILE_WATCHER_POLL_INTERVAL_MS);
	pollingTimers.set(localId, interval);
}

function removeLocalAgent(localId: number): void {
	const agent = localAgents.get(localId);
	if (!agent) return;

	fileWatchers.get(localId)?.close();
	fileWatchers.delete(localId);
	const pt = pollingTimers.get(localId);
	if (pt) clearInterval(pt);
	pollingTimers.delete(localId);
	try { fs.unwatchFile(agent.jsonlFile); } catch { /* ignore */ }
	cancelWaitingTimer(localId, waitingTimers);
	cancelPermissionTimer(localId, permissionTimers);
	knownJsonlFiles.delete(agent.jsonlFile);
	localAgents.delete(localId);
}

// -- Session scanning --
function scanAllProjects(): void {
	const projectsRoot = path.join(os.homedir(), '.claude', 'projects');

	let projectDirs: string[];
	try {
		projectDirs = fs.readdirSync(projectsRoot, { withFileTypes: true })
			.filter(d => d.isDirectory())
			.map(d => path.join(projectsRoot, d.name));
	} catch { return; }

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

			try {
				const stat = fs.statSync(jsonlFile);
				const age = now - stat.mtimeMs;
				if (age > SESSION_ACTIVE_THRESHOLD_MS) continue;
				if (stat.size === 0) continue;

				knownJsonlFiles.add(jsonlFile);
				const localId = nextLocalId++;
				const folderName = decodeProjectDir(path.basename(projectDir));

				const agent: AgentState = {
					id: localId,
					ptyProcess: null,
					projectDir,
					jsonlFile,
					fileOffset: Math.max(0, stat.size - 4096),
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
					suppressTokens: true,
					label: folderName,
				};

				localAgents.set(localId, agent);
				console.log(`[Join] Detected session: ${path.basename(jsonlFile)} in ${folderName}`);
				send({ type: 'peerAgentCreated', localId, folderName });
				startFileWatching(localId, jsonlFile);
				readNewLines(localId);
				agent.suppressTokens = false;
			} catch { /* ignore */ }
		}
	}
}

function cleanupStaleAgents(): void {
	const now = Date.now();
	for (const [localId, agent] of localAgents) {
		try {
			const stat = fs.statSync(agent.jsonlFile);
			if (now - stat.mtimeMs < STALE_THRESHOLD_MS) continue;
		} catch {
			// File gone
		}

		console.log(`[Join] Removing stale session: ${path.basename(agent.jsonlFile)}`);
		send({ type: 'peerAgentClosed', localId });
		removeLocalAgent(localId);
	}
}

function startScanning(): void {
	if (scanTimer) return;
	scanAllProjects();
	scanTimer = setInterval(() => {
		cleanupStaleAgents();
		scanAllProjects();
	}, SESSION_SCAN_INTERVAL_MS);
}

function stopScanning(): void {
	if (scanTimer) {
		clearInterval(scanTimer);
		scanTimer = null;
	}
}

// -- Re-announce all agents (on reconnect) --
function announceAllAgents(): void {
	for (const [localId, agent] of localAgents) {
		send({ type: 'peerAgentCreated', localId, folderName: agent.label });
		// Also send current tool state
		for (const [toolId, status] of agent.activeToolStatuses) {
			send({ type: 'peerAgentToolStart', localId, toolId, status });
		}
		if (agent.isWaiting) {
			send({ type: 'peerAgentStatus', localId, status: 'waiting' });
		}
	}
}

// -- WebSocket connection --
function connect(): void {
	console.log(`[Join] Connecting to ${wsUrl} as "${peerName}"...`);
	ws = new WebSocket(wsUrl);

	ws.on('open', () => {
		console.log(`[Join] Connected to ${wsUrl} as "${peerName}"`);
		send({ type: 'peerRegister', name: peerName });
		announceAllAgents();
		reconnectDelay = 2000;
		startScanning();
	});

	ws.on('message', (data) => {
		try {
			const msg = JSON.parse(data.toString());
			if (msg.type === 'peerRegistered') {
				console.log(`[Join] Registered with peer ID: ${msg.peerId}`);
			}
		} catch { /* ignore */ }
	});

	ws.on('close', () => {
		console.log(`[Join] Disconnected, reconnecting in ${reconnectDelay / 1000}s...`);
		ws = null;
		setTimeout(connect, reconnectDelay);
		reconnectDelay = Math.min(reconnectDelay * 2, 30000);
	});

	ws.on('error', () => {
		// onclose fires after onerror
	});
}

// -- Graceful shutdown --
function cleanup(): void {
	console.log('\n[Join] Shutting down...');
	stopScanning();

	// Notify host about all agents being removed
	for (const localId of localAgents.keys()) {
		send({ type: 'peerAgentClosed', localId });
	}

	// Clean up file watchers
	for (const localId of [...localAgents.keys()]) {
		removeLocalAgent(localId);
	}

	for (const timer of waitingTimers.values()) clearTimeout(timer);
	for (const timer of permissionTimers.values()) clearTimeout(timer);

	if (ws) {
		ws.close();
	}

	// Give a moment for messages to flush
	setTimeout(() => process.exit(0), 200);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// -- Start --
connect();
