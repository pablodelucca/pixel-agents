import type * as vscode from 'vscode';

/** Common agent fields used by transcript parsing, file watching, and timer logic.
 * Shared between the VS Code extension (AgentState) and standalone server. */
export interface BaseAgentState {
	id: number;
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

export interface AgentState extends BaseAgentState {
	terminalRef: vscode.Terminal;
}

export interface PersistedAgent {
	id: number;
	terminalName: string;
	jsonlFile: string;
	projectDir: string;
}
