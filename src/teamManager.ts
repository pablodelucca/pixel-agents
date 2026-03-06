import * as path from 'path';
import type * as vscode from 'vscode';
import type { AgentState } from './types.js';
import { TEAMMATE_MATCH_WINDOW_MS } from './constants.js';

interface PendingTeammate {
	name: string;
	subagentType: string;
	timestamp: number;
}

/** leadAgentId → Map<toolId, pending teammate info> */
const pendingTeammates = new Map<number, Map<string, PendingTeammate>>();

/**
 * Called when a lead agent's JSONL shows an Agent tool_use.
 * Registers a pending teammate that will be claimed when its JSONL appears.
 */
export function registerPendingTeammate(
	leadAgentId: number,
	toolId: string,
	name: string,
	subagentType: string,
	agents: Map<number, AgentState>,
	webview: vscode.Webview | undefined,
): void {
	// Mark this agent as a team lead if not already
	const lead = agents.get(leadAgentId);
	if (lead && !lead.isTeamLead) {
		lead.isTeamLead = true;
		webview?.postMessage({ type: 'agentIsLead', id: leadAgentId, teamName: lead.teamName });
		console.log(`[Pixel Agents] Agent ${leadAgentId} marked as team lead`);
	}

	let leadPending = pendingTeammates.get(leadAgentId);
	if (!leadPending) {
		leadPending = new Map();
		pendingTeammates.set(leadAgentId, leadPending);
	}
	leadPending.set(toolId, { name, subagentType, timestamp: Date.now() });
	console.log(`[Pixel Agents] Pending teammate: "${name}" (toolId: ${toolId}) for lead ${leadAgentId}`);
}

/**
 * Called when a new JSONL file is detected. Checks if any lead has a pending
 * teammate registration within the match window. Returns the new agent ID if
 * claimed, or null if this file should be handled by existing /clear logic.
 */
export function tryClaimJsonlForTeammate(
	newJsonlFile: string,
	agents: Map<number, AgentState>,
	nextAgentIdRef: { current: number },
	webview: vscode.Webview | undefined,
	persistAgentsFn: () => void,
): number | null {
	const now = Date.now();

	for (const [leadAgentId, pending] of pendingTeammates) {
		if (!agents.has(leadAgentId)) {
			// Lead is gone — purge its pending entries
			pendingTeammates.delete(leadAgentId);
			continue;
		}

		// Find the oldest pending entry within the match window (FIFO matching)
		let oldestToolId: string | null = null;
		let oldestTimestamp = Infinity;
		for (const [toolId, info] of pending) {
			if (now - info.timestamp <= TEAMMATE_MATCH_WINDOW_MS && info.timestamp < oldestTimestamp) {
				oldestTimestamp = info.timestamp;
				oldestToolId = toolId;
			}
		}

		if (!oldestToolId) continue;

		const pendingInfo = pending.get(oldestToolId)!;
		pending.delete(oldestToolId);
		if (pending.size === 0) {
			pendingTeammates.delete(leadAgentId);
		}

		const leadAgent = agents.get(leadAgentId)!;

		// Create a new AgentState for this teammate (no terminal — auto-spawned)
		const id = nextAgentIdRef.current++;
		const agent: AgentState = {
			id,
			terminalRef: undefined, // teammates have no visible VS Code terminal
			projectDir: leadAgent.projectDir,
			jsonlFile: newJsonlFile,
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
			inputTokens: 0,
			outputTokens: 0,
			isTeammate: true,
			teamRole: pendingInfo.name,
			leadAgentId,
		};

		agents.set(id, agent);

		// Register in lead's teammate map
		if (!leadAgent.teammateAgentIds) {
			leadAgent.teammateAgentIds = new Map();
		}
		leadAgent.teammateAgentIds.set(oldestToolId, id);

		persistAgentsFn();

		console.log(`[Pixel Agents] Teammate ${id} ("${pendingInfo.name}") claimed JSONL: ${path.basename(newJsonlFile)}`);

		webview?.postMessage({
			type: 'teammateCreated',
			id,
			leadId: leadAgentId,
			role: pendingInfo.name,
		});

		return id;
	}

	return null;
}

/**
 * Called when a TeamCreate tool_use is detected. Marks the agent as a lead
 * with the given team name.
 */
export function markAgentAsLead(
	agentId: number,
	teamName: string | undefined,
	agents: Map<number, AgentState>,
	webview: vscode.Webview | undefined,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;
	agent.isTeamLead = true;
	if (teamName) {
		agent.teamName = teamName;
	}
	console.log(`[Pixel Agents] Agent ${agentId} marked as team lead (team: ${teamName ?? 'unnamed'})`);
	webview?.postMessage({ type: 'agentIsLead', id: agentId, teamName });
}

/**
 * Called when a lead agent's terminal closes. Returns the IDs of all teammate
 * agents that should be removed. Callers are responsible for stopping their
 * file watchers and sending agentClosed / removing from the agents map.
 */
export function getTeammatesForLead(
	leadAgentId: number,
	agents: Map<number, AgentState>,
): number[] {
	const toRemove: number[] = [];
	for (const [id, agent] of agents) {
		if (agent.isTeammate && agent.leadAgentId === leadAgentId) {
			toRemove.push(id);
		}
	}
	// Also clear any pending registrations for this lead
	pendingTeammates.delete(leadAgentId);
	return toRemove;
}

/**
 * Called when a SendMessage tool_use is detected. Shows a brief speech bubble
 * on the sending character.
 */
export function handleSendMessage(
	agentId: number,
	webview: vscode.Webview | undefined,
): void {
	webview?.postMessage({ type: 'agentSendMessage', id: agentId });
}

/** Purge expired pending entries (called periodically, e.g. on project scan) */
export function clearExpiredPending(): void {
	const now = Date.now();
	for (const [leadId, pending] of pendingTeammates) {
		for (const [toolId, info] of pending) {
			if (now - info.timestamp > TEAMMATE_MATCH_WINDOW_MS) {
				pending.delete(toolId);
			}
		}
		if (pending.size === 0) {
			pendingTeammates.delete(leadId);
		}
	}
}
