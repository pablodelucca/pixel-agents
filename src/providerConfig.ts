import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { CliProvider } from './types.js';
import {
	SETTING_CLI_PROVIDER,
	SETTING_CLAUDE_COMMAND,
	CLI_PROVIDER_CLAUDE,
	CLI_PROVIDER_CODEX,
	TERMINAL_NAME_PREFIX_CLAUDE,
	TERMINAL_NAME_PREFIX_CODEX,
	CLAUDE_PROJECTS_SUBDIR,
	CODEX_HOME_SUBDIR,
	CODEX_SESSIONS_SUBDIR,
	CODEX_SCAN_ADJACENT_DAYS,
} from './constants.js';

export function getWorkspaceRoot(cwd?: string): string | null {
	return cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
}

export function getActiveProvider(): CliProvider {
	const configured = vscode.workspace
		.getConfiguration()
		.get<string>(SETTING_CLI_PROVIDER, CLI_PROVIDER_CLAUDE);
	return configured === CLI_PROVIDER_CODEX ? CLI_PROVIDER_CODEX : CLI_PROVIDER_CLAUDE;
}

export function getClaudeCommand(): string {
	const configured = vscode.workspace
		.getConfiguration()
		.get<string>(SETTING_CLAUDE_COMMAND, 'claude')
		.trim();
	return configured || 'claude';
}

export function getTerminalPrefix(provider: CliProvider): string {
	return provider === CLI_PROVIDER_CODEX ? TERMINAL_NAME_PREFIX_CODEX : TERMINAL_NAME_PREFIX_CLAUDE;
}

export function getLaunchCommand(provider: CliProvider, sessionId?: string): string {
	if (provider === CLI_PROVIDER_CODEX) {
		return CLI_PROVIDER_CODEX;
	}
	const baseCommand = getClaudeCommand();
	return sessionId ? `${baseCommand} --session-id ${sessionId}` : baseCommand;
}

export function getClaudeProjectDir(workspaceRoot?: string): string | null {
	const root = getWorkspaceRoot(workspaceRoot);
	if (!root) return null;
	const dirName = root.replace(/[:\\/]/g, '-');
	return path.join(os.homedir(), CLAUDE_PROJECTS_SUBDIR, dirName);
}

export function getCodexHome(): string {
	const envHome = process.env.CODEX_HOME?.trim();
	if (envHome) {
		return envHome;
	}
	return path.join(os.homedir(), CODEX_HOME_SUBDIR);
}

export function getCodexSessionsRoot(): string {
	return path.join(getCodexHome(), CODEX_SESSIONS_SUBDIR);
}

export function getTranscriptRoot(provider: CliProvider, workspaceRoot?: string): string | null {
	if (provider === CLI_PROVIDER_CODEX) {
		return getCodexSessionsRoot();
	}
	return getClaudeProjectDir(workspaceRoot);
}

export function getCodexDateDirs(sessionsRoot: string, fromDate = new Date()): string[] {
	const base = new Date(fromDate);
	base.setHours(0, 0, 0, 0);

	const dirs: string[] = [];
	for (let offset = -CODEX_SCAN_ADJACENT_DAYS; offset <= CODEX_SCAN_ADJACENT_DAYS; offset += 1) {
		const d = new Date(base);
		d.setDate(base.getDate() + offset);
		const year = String(d.getFullYear()).padStart(4, '0');
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		dirs.push(path.join(sessionsRoot, year, month, day));
	}

	return dirs;
}
