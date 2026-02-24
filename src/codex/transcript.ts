import type * as vscode from 'vscode';
import type { AgentState } from '../types.js';
import { TOOL_DONE_DELAY_MS, BASH_COMMAND_DISPLAY_MAX_LENGTH } from '../constants.js';
import { cancelWaitingTimer, clearAgentActivity } from '../timerManager.js';

export function processCodexRecord(
	agentId: number,
	agent: AgentState,
	record: Record<string, unknown>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
	markAgentWaiting: (
		agentId: number,
		agent: AgentState,
		waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
		permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
		webview: vscode.Webview | undefined,
	) => void,
): void {
	if (record.type === 'response_item') {
		const payload = record.payload as Record<string, unknown> | undefined;
		if (!payload) return;
		const payloadType = payload.type;

		if (payloadType === 'function_call') {
			const callId = payload.call_id;
			const toolName = payload.name;
			if (typeof callId !== 'string' || typeof toolName !== 'string') return;

			const status = formatCodexToolStatus(toolName, payload.arguments);
			cancelWaitingTimer(agentId, waitingTimers);
			agent.isWaiting = false;
			agent.hadToolsInTurn = true;
			webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });

			agent.activeToolIds.add(callId);
			agent.activeToolStatuses.set(callId, status);
			agent.activeToolNames.set(callId, toolName);
			agent.activeToolCallToName.set(callId, toolName);
			webview?.postMessage({
				type: 'agentToolStart',
				id: agentId,
				toolId: callId,
				status,
			});
			return;
		}

		if (payloadType === 'function_call_output') {
			const callId = payload.call_id;
			if (typeof callId !== 'string') return;
			agent.activeToolIds.delete(callId);
			agent.activeToolStatuses.delete(callId);
			agent.activeToolNames.delete(callId);
			agent.activeToolCallToName.delete(callId);
			setTimeout(() => {
				webview?.postMessage({
					type: 'agentToolDone',
					id: agentId,
					toolId: callId,
				});
			}, TOOL_DONE_DELAY_MS);
			if (agent.activeToolIds.size === 0) {
				agent.hadToolsInTurn = false;
			}
			return;
		}

		if (payloadType === 'message') {
			const role = payload.role;
			if (role === 'user') {
				cancelWaitingTimer(agentId, waitingTimers);
				clearAgentActivity(agent, agentId, permissionTimers, webview);
				agent.hadToolsInTurn = false;
				return;
			}
			if (role === 'assistant' && payload.phase === 'final_answer') {
				markAgentWaiting(agentId, agent, waitingTimers, permissionTimers, webview);
				return;
			}
		}
		return;
	}

	if (record.type === 'event_msg') {
		const payload = record.payload as Record<string, unknown> | undefined;
		if (!payload) return;
		if (payload.type === 'task_complete') {
			markAgentWaiting(agentId, agent, waitingTimers, permissionTimers, webview);
		}
	}
}

function formatCodexToolStatus(toolName: string, rawArguments: unknown): string {
	if (toolName === 'exec_command') {
		let cmd = '';
		if (typeof rawArguments === 'string') {
			try {
				const parsed = JSON.parse(rawArguments) as { cmd?: unknown };
				if (typeof parsed.cmd === 'string') {
					cmd = parsed.cmd;
				}
			} catch {
				// Ignore parse errors.
			}
		}
		if (!cmd && typeof rawArguments === 'object' && rawArguments !== null) {
			const argObj = rawArguments as { cmd?: unknown };
			if (typeof argObj.cmd === 'string') {
				cmd = argObj.cmd;
			}
		}
		if (cmd) {
			return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
		}
		return 'Running command';
	}

	if (toolName === 'parallel') {
		return 'Running parallel tools';
	}

	if (toolName.startsWith('mcp__')) {
		const normalized = toolName.replace(/^mcp__/, '').replace(/__/g, ':');
		return `Using ${normalized}`;
	}

	return `Using ${toolName}`;
}
