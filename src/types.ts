import type * as vscode from 'vscode';

/** Minimal interface for sending messages — satisfied by both vscode.Webview and Electron IPC */
export interface MessageEmitter {
	postMessage(msg: unknown): void;
}

export interface AgentState {
	id: number;
	terminalRef?: vscode.Terminal;
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
	terminalName: string;
	jsonlFile: string;
	projectDir: string;
	/** Workspace folder name (only set for multi-root workspaces) */
	folderName?: string;
	/** Derived project identifier (basename of projectDir) */
	projectId?: string;
}
