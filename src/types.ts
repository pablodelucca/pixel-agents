import type * as vscode from 'vscode';

export type AgentProvider = 'claude' | 'codex';

export interface AgentState {
	id: number;
	provider: AgentProvider;
	terminalRef: vscode.Terminal;
	projectDir: string;
	jsonlFile: string;
	/** Codex thread/session ID from session_meta payload.id */
	codexSessionId?: string;
	/** Working directory used to launch the agent (if known). */
	cwd?: string;
	/** True while waiting for the first transcript file to appear. */
	pendingSessionLink?: boolean;
	/** Launch timestamp used to correlate pending Codex sessions. */
	launchTimestamp?: number;
	fileOffset: number;
	lineBuffer: string;
	activeToolIds: Set<string>;
	activeToolStatuses: Map<string, string>;
	activeToolNames: Map<string, string>;
	activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
	activeSubagentToolNames: Map<string, Map<string, string>>; // parentToolId → (subToolId → toolName)
	/** spawn_agent call_id -> tentative sub-agent label while waiting for output */
	codexPendingSpawnCalls: Map<string, string>;
	/** Codex sub-agent session ID -> display label */
	codexSubagentLabels: Map<string, string>;
	/** Codex sub-agent session ID -> synthetic parentToolId used by webview sub-agent mapping */
	codexSubagentParentToolIds: Map<string, string>;
	/** wait call_id -> (Codex sub-agent session ID -> synthetic sub-tool ID) */
	codexWaitCallMap: Map<string, Map<string, string>>;
	isWaiting: boolean;
	permissionSent: boolean;
	hadToolsInTurn: boolean;
	/** Workspace folder name (only set for multi-root workspaces) */
	folderName?: string;
}

export interface PersistedAgent {
	id: number;
	provider?: AgentProvider;
	terminalName: string;
	jsonlFile: string;
	projectDir: string;
	cwd?: string;
	/** Workspace folder name (only set for multi-root workspaces) */
	folderName?: string;
}
