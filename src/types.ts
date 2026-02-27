import type * as vscode from 'vscode';

export type AgentCliProvider = 'codex' | 'claude';

export interface AgentState {
	id: number;
	terminalRef: vscode.Terminal;
	provider: AgentCliProvider;
	projectDir: string;
	workspacePath: string;
	jsonlFile: string;
	launchTimestampMs?: number;
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
	terminalName: string;
	provider?: AgentCliProvider;
	jsonlFile: string;
	projectDir: string;
	workspacePath?: string;
	launchTimestampMs?: number;
	/** Workspace folder name (only set for multi-root workspaces) */
	folderName?: string;
}
