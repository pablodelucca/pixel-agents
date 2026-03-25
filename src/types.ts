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
  backgroundAgentToolIds: Set<string>; // tool IDs for run_in_background Agent calls (stay alive until queue-operation)
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
  /** Team name this teammate belongs to */
  teamName?: string;
  /** Team description (short summary of the team's goal) */
  teamDescription?: string;
  /** Team color from config (e.g. "blue", "green") */
  teamColor?: string;
}

/** Team config structure from ~/.claude/teams/{name}/config.json */
export interface TeamConfig {
  name: string;
  description: string;
  leadSessionId: string;
  members: Array<{
    agentId: string;
    name: string;
    agentType: string;
    color?: string;
  }>;
}

export interface PersistedAgent {
  id: number;
  terminalName: string;
  jsonlFile: string;
  projectDir: string;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
}
