import type * as vscode from 'vscode';

export interface AgentState {
	id: number;
	/** Terminal reference — undefined for extension panel sessions */
	terminalRef?: vscode.Terminal;
	/** Whether this agent was detected from an external source (VS Code extension panel, etc.) */
	isExternal: boolean;
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
}

export interface PersistedAgent {
	id: number;
	/** Terminal name — empty string for extension panel sessions */
	terminalName: string;
	/** Whether this agent was detected from an external source */
	isExternal?: boolean;
	jsonlFile: string;
	projectDir: string;
	/** Workspace folder name (only set for multi-root workspaces) */
	folderName?: string;
}
