import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState } from './types.js';
import { processTranscriptLine, formatToolStatus, PERMISSION_EXEMPT_TOOLS } from './transcriptParser.js';
import { startPermissionTimer, cancelPermissionTimer, clearAgentActivity } from './timerManager.js';

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
	mode: 'terminal' | 'session-observer';
	getProjectDirPath(cwd?: string): string | null;
	getLaunchCommand(sessionId: string): string | null;
	processLine(line: string, ctx: ActivityProviderContext): void;
}

const claudeProvider: ActivityProvider = {
	id: 'claude-jsonl',
	displayName: 'Claude JSONL',
	mode: 'terminal',
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
	displayName: 'OpenClaw Session (phase-2 adapter)',
	mode: 'session-observer',
	getProjectDirPath(): string | null {
		return path.join(os.homedir(), '.openclaw', 'agents', 'main', 'sessions');
	},
	getLaunchCommand(): string | null {
		// OpenClaw sessions are observed from session JSONL files (no terminal launch).
		return null;
	},
	processLine(line: string, ctx: ActivityProviderContext): void {
		const agent = ctx.agents.get(ctx.agentId);
		if (!agent) return;
		try {
			const record = JSON.parse(line) as {
				type?: string;
				message?: {
					role?: string;
					toolCallId?: string;
					toolName?: string;
					content?: Array<Record<string, unknown>> | string;
				};
			};

			if (record.type !== 'message' || !record.message) {
				return;
			}

			const role = record.message.role;

			if (role === 'assistant' && Array.isArray(record.message.content)) {
				let sawToolCall = false;
				let hasNonExemptTool = false;
				for (const block of record.message.content) {
					if (block.type !== 'toolCall') continue;
					sawToolCall = true;
					const toolId = typeof block.id === 'string' ? block.id : '';
					const toolName = typeof block.name === 'string' ? block.name : '';
					const args = (block.arguments && typeof block.arguments === 'object')
						? (block.arguments as Record<string, unknown>)
						: {};
					if (!toolId) continue;
					const status = formatToolStatus(toolName, args);
					agent.activeToolIds.add(toolId);
					agent.activeToolStatuses.set(toolId, status);
					agent.activeToolNames.set(toolId, toolName);
					if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
						hasNonExemptTool = true;
					}
					ctx.webview?.postMessage({
						type: 'agentToolStart',
						id: ctx.agentId,
						toolId,
						status,
					});
				}
				if (sawToolCall) {
					agent.isWaiting = false;
					agent.hadToolsInTurn = true;
					ctx.webview?.postMessage({ type: 'agentStatus', id: ctx.agentId, status: 'active' });
					if (hasNonExemptTool) {
						startPermissionTimer(ctx.agentId, ctx.agents, ctx.permissionTimers, PERMISSION_EXEMPT_TOOLS, ctx.webview);
					}
					return;
				}

				// Assistant text without tool calls means turn likely done and waiting for user.
				cancelPermissionTimer(ctx.agentId, ctx.permissionTimers);
				agent.isWaiting = true;
				agent.hadToolsInTurn = false;
				ctx.webview?.postMessage({ type: 'agentStatus', id: ctx.agentId, status: 'waiting' });
				return;
			}

			if (role === 'toolResult') {
				const toolCallId = record.message.toolCallId;
				if (toolCallId) {
					agent.activeToolIds.delete(toolCallId);
					agent.activeToolStatuses.delete(toolCallId);
					agent.activeToolNames.delete(toolCallId);
					ctx.webview?.postMessage({ type: 'agentToolDone', id: ctx.agentId, toolId: toolCallId });
				}
				if (agent.activeToolIds.size === 0) {
					agent.hadToolsInTurn = false;
					cancelPermissionTimer(ctx.agentId, ctx.permissionTimers);
				}
				return;
			}

			if (role === 'user') {
				// New user turn: clear previous activity markers.
				clearAgentActivity(agent, ctx.agentId, ctx.permissionTimers, ctx.webview);
				agent.isWaiting = false;
				agent.hadToolsInTurn = false;
				ctx.webview?.postMessage({ type: 'agentStatus', id: ctx.agentId, status: 'active' });
			}
		} catch {
			// Ignore malformed lines.
		}
	},
};

export function getActivityProvider(config: vscode.WorkspaceConfiguration): ActivityProvider {
	const selected = config.get<ProviderId>('provider', 'claude-jsonl');
	if (selected === 'openclaw-session') return openclawProvider;
	return claudeProvider;
}
