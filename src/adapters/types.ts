import type * as vscode from 'vscode';

import type { AgentSource, AgentState } from '../types.js';

/**
 * Context passed to every AgentAdapter on start.
 * Provides the shared state maps and communication handles needed to
 * create agents, post status updates to the webview, and clean up on dispose.
 */
export interface AdapterContext {
  agents: Map<number, AgentState>;
  nextAgentIdRef: { current: number };
  webview: vscode.Webview | undefined;
  persistAgents: () => void;
}

/**
 * An AgentAdapter is responsible for detecting and monitoring agents from a
 * specific source (e.g. Claude Code, GitHub Copilot). Each adapter:
 *   - Creates AgentState entries when it detects new agent sessions
 *   - Posts agentStatus / agentToolStart / agentToolDone messages to the webview
 *   - Disposes its VS Code subscriptions when the extension deactivates
 *
 * This interface is intentionally minimal — adapters may use very different
 * strategies (file watching vs. VS Code events) underneath.
 */
export interface AgentAdapter {
  readonly source: AgentSource;

  /**
   * Start observing for agent activity. Called once when the webview panel opens.
   * Returns a Disposable that tears down all listeners and timers.
   */
  start(context: AdapterContext): vscode.Disposable;
}
