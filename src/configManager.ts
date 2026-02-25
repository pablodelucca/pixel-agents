import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CONFIGURATION_KEY_AGENT_TYPE, AGENT_TYPE_CLAUDE, AGENT_TYPE_COPILOT } from './constants.js';

export type AgentType = 'claude' | 'copilot';

export function getAgentType(): AgentType {
	const config = vscode.workspace.getConfiguration();
	const agentType = config.get<string>(CONFIGURATION_KEY_AGENT_TYPE, AGENT_TYPE_CLAUDE);
	return (agentType === AGENT_TYPE_COPILOT) ? AGENT_TYPE_COPILOT : AGENT_TYPE_CLAUDE;
}

export function getSessionRootDir(agentType: AgentType): string {
	const homeDir = os.homedir();
	switch (agentType) {
		case AGENT_TYPE_COPILOT:
			return path.join(homeDir, '.copilot', 'session-state');
		case AGENT_TYPE_CLAUDE:
		default:
			return path.join(homeDir, '.claude', 'projects');
	}
}

export function getProjectDirPath(agentType: AgentType, cwd?: string): string | null {
	const sessionRoot = getSessionRootDir(agentType);

	// Copilot uses flat structure directly in session-state (doesn't need workspace)
	if (agentType === AGENT_TYPE_COPILOT) {
		return sessionRoot;
	}

	// Claude uses projects/<workspace-hash> structure (requires workspace)
	const workspacePath = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!workspacePath) return null;
	const dirName = workspacePath.replace(/[:\\/]/g, '-');
	return path.join(sessionRoot, dirName);
}

export function getAgentCommand(agentType: AgentType, sessionId: string): string {
	switch (agentType) {
		case AGENT_TYPE_COPILOT:
			return `copilot --resume ${sessionId}`;
		case AGENT_TYPE_CLAUDE:
		default:
			return `claude --session-id ${sessionId}`;
	}
}

export function getTerminalNamePrefix(agentType: AgentType): string {
	switch (agentType) {
		case AGENT_TYPE_COPILOT:
			return 'GitHub Copilot';
		case AGENT_TYPE_CLAUDE:
		default:
			return 'Claude Code';
	}
}

export function getSessionFilePath(agentType: AgentType, sessionId: string, projectDir: string): string {
	switch (agentType) {
		case AGENT_TYPE_COPILOT:
			// Copilot: ~/.copilot/session-state/<session-id>/events.jsonl
			return path.join(projectDir, sessionId, 'events.jsonl');
		case AGENT_TYPE_CLAUDE:
		default:
			// Claude: ~/.claude/projects/<workspace-hash>/<session-id>.jsonl
			return path.join(projectDir, `${sessionId}.jsonl`);
	}
}

export function inferAgentTypeFromPath(filePath: string): AgentType {
	// Copilot files end with /events.jsonl or \events.jsonl (depending on platform)
	// Use path.sep for platform-specific separator
	const normalized = filePath.replace(/\\/g, '/'); // Normalize to forward slashes
	if (normalized.endsWith('/events.jsonl')) {
		return AGENT_TYPE_COPILOT;
	}
	// Claude files are <session-id>.jsonl
	return AGENT_TYPE_CLAUDE;
}

export function onConfigurationChanged(callback: (agentType: AgentType) => void): vscode.Disposable {
	return vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration(CONFIGURATION_KEY_AGENT_TYPE)) {
			callback(getAgentType());
		}
	});
}
