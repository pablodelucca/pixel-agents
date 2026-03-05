import * as fs from 'fs';
import * as path from 'path';
import type { AgentState, PersistedAgent } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer } from './timerManager.js';
import { startFileWatching, readNewLines, ensureProjectScan } from './fileWatcher.js';
import { writePersistedAgents, readPersistedAgents, getAgentSeats } from './settingsStore.js';

export function removeAgent(
	agentId: number,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	persistAgents: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;

	const jpTimer = jsonlPollTimers.get(agentId);
	if (jpTimer) { clearInterval(jpTimer); }
	jsonlPollTimers.delete(agentId);

	fileWatchers.get(agentId)?.close();
	fileWatchers.delete(agentId);
	const pt = pollingTimers.get(agentId);
	if (pt) { clearInterval(pt); }
	pollingTimers.delete(agentId);
	try { fs.unwatchFile(agent.jsonlFile); } catch { /* ignore */ }

	cancelWaitingTimer(agentId, waitingTimers);
	cancelPermissionTimer(agentId, permissionTimers);

	agents.delete(agentId);
	persistAgents();
}

export function persistAgents(agents: Map<number, AgentState>): void {
	const persisted: PersistedAgent[] = [];
	for (const agent of agents.values()) {
		persisted.push({
			id: agent.id,
			jsonlFile: agent.jsonlFile,
			projectDir: agent.projectDir,
			label: agent.label,
		});
	}
	writePersistedAgents(persisted);
}

export function restoreAgents(
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
	activeAgentIdRef: { current: number | null },
	emit: (msg: unknown) => void,
	doPersist: () => void,
): void {
	const persisted = readPersistedAgents();
	if (persisted.length === 0) return;

	let maxId = 0;
	let restoredProjectDir: string | null = null;

	for (const p of persisted) {
		// Only restore if JSONL file still exists
		if (!fs.existsSync(p.jsonlFile)) continue;

		const agent: AgentState = {
			id: p.id,
			ptyProcess: null,
			projectDir: p.projectDir,
			jsonlFile: p.jsonlFile,
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
			label: p.label,
		};

		agents.set(p.id, agent);
		knownJsonlFiles.add(p.jsonlFile);
		console.log(`[Pixel Agents] Restored agent ${p.id} -> ${path.basename(p.jsonlFile)}`);

		if (p.id > maxId) maxId = p.id;
		restoredProjectDir = p.projectDir;

		// Start file watching, skipping to end
		try {
			const stat = fs.statSync(p.jsonlFile);
			agent.fileOffset = stat.size;
			startFileWatching(p.id, p.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, emit);
		} catch { /* ignore */ }
	}

	if (maxId >= nextAgentIdRef.current) {
		nextAgentIdRef.current = maxId + 1;
	}

	doPersist();

	if (restoredProjectDir) {
		ensureProjectScan(
			restoredProjectDir, knownJsonlFiles, projectScanTimerRef, activeAgentIdRef,
			nextAgentIdRef, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			emit, doPersist,
		);
	}
}

export function sendExistingAgents(
	agents: Map<number, AgentState>,
	emit: (msg: unknown) => void,
): void {
	const agentIds: number[] = [];
	for (const id of agents.keys()) {
		agentIds.push(id);
	}
	agentIds.sort((a, b) => a - b);

	const agentMeta = getAgentSeats();

	console.log(`[Pixel Agents] sendExistingAgents: agents=${JSON.stringify(agentIds)}`);

	emit({
		type: 'existingAgents',
		agents: agentIds,
		agentMeta,
		folderNames: {},
	});

	sendCurrentAgentStatuses(agents, emit);
}

export function sendCurrentAgentStatuses(
	agents: Map<number, AgentState>,
	emit: (msg: unknown) => void,
): void {
	for (const [agentId, agent] of agents) {
		for (const [toolId, status] of agent.activeToolStatuses) {
			emit({
				type: 'agentToolStart',
				id: agentId,
				toolId,
				status,
			});
		}
		if (agent.isWaiting) {
			emit({
				type: 'agentStatus',
				id: agentId,
				status: 'waiting',
			});
		}
	}
}
