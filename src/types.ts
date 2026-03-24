import type * as vscode from 'vscode';

export interface AgentState {
  id: number;
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
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
  /** Whether this agent is an Agent Teams teammate (has its own JSONL in subagents/) */
  isTeammate?: boolean;
  /** Teammate name from .meta.json (e.g. "domain-reviewer") */
  teammateName?: string;
  /** Parent agent ID if this is a teammate */
  parentAgentId?: number;
}

export interface PersistedAgent {
  id: number;
  terminalName: string;
  jsonlFile: string;
  projectDir: string;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
}
