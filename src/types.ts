import type * as vscode from 'vscode';

export type AgentBackend = 'claude' | 'codex';

export type ToolActivityConfidence = 'high' | 'medium' | 'low' | 'unknown';
export type ToolActivitySource = 'transcript' | 'heuristic';

export interface ToolActivityPayload {
  toolId: string;
  toolName: string;
  statusText: string;
  target?: string;
  command?: string;
  startTime: number;
  durationMs?: number;
  confidence: ToolActivityConfidence;
  parentToolId?: string;
  source: ToolActivitySource;
  permissionState?: 'pending' | 'granted' | 'none';
  inferred?: boolean;
}

export interface AgentState {
  id: number;
  terminalRef: vscode.Terminal;
  adapterName: AgentBackend;
  projectDir: string;
  jsonlFile: string;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeToolActivities: Map<string, ToolActivityPayload>;
  activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
  activeSubagentToolNames: Map<string, Map<string, string>>; // parentToolId → (subToolId → toolName)
  activeSubagentToolActivities: Map<string, Map<string, ToolActivityPayload>>;
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
}

export interface PersistedAgent {
  id: number;
  terminalName: string;
  adapterName?: AgentBackend;
  jsonlFile: string;
  projectDir: string;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
}
