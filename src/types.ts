import type * as vscode from 'vscode';

export interface AgentState {
	id: number;
	/** VS Code terminal reference — undefined for auto-spawned teammates (no visible terminal) */
	terminalRef?: vscode.Terminal;
	projectDir: string;
	jsonlFile: string;
	fileOffset: number;
	lineBuffer: string;
	activeToolIds: Set<string>;
	activeToolStatuses: Map<string, string>;
	activeToolNames: Map<string, string>;
	activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
	activeSubagentToolNames: Map<string, Map<string, string>>; // parentToolId → (subToolId → toolName)
	isWaiting: boolean;
	permissionSent: boolean;
	hadToolsInTurn: boolean;
	/** Workspace folder name (only set for multi-root workspaces) */
	folderName?: string;

	// ── Token tracking ────────────────────────────────────────
	/** Most recent assistant turn's input_tokens (reflects accumulated context) */
	inputTokens: number;
	/** Most recent assistant turn's output_tokens */
	outputTokens: number;

	// ── Agent Teams ───────────────────────────────────────────
	/** True when this agent has used TeamCreate or Agent tool to spawn teammates */
	isTeamLead?: boolean;
	/** Team name from TeamCreate input, if known */
	teamName?: string;
	/** True when this agent was auto-spawned as a teammate by a lead agent */
	isTeammate?: boolean;
	/** Role/name extracted from the Agent tool call that spawned this agent */
	teamRole?: string;
	/** Agent ID of the lead that spawned this teammate */
	leadAgentId?: number;
	/** Pending teammate registrations: toolId → { name, subagentType, timestamp } */
	pendingTeammateTools?: Map<string, { name: string; subagentType: string; timestamp: number }>;
	/** Spawned teammate agent IDs: toolId → agentId */
	teammateAgentIds?: Map<string, number>;
}

export interface PersistedAgent {
	id: number;
	terminalName: string;
	jsonlFile: string;
	projectDir: string;
	/** Workspace folder name (only set for multi-root workspaces) */
	folderName?: string;

	// ── Agent Teams ───────────────────────────────────────────
	isTeamLead?: boolean;
	teamName?: string;
	isTeammate?: boolean;
	teamRole?: string;
	leadAgentId?: number;
}
