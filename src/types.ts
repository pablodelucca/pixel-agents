/** Minimal postMessage interface satisfied by both vscode.Webview and Electron IPC */
export interface MessageSender {
  postMessage(message: unknown): void;
}

/** Minimal terminal interface satisfied by both vscode.Terminal and AgentHandle */
export interface TerminalHandle {
  name: string;
  show(): void;
  dispose(): void;
}

export interface AgentState {
  id: number;
  terminalRef: TerminalHandle;
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
}
