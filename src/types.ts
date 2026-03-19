import type * as vscode from 'vscode';

export type AgentType = 'claude' | 'codex' | 'antigravity';

export interface AgentState {
  id: number;
  terminalRef: vscode.Terminal;
  projectDir: string;
  jsonlFile: string;
  agentType: AgentType;
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
  agentType?: AgentType;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
}
