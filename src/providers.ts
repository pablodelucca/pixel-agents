import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentProvider } from './types.js';

const PROVIDER_TERMINAL_PREFIX: Record<AgentProvider, string> = {
	claude: 'Claude Code',
	codex: 'Codex',
};

const PROVIDER_LABEL: Record<AgentProvider, string> = {
	claude: 'Claude Code',
	codex: 'Codex',
};

export const AGENT_PROVIDERS: AgentProvider[] = ['claude', 'codex'];

export function getProviderLabel(provider: AgentProvider): string {
	return PROVIDER_LABEL[provider];
}

export function getTerminalNamePrefix(provider: AgentProvider): string {
	return PROVIDER_TERMINAL_PREFIX[provider];
}

export function getProviderFromTerminalName(terminalName: string): AgentProvider | null {
	for (const provider of AGENT_PROVIDERS) {
		const prefix = PROVIDER_TERMINAL_PREFIX[provider];
		if (terminalName.startsWith(prefix)) {
			return provider;
		}
	}
	return null;
}

export function getWorkspacePath(cwd?: string): string | null {
	return cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
}

function sanitizeWorkspacePath(workspacePath: string): string {
	return workspacePath.replace(/[^a-zA-Z0-9-]/g, '-');
}

export function getClaudeProjectDirPath(cwd?: string): string | null {
	const workspacePath = getWorkspacePath(cwd);
	if (!workspacePath) return null;
	const dirName = sanitizeWorkspacePath(workspacePath);
	return path.join(os.homedir(), '.claude', 'projects', dirName);
}

export function getCodexSessionsDirPath(): string {
	return path.join(os.homedir(), '.codex', 'sessions');
}

export function getSessionDirectoryForProvider(provider: AgentProvider, cwd?: string): string | null {
	if (provider === 'claude') {
		return getClaudeProjectDirPath(cwd);
	}
	return getCodexSessionsDirPath();
}

export function buildLaunchCommand(provider: AgentProvider, cwd: string | undefined, sessionId: string): string {
	if (provider === 'claude') {
		return `claude --session-id ${sessionId}`;
	}
	if (cwd) {
		return `codex -C ${JSON.stringify(cwd)}`;
	}
	return 'codex';
}
