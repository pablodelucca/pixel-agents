import * as path from 'path';
import * as os from 'os';
import type { AgentType } from './types.js';
import { AGENT_TERMINAL_PREFIXES } from './constants.js';

export interface AgentTypeConfig {
	/** Human-readable label */
	label: string;
	/** Terminal name prefix */
	terminalPrefix: string;
	/** Command to launch in the terminal (receives sessionId as {{SESSION_ID}} placeholder) */
	launchCommand: (sessionId: string) => string;
	/** Resolves the project/session directory for transcript files. Returns null if not applicable. */
	getProjectDir: (workspacePath: string) => string | null;
	/** Resolves the expected transcript file path given projectDir and sessionId */
	getTranscriptFile: (projectDir: string, sessionId: string) => string;
	/** Whether this agent type uses file-based transcript monitoring */
	hasTranscriptFiles: boolean;
	/** Whether to run the project-level scan for /clear detection */
	hasProjectScan: boolean;
	/** File extension for transcript files */
	transcriptExtension: string;
}

/**
 * Claude Code: monitors ~/.claude/projects/<hash>/<session>.jsonl
 */
const claudeCodeConfig: AgentTypeConfig = {
	label: 'Claude Code',
	terminalPrefix: AGENT_TERMINAL_PREFIXES['claude-code'],
	launchCommand: (sessionId: string) => `claude --session-id ${sessionId}`,
	getProjectDir: (workspacePath: string) => {
		const dirName = workspacePath.replace(/[^a-zA-Z0-9-]/g, '-');
		return path.join(os.homedir(), '.claude', 'projects', dirName);
	},
	getTranscriptFile: (projectDir: string, sessionId: string) => {
		return path.join(projectDir, `${sessionId}.jsonl`);
	},
	hasTranscriptFiles: true,
	hasProjectScan: true,
	transcriptExtension: '.jsonl',
};

/**
 * Opencode: monitors ~/.local/share/opencode/sessions/<hash>/<session>.jsonl
 * Opencode is an open-source AI coding agent. It stores session data
 * under its own directory structure. We also support a custom env var
 * OPENCODE_HOME for overriding the data location.
 */
const opencodeConfig: AgentTypeConfig = {
	label: 'Opencode',
	terminalPrefix: AGENT_TERMINAL_PREFIXES['opencode'],
	launchCommand: (_sessionId: string) => `opencode`,
	getProjectDir: (workspacePath: string) => {
		// Opencode stores project data under its home directory
		const opencodeHome = process.env.OPENCODE_HOME ||
			(os.platform() === 'win32'
				? path.join(os.homedir(), '.opencode')
				: path.join(os.homedir(), '.local', 'share', 'opencode'));
		const dirName = workspacePath.replace(/[^a-zA-Z0-9-]/g, '-');
		return path.join(opencodeHome, 'sessions', dirName);
	},
	getTranscriptFile: (projectDir: string, sessionId: string) => {
		return path.join(projectDir, `${sessionId}.jsonl`);
	},
	hasTranscriptFiles: true,
	hasProjectScan: true,
	transcriptExtension: '.jsonl',
};

/**
 * VSCode Terminal: basic presence tracking without file-based transcripts.
 * Can connect to an existing terminal or create a new shell.
 */
const vscodeTerminalConfig: AgentTypeConfig = {
	label: 'VS Code Terminal',
	terminalPrefix: AGENT_TERMINAL_PREFIXES['vscode-terminal'],
	launchCommand: (_sessionId: string) => '', // No specific command — just a shell
	getProjectDir: (_workspacePath: string) => null, // No project dir needed
	getTranscriptFile: (_projectDir: string, _sessionId: string) => '',
	hasTranscriptFiles: false,
	hasProjectScan: false,
	transcriptExtension: '',
};

const AGENT_TYPE_CONFIGS: Record<AgentType, AgentTypeConfig> = {
	'claude-code': claudeCodeConfig,
	'opencode': opencodeConfig,
	'vscode-terminal': vscodeTerminalConfig,
};

/**
 * Get the configuration for an agent type.
 */
export function getAgentTypeConfig(agentType: AgentType): AgentTypeConfig {
	return AGENT_TYPE_CONFIGS[agentType];
}

/**
 * Get all available agent types and their labels.
 */
export function getAvailableAgentTypes(): Array<{ type: AgentType; label: string }> {
	return [
		{ type: 'claude-code', label: 'Claude Code' },
		{ type: 'opencode', label: 'Opencode' },
		{ type: 'vscode-terminal', label: 'VS Code Terminal' },
	];
}
