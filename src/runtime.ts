import * as os from 'os';
import * as path from 'path';
import type { AgentRuntime } from './types.js';
import { TERMINAL_NAME_PREFIX_CLAUDE, TERMINAL_NAME_PREFIX_CODEX } from './constants.js';

export const DEFAULT_AGENT_RUNTIME: AgentRuntime = 'claude';

export function normalizeAgentRuntime(value: unknown): AgentRuntime {
	return value === 'codex' ? 'codex' : 'claude';
}

export function getTerminalNamePrefix(runtime: AgentRuntime): string {
	return runtime === 'codex' ? TERMINAL_NAME_PREFIX_CODEX : TERMINAL_NAME_PREFIX_CLAUDE;
}

export function getClaudeProjectDirPath(cwd?: string): string | null {
	const workspacePath = cwd;
	if (!workspacePath) return null;
	const dirName = workspacePath.replace(/[:\\/]/g, '-');
	return path.join(getClaudeSessionsRootPath(), dirName);
}

export function getClaudeSessionsRootPath(): string {
	return path.join(os.homedir(), '.claude', 'projects');
}

export function getCodexProjectDirPath(): string {
	return path.join(os.homedir(), '.codex', 'sessions');
}

export function getProjectDirPathForRuntime(runtime: AgentRuntime, cwd?: string): string | null {
	if (runtime === 'codex') {
		return getCodexProjectDirPath();
	}
	return getClaudeProjectDirPath(cwd);
}

function shellEscape(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function getRuntimeLaunchCommand(runtime: AgentRuntime, cwd: string | undefined, sessionId: string): string {
	if (runtime === 'codex') {
		return cwd ? `codex -C ${shellEscape(cwd)}` : 'codex';
	}
	return `claude --session-id ${sessionId}`;
}
