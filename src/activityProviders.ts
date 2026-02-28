import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState } from './types.js';
import { processTranscriptLine } from './transcriptParser.js';

export type ProviderId = 'claude-jsonl' | 'openclaw-session';

export interface ActivityProviderContext {
	agentId: number;
	agents: Map<number, AgentState>;
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>;
	webview: vscode.Webview | undefined;
}

export interface ActivityProvider {
	id: ProviderId;
	displayName: string;
	getProjectDirPath(cwd?: string): string | null;
	getLaunchCommand(sessionId: string): string | null;
	processLine(line: string, ctx: ActivityProviderContext): void;
}

const claudeProvider: ActivityProvider = {
	id: 'claude-jsonl',
	displayName: 'Claude JSONL',
	getProjectDirPath(cwd?: string): string | null {
		const workspacePath = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspacePath) return null;
		const dirName = workspacePath.replace(/[^a-zA-Z0-9-]/g, '-');
		return path.join(os.homedir(), '.claude', 'projects', dirName);
	},
	getLaunchCommand(sessionId: string): string | null {
		return `claude --session-id ${sessionId}`;
	},
	processLine(line: string, ctx: ActivityProviderContext): void {
		processTranscriptLine(
			ctx.agentId,
			line,
			ctx.agents,
			ctx.waitingTimers,
			ctx.permissionTimers,
			ctx.webview,
		);
	},
};

const openclawProvider: ActivityProvider = {
	id: 'openclaw-session',
	displayName: 'OpenClaw Session (MVP skeleton)',
	getProjectDirPath(): string | null {
		// Placeholder path strategy for phase 1.
		// Real OpenClaw source mapping comes in phase 2.
		return path.join(os.homedir(), '.openclaw', 'agents', 'main', 'sessions');
	},
	getLaunchCommand(): string | null {
		// No terminal launch command yet (phase 2 decides source strategy).
		return null;
	},
	processLine(line: string, ctx: ActivityProviderContext): void {
		// Skeleton parser so architecture can be exercised before full adapter lands.
		// Accepts simple normalized JSON lines if provided by a future bridge:
		// {"event":"tool_start","toolId":"x","status":"Reading file"}
		// {"event":"tool_done","toolId":"x"}
		// {"event":"waiting"}
		// {"event":"active"}
		try {
			const evt = JSON.parse(line) as {
				event?: string;
				toolId?: string;
				status?: string;
			};
			if (evt.event === 'tool_start' && evt.toolId && evt.status) {
				ctx.webview?.postMessage({
					type: 'agentToolStart',
					id: ctx.agentId,
					toolId: evt.toolId,
					status: evt.status,
				});
				ctx.webview?.postMessage({ type: 'agentStatus', id: ctx.agentId, status: 'active' });
				return;
			}
			if (evt.event === 'tool_done' && evt.toolId) {
				ctx.webview?.postMessage({
					type: 'agentToolDone',
					id: ctx.agentId,
					toolId: evt.toolId,
				});
				return;
			}
			if (evt.event === 'waiting') {
				ctx.webview?.postMessage({ type: 'agentStatus', id: ctx.agentId, status: 'waiting' });
				return;
			}
			if (evt.event === 'active') {
				ctx.webview?.postMessage({ type: 'agentStatus', id: ctx.agentId, status: 'active' });
			}
		} catch {
			// Ignore malformed lines in skeleton mode.
		}
	},
};

export function getActivityProvider(config: vscode.WorkspaceConfiguration): ActivityProvider {
	const selected = config.get<ProviderId>('provider', 'claude-jsonl');
	if (selected === 'openclaw-session') return openclawProvider;
	return claudeProvider;
}
