export type PostMessage = (message: Record<string, unknown>) => void;

export interface IDisposable {
  dispose(): void;
}

export type Event<T> = (handler: (value: T) => void) => IDisposable;

export interface WorkspaceFolder {
  name: string;
  path: string;
}

export interface OpenDialogOptions {
  filters?: Record<string, string[]>;
  canSelectMany?: boolean;
}

export interface SaveDialogOptions {
  filters?: Record<string, string[]>;
  defaultPath?: string;
}

export interface IRuntimeUI {
  showOpenDialog(options?: OpenDialogOptions): Promise<string[] | null>;
  showSaveDialog(options?: SaveDialogOptions): Promise<string | null>;
  showInformationMessage(message: string): Promise<void>;
  showErrorMessage(message: string): Promise<void>;
  openPath(fsPath: string): Promise<void>;
  getWorkspaceFolders(): WorkspaceFolder[];
  onWorkspaceFoldersChanged: Event<WorkspaceFolder[]>;
  getState<T>(key: string): T | undefined;
  setState<T>(key: string, value: T): Promise<void>;
  getGlobalState<T>(key: string): T | undefined;
  setGlobalState<T>(key: string, value: T): Promise<void>;
}

export interface SpawnAgentOptions {
  id: number;
  sessionId: string;
  workspacePath: string;
}

export interface IAgentHandle {
  readonly id: number;
  readonly sessionId: string;
  readonly workspacePath: string;
  readonly displayName: string;
  focus(): void;
  close(): void;
  serialize(): PersistedAgentHandle;
}

export interface PersistedAgentHandle {
  id: number;
  sessionId: string;
  workspacePath: string;
  displayName: string;
  [key: string]: unknown;
}

export interface IAgentProvider {
  spawnAgent(options: SpawnAgentOptions): Promise<IAgentHandle>;
  restoreAgents(persisted: PersistedAgentHandle[]): Promise<IAgentHandle[]>;
  /** Optional: adopt an active/focused process for a newly detected JSONL file */
  adoptForFile?(file: string, projectDir: string, id: number): IAgentHandle | null;
  /** Optional: fires when user focuses a managed agent (e.g. clicks its terminal) */
  onAgentFocused?: Event<number | null>;
  onAgentClosed: Event<number>;
  dispose(): void;
}

export interface IMessageBridge {
  postMessage(message: Record<string, unknown>): void;
  onMessage(handler: (message: Record<string, unknown>) => void): IDisposable;
  /** Fires when the webview sends the 'webviewReady' message */
  onReady(handler: () => void): IDisposable;
  dispose(): void;
}

export interface IPixelAgentsPlugin {
  readonly name: string;
  readonly version: string;
  agentProvider: IAgentProvider;
  messageBridge: IMessageBridge;
  runtimeUI: IRuntimeUI;
  /** Optional: absolute path to bundled extension assets */
  getAssetsRoot?(): string | undefined;
}
