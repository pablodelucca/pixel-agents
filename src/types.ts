import type * as vscode from 'vscode';

export interface AgentState {
  id: number;
  /** VS Code terminal reference — undefined for headless agents */
  terminalRef?: vscode.Terminal;
  /** True for agents discovered via JSONL scanning without a terminal */
  isHeadless?: boolean;
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
  /** Last time the JSONL file was seen growing (for headless auto-despawn) */
  lastActivityMs?: number;
}

export interface PersistedAgent {
  id: number;
  terminalName?: string;
  jsonlFile: string;
  projectDir: string;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
  isHeadless?: boolean;
}
