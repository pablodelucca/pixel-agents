import type * as vscode from 'vscode';

export interface AgentState {
	id: number;
	terminalRef: vscode.Terminal | null;
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
	isExternal: boolean;
	isTmux: boolean;
	tmuxSessionName: string | null;
	tmuxWindowName: string | null;
	lastDataTimestamp: number;
}

export interface PersistedAgent {
	id: number;
	terminalName: string;
	jsonlFile: string;
	projectDir: string;
	isExternal?: boolean;
	isTmux?: boolean;
	tmuxSessionName?: string;
	tmuxWindowName?: string;
}
