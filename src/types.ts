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
  /** Workspace folder name (only set for multi-root workspaces, worktrees, or external agents) */
  folderName?: string;
  /** True for agents started outside VS Code (e.g. Ghostty) — no terminalRef */
  isExternal?: boolean;
  /** Path of git worktree directory, if agent was launched in a worktree */
  worktreePath?: string;
}

export interface PersistedAgent {
  id: number;
  terminalName: string;
  jsonlFile: string;
  projectDir: string;
  /** Workspace folder name (only set for multi-root workspaces, worktrees, or external agents) */
  folderName?: string;
  /** True for agents started outside VS Code (e.g. Ghostty) — no terminalRef */
  isExternal?: boolean;
  /** Path of git worktree directory, if agent was launched in a worktree */
  worktreePath?: string;
}
