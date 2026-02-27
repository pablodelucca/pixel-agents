import type * as vscode from 'vscode';

export type CliProvider = 'claude' | 'codex';

export interface AgentState {
	id: number;
	provider: CliProvider;
	terminalRef: vscode.Terminal;
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
	provider: CliProvider;
	terminalName: string;
	jsonlFile: string;
	projectDir: string;
}
