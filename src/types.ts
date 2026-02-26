import type * as vscode from 'vscode';

export interface AgentState {
	id: number;
	/**
	 * VS Code terminal that owns this agent.
	 * Present for Claude agents; `undefined` for synthetic OpenClaw agents.
	 */
	terminalRef?: vscode.Terminal;
	/**
	 * OpenClaw run / session ID.
	 * Present only for synthetic agents created by the OpenClaw event source.
	 */
	openclawAgentId?: string;
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
}

export interface PersistedAgent {
	id: number;
	terminalName: string;
	jsonlFile: string;
	projectDir: string;
}
