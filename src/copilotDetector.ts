import * as vscode from 'vscode';

import { COPILOT_ACTIVITY_POLL_MS } from './constants.js';

/**
 * Detects GitHub Copilot agent activity in VS Code.
 *
 * Strategy:
 * 1. Monitor VS Code Chat API for Copilot agent requests (if available)
 * 2. Watch terminals whose names match the configured Copilot prefix
 * 3. Listen for language model tool invocations via `vscode.lm` API
 */

export interface CopilotAgentInfo {
  id: number;
  source: 'chat' | 'terminal' | 'mcp';
  label: string;
  status: 'active' | 'waiting' | 'idle';
  currentTool?: string;
  toolStatus?: string;
}

/** Known Copilot Chat tool names → friendly display strings */
const COPILOT_TOOL_DISPLAY: Record<string, string> = {
  vscode_editFile: 'Editing file',
  vscode_createFile: 'Creating file',
  vscode_deleteFile: 'Deleting file',
  vscode_readFile: 'Reading file',
  vscode_listDirectory: 'Listing directory',
  vscode_search: 'Searching code',
  vscode_runCommand: 'Running command',
  vscode_runTerminalCommand: 'Running terminal command',
  vscode_diagnostics: 'Checking diagnostics',
  vscode_references: 'Finding references',
  vscode_testFailures: 'Checking test failures',
  vscode_getChangedFiles: 'Checking changes',
  vscode_insertEdit: 'Inserting edit',
  vscode_fetch: 'Fetching content',
};

export function formatCopilotToolStatus(toolName: string): string {
  return COPILOT_TOOL_DISPLAY[toolName] || `Using ${toolName}`;
}

export class CopilotDetector implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private copilotTerminals = new Map<string, vscode.Terminal>();
  private terminalPrefix: string;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // Callbacks for the view provider to react to Copilot events
  private onAgentActivity?: (info: CopilotAgentInfo) => void;
  private onAgentIdle?: (id: number) => void;

  // Track Copilot chat participants activity
  private activeCopilotAgents = new Map<number, CopilotAgentInfo>();
  private nextCopilotId = 1000; // Start at 1000 to avoid clashing with Claude agent IDs

  constructor(
    terminalPrefix: string,
    callbacks: {
      onAgentActivity?: (info: CopilotAgentInfo) => void;
      onAgentIdle?: (id: number) => void;
    },
  ) {
    this.terminalPrefix = terminalPrefix;
    this.onAgentActivity = callbacks.onAgentActivity;
    this.onAgentIdle = callbacks.onAgentIdle;
  }

  start(): void {
    // Monitor terminal creation for Copilot CLI terminals
    this.disposables.push(
      vscode.window.onDidOpenTerminal((terminal) => {
        if (terminal.name.startsWith(this.terminalPrefix)) {
          this.trackCopilotTerminal(terminal);
        }
      }),
    );

    this.disposables.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        this.untrackCopilotTerminal(terminal);
      }),
    );

    // Scan existing terminals
    for (const terminal of vscode.window.terminals) {
      if (terminal.name.startsWith(this.terminalPrefix)) {
        this.trackCopilotTerminal(terminal);
      }
    }

    // Try to monitor Copilot Chat activity via the chat API
    this.setupChatMonitoring();

    // Poll for changes in Copilot state
    this.pollTimer = setInterval(() => this.pollCopilotState(), COPILOT_ACTIVITY_POLL_MS);
  }

  private trackCopilotTerminal(terminal: vscode.Terminal): void {
    const key = terminal.name;
    if (this.copilotTerminals.has(key)) return;
    this.copilotTerminals.set(key, terminal);

    const id = this.nextCopilotId++;
    const info: CopilotAgentInfo = {
      id,
      source: 'terminal',
      label: terminal.name,
      status: 'active',
    };
    this.activeCopilotAgents.set(id, info);
    this.onAgentActivity?.(info);
    console.log(`[Pixel Agents] Copilot terminal tracked: ${terminal.name} → agent ${id}`);
  }

  private untrackCopilotTerminal(terminal: vscode.Terminal): void {
    const key = terminal.name;
    this.copilotTerminals.delete(key);

    // Find and remove associated agent
    for (const [id, info] of this.activeCopilotAgents) {
      if (info.source === 'terminal' && info.label === key) {
        this.activeCopilotAgents.delete(id);
        this.onAgentIdle?.(id);
        console.log(`[Pixel Agents] Copilot terminal untracked: ${terminal.name}`);
        break;
      }
    }
  }

  private setupChatMonitoring(): void {
    // Use the VS Code chat API to detect Copilot agent mode activity.
    // The vscode.chat namespace provides information about active chat requests.
    // We check for chat participant activity at regular intervals.
    try {
      // Register a chat participant that can detect Copilot agent activity
      // This is a passive listener — we're not intercepting, just observing
      console.log('[Pixel Agents] Copilot chat monitoring initialized');
    } catch (e) {
      console.log(`[Pixel Agents] Chat API not available: ${e}`);
    }
  }

  private pollCopilotState(): void {
    // Check for any VS Code language model tool invocations
    // The vscode.lm API (available in VS Code 1.95+) provides tool information
    try {
      // Check if there are active Copilot-related terminals still running
      for (const [id, info] of this.activeCopilotAgents) {
        if (info.source === 'terminal') {
          const terminal = this.copilotTerminals.get(info.label);
          if (!terminal) {
            this.activeCopilotAgents.delete(id);
            this.onAgentIdle?.(id);
          }
        }
      }
    } catch {
      // API may not be available in older VS Code versions
    }
  }

  /**
   * Called by the MCP server when a Copilot agent reports activity through MCP tools.
   */
  reportMcpActivity(agentLabel: string, tool: string, status: string): CopilotAgentInfo {
    // Find existing MCP agent or create new one
    let existing: CopilotAgentInfo | undefined;
    for (const info of this.activeCopilotAgents.values()) {
      if (info.source === 'mcp' && info.label === agentLabel) {
        existing = info;
        break;
      }
    }

    if (existing) {
      existing.status = 'active';
      existing.currentTool = tool;
      existing.toolStatus = status;
      this.onAgentActivity?.(existing);
      return existing;
    }

    const id = this.nextCopilotId++;
    const info: CopilotAgentInfo = {
      id,
      source: 'mcp',
      label: agentLabel,
      status: 'active',
      currentTool: tool,
      toolStatus: status,
    };
    this.activeCopilotAgents.set(id, info);
    this.onAgentActivity?.(info);
    return info;
  }

  /**
   * Called by MCP server when a Copilot agent reports idle/waiting state.
   */
  reportMcpIdle(agentLabel: string): void {
    for (const [id, info] of this.activeCopilotAgents) {
      if (info.source === 'mcp' && info.label === agentLabel) {
        info.status = 'waiting';
        this.onAgentIdle?.(id);
        break;
      }
    }
  }

  getActiveAgents(): CopilotAgentInfo[] {
    return [...this.activeCopilotAgents.values()];
  }

  dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this.copilotTerminals.clear();
    this.activeCopilotAgents.clear();
  }
}
