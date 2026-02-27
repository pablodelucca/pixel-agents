import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentCliProvider } from './types.js';
import {
	CONFIG_SECTION,
	CONFIG_KEY_CLI_PROVIDER,
	CONFIG_KEY_CODEX_COMMAND,
	CONFIG_KEY_CLAUDE_COMMAND,
} from './constants.js';

const CODEX_SESSIONS_ROOT = path.join(os.homedir(), '.codex', 'sessions');

function getTodayPathParts(): { year: string; month: string; day: string } {
	const now = new Date();
	return {
		year: String(now.getFullYear()),
		month: String(now.getMonth() + 1).padStart(2, '0'),
		day: String(now.getDate()).padStart(2, '0'),
	};
}

export function resolveWorkspacePath(cwd?: string): string | null {
	return cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
}

export function getConfiguredProvider(): AgentCliProvider {
	const configured = vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.get<string>(CONFIG_KEY_CLI_PROVIDER, 'codex');
	return configured === 'claude' ? 'claude' : 'codex';
}

export function getCliCommand(provider: AgentCliProvider): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	if (provider === 'claude') {
		return config.get<string>(CONFIG_KEY_CLAUDE_COMMAND, 'claude');
	}
	return config.get<string>(CONFIG_KEY_CODEX_COMMAND, 'codex');
}

export function getTerminalNamePrefix(provider: AgentCliProvider): string {
	return provider === 'claude' ? 'Claude Code' : 'Codex CLI';
}

export function getProjectScanDir(provider: AgentCliProvider, workspacePath: string | null): string | null {
	if (provider === 'claude') {
		if (!workspacePath) return null;
		const dirName = workspacePath.replace(/[^a-zA-Z0-9-]/g, '-');
		return path.join(os.homedir(), '.claude', 'projects', dirName);
	}
	const { year, month, day } = getTodayPathParts();
	return path.join(CODEX_SESSIONS_ROOT, year, month, day);
}

export function getSessionsFolderPath(provider: AgentCliProvider, workspacePath: string | null): string | null {
	if (provider === 'claude') {
		return getProjectScanDir(provider, workspacePath);
	}
	return CODEX_SESSIONS_ROOT;
}

