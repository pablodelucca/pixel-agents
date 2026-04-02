import * as path from 'path';
import * as vscode from 'vscode';

import {
  COPILOT_ACTIVE_TIMEOUT_MS,
  COPILOT_AGENT_TERMINAL_PREFIX,
  COPILOT_EDIT_BURST_WINDOW_MS,
  COPILOT_EXTENSION_ID,
} from '../constants.js';
import type { AgentSource, AgentState } from '../types.js';
import type { AdapterContext, AgentAdapter } from './types.js';

/**
 * GitHub Copilot adapter for Pixel Agents.
 *
 * Unlike Claude Code, GitHub Copilot does not write JSONL transcript files.
 * This adapter uses VS Code extension events to infer Copilot activity:
 *
 * 1. Checks whether the GitHub Copilot Chat extension is installed.
 *    If not, this adapter is a no-op.
 * 2. Auto-creates a single "Copilot" agent character.
 * 3. Transitions the character to `active` when document edits occur in bursts
 *    (grouped within COPILOT_EDIT_BURST_WINDOW_MS of each other) or when a
 *    Copilot agent-mode terminal is opened.
 * 4. Transitions back to `waiting` after COPILOT_ACTIVE_TIMEOUT_MS of inactivity.
 *
 * This is a heuristic approach. It may occasionally fire on user-initiated edits
 * that happen to occur while Copilot Chat is open. The trade-off is acceptable
 * given that there is no public VS Code API to observe Copilot's internal state.
 */
export class CopilotAdapter implements AgentAdapter {
  readonly source: AgentSource = 'copilot';

  start(context: AdapterContext): vscode.Disposable {
    if (!vscode.extensions.getExtension(COPILOT_EXTENSION_ID)) {
      console.log('[Pixel Agents] GitHub Copilot Chat not installed — Copilot adapter inactive');
      return { dispose: () => {} };
    }

    console.log('[Pixel Agents] GitHub Copilot detected — starting Copilot adapter');

    const { agents, nextAgentIdRef, webview, persistAgents } = context;
    const agentId = createCopilotAgent(agents, nextAgentIdRef, webview, persistAgents);
    const subscriptions: vscode.Disposable[] = [];
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let lastEditAt = 0;
    let isActive = false;

    function markActive(toolStatus: string): void {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      lastEditAt = Date.now();
      if (!isActive) {
        isActive = true;
        webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
      }
      const toolId = 'copilot-activity';
      webview?.postMessage({ type: 'agentToolStart', id: agentId, toolId, status: toolStatus });

      idleTimer = setTimeout(() => {
        idleTimer = null;
        isActive = false;
        webview?.postMessage({ type: 'agentToolDone', id: agentId, toolId });
        webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
      }, COPILOT_ACTIVE_TIMEOUT_MS);
    }

    // ── Document change detection ─────────────────────────────────
    // Bursts of document edits while Copilot Chat may be responding to a request.
    subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!isUserWorkspaceFile(e.document)) return;

        const now = Date.now();
        const timeSinceLast = now - lastEditAt;

        // Only treat as Copilot activity when edits arrive in rapid bursts.
        // Single-keystroke user edits generally arrive spaced >200ms apart;
        // Copilot multi-file edits arrive in tight bursts <500ms apart.
        if (timeSinceLast > COPILOT_EDIT_BURST_WINDOW_MS && isActive) {
          // Spaced edit — could be user typing; reset burst window but stay active
          lastEditAt = now;
          return;
        }

        const fileName = path.basename(e.document.fileName);
        markActive(`Editing ${fileName}`);
      }),
    );

    // ── Copilot agent-mode terminal detection ─────────────────────
    // GitHub Copilot's agent mode creates VS Code terminals to run commands.
    subscriptions.push(
      vscode.window.onDidOpenTerminal((terminal) => {
        if (isCopilotTerminal(terminal)) {
          console.log(`[Pixel Agents] Copilot agent terminal opened: ${terminal.name}`);
          markActive('Running command…');
        }
      }),
    );

    subscriptions.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        if (!isCopilotTerminal(terminal)) return;
        console.log(`[Pixel Agents] Copilot agent terminal closed: ${terminal.name}`);
        // Accelerate the idle transition when the terminal closes
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
        isActive = false;
        webview?.postMessage({ type: 'agentToolDone', id: agentId, toolId: 'copilot-activity' });
        webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
      }),
    );

    // Also check if any Copilot terminals are already open at startup
    for (const terminal of vscode.window.terminals) {
      if (isCopilotTerminal(terminal)) {
        markActive('Running command…');
        break;
      }
    }

    return vscode.Disposable.from(...subscriptions, {
      dispose: () => {
        if (idleTimer) clearTimeout(idleTimer);
      },
    });
  }
}

/** Creates a synthetic agent entry for the GitHub Copilot character. */
function createCopilotAgent(
  agents: Map<number, AgentState>,
  nextAgentIdRef: { current: number },
  webview: vscode.Webview | undefined,
  persistAgents: () => void,
): number {
  const id = nextAgentIdRef.current++;
  const agent: AgentState = {
    id,
    source: 'copilot',
    isExternal: true,
    projectDir: '',
    jsonlFile: '',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
  };
  agents.set(id, agent);
  persistAgents();

  console.log(`[Pixel Agents] Copilot agent ${id}: created`);
  webview?.postMessage({ type: 'agentCreated', id, isExternal: true, isCopilot: true });

  return id;
}

/** Returns true when the document belongs to the user's workspace (not a virtual/output doc). */
function isUserWorkspaceFile(document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== 'file') return false;
  if (document.fileName.includes('.git')) return false;
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return true;
  return workspaceFolders.some((folder) => document.fileName.startsWith(folder.uri.fsPath));
}

/** Returns true when the terminal was opened by Copilot agent mode. */
function isCopilotTerminal(terminal: vscode.Terminal): boolean {
  return terminal.name.startsWith(COPILOT_AGENT_TERMINAL_PREFIX);
}
