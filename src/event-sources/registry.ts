import * as vscode from 'vscode';
import type { EventSourceType } from './types.js';

/**
 * Reads `pixelAgents.source` from VS Code configuration.
 * Returns `"claude"` when the setting is absent or unknown.
 */
export function getConfiguredSourceType(): EventSourceType {
	const cfg = vscode.workspace.getConfiguration('pixelAgents');
	const raw = cfg.get<string>('source', 'claude').trim().toLowerCase();
	return raw === 'openclaw' ? 'openclaw' : 'claude';
}

/**
 * Reads `pixelAgents.openclaw.agentIdFilter` from VS Code configuration.
 * Returns `undefined` when the setting is empty (= allow all agents).
 */
export function getOpenClawAgentIdFilter(): string | undefined {
	const cfg = vscode.workspace.getConfiguration('pixelAgents');
	const filter = cfg.get<string>('openclaw.agentIdFilter', '').trim();
	return filter || undefined;
}
