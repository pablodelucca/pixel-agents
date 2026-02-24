import type * as vscode from 'vscode';

export type AgentRuntime = 'claude' | 'codex';

export interface AgentState {
	id: number;
	runtime: AgentRuntime;
	pendingSessionId?: string; // waiting for runtime transcript file discovery
	terminalRef: vscode.Terminal;
	projectDir: string;
	jsonlFile: string;
	fileOffset: number;
	lineBuffer: string;
	activeToolIds: Set<string>;
	activeToolStatuses: Map<string, string>;
	activeToolNames: Map<string, string>;
	activeToolCallToName: Map<string, string>; // codex callId -> toolName
	activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
	activeSubagentToolNames: Map<string, Map<string, string>>; // parentToolId → (subToolId → toolName)
	isWaiting: boolean;
	permissionSent: boolean;
	hadToolsInTurn: boolean;
}

export interface PersistedAgent {
	id: number;
	runtime?: AgentRuntime;
	terminalName: string;
	jsonlFile: string;
	projectDir: string;
}
