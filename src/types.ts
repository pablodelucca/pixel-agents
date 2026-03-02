import type * as vscode from 'vscode';
import type { PROVIDERS } from './constants.js';

export type AgentProvider = (typeof PROVIDERS)[number];
export type SessionFormat = 'jsonl' | 'gemini-json';

export interface AgentState {
	id: number;
	terminalRef: vscode.Terminal;
	provider: AgentProvider;
	projectDir: string;
	jsonlFile: string;
	sessionFormat: SessionFormat;
	sessionId?: string;
	launchTime?: number;
	fileOffset: number;
	lineBuffer: string;
	seenToolCalls?: Set<string>;
	seenToolDone?: Set<string>;
	processedGeminiMessages?: number;
	lastGeminiMessageTs?: string;
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
	provider?: AgentProvider;
	sessionFormat?: SessionFormat;
	sessionId?: string;
	/** Workspace folder name (only set for multi-root workspaces) */
	folderName?: string;
}
