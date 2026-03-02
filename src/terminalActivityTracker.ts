/**
 * Terminal activity tracker for vscode-terminal agents.
 *
 * Listens to VS Code shell integration events to detect when commands
 * are executed in terminals bound to vscode-terminal agents.
 *
 * - `onDidStartTerminalShellExecution` → send agentToolStart (typing animation)
 * - `onDidEndTerminalShellExecution` → send agentToolDone (back to idle)
 *
 * Requires shell integration to be active in the terminal.
 * Falls back to a no-op if shell integration is not available.
 */
import * as vscode from 'vscode';
import type { AgentState } from './types.js';

/** Maps execution object → synthetic tool ID so we can match start/end */
const executionToolIds = new WeakMap<vscode.TerminalShellExecution, string>();

/** Per-agent counter for unique tool IDs */
const toolCounters = new Map<number, number>();

/**
 * Find the vscode-terminal agent that owns the given terminal.
 */
function findVscodeTerminalAgent(
	terminal: vscode.Terminal,
	agents: Map<number, AgentState>,
): AgentState | undefined {
	for (const agent of agents.values()) {
		if (agent.agentType === 'vscode-terminal' && agent.terminalRef === terminal) {
			return agent;
		}
	}
	return undefined;
}

function nextToolId(agentId: number): string {
	const count = (toolCounters.get(agentId) || 0) + 1;
	toolCounters.set(agentId, count);
	return `terminal-cmd-${agentId}-${count}`;
}

/**
 * Start listening for terminal shell execution events.
 * Returns a Disposable that should be pushed into the extension context subscriptions.
 */
export function startTerminalActivityTracking(
	agents: Map<number, AgentState>,
	webview: () => vscode.Webview | undefined,
): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];

	// Command started → agent becomes active (typing animation)
	disposables.push(
		vscode.window.onDidStartTerminalShellExecution((e) => {
			const agent = findVscodeTerminalAgent(e.terminal, agents);
			if (!agent) { return; }

			const wv = webview();
			if (!wv) { return; }

			const toolId = nextToolId(agent.id);
			executionToolIds.set(e.execution, toolId);

			// Extract command text for display (truncated)
			const cmdText = e.execution.commandLine.value || 'Running command';
			const status = `Running: ${cmdText.length > 30 ? cmdText.slice(0, 27) + '...' : cmdText}`;

			// Update agent state for consistency
			agent.activeToolIds.add(toolId);
			agent.activeToolStatuses.set(toolId, status);

			wv.postMessage({ type: 'agentStatus', id: agent.id, status: 'active' });
			wv.postMessage({
				type: 'agentToolStart',
				id: agent.id,
				toolId,
				status,
			});

			console.log(`[Pixel Agents] Terminal agent ${agent.id}: command started — ${cmdText}`);
		}),
	);

	// Command ended → agent goes idle
	disposables.push(
		vscode.window.onDidEndTerminalShellExecution((e) => {
			const agent = findVscodeTerminalAgent(e.terminal, agents);
			if (!agent) { return; }

			const wv = webview();
			if (!wv) { return; }

			const toolId = executionToolIds.get(e.execution);
			if (!toolId) { return; }

			executionToolIds.delete(e.execution);

			// Clean up agent state
			agent.activeToolIds.delete(toolId);
			agent.activeToolStatuses.delete(toolId);

			wv.postMessage({
				type: 'agentToolDone',
				id: agent.id,
				toolId,
			});

			// Only set waiting if no other commands are still running
			if (agent.activeToolIds.size === 0) {
				wv.postMessage({
					type: 'agentStatus',
					id: agent.id,
					status: 'waiting',
				});
			}

			console.log(`[Pixel Agents] Terminal agent ${agent.id}: command ended (exit: ${e.exitCode})`);
		}),
	);

	return vscode.Disposable.from(...disposables);
}

/**
 * Clean up activity tracking state for a removed agent.
 */
export function cleanupTerminalActivity(agentId: number): void {
	toolCounters.delete(agentId);
}
