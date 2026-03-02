import * as path from 'path';
import type * as vscode from 'vscode';
import type { AgentState } from './types.js';
import {
	cancelWaitingTimer,
	startWaitingTimer,
	clearAgentActivity,
	startPermissionTimer,
	cancelPermissionTimer,
} from './timerManager.js';
import {
	TOOL_DONE_DELAY_MS,
	TEXT_IDLE_DELAY_MS,
	BASH_COMMAND_DISPLAY_MAX_LENGTH,
	TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
} from './constants.js';

export const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'AskUserQuestion']);

export function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
	const base = (p: unknown) => typeof p === 'string' ? path.basename(p) : '';
	switch (toolName) {
		case 'Read':
		case 'read_file':
			return `Reading ${base(input.file_path)}`;
		case 'Edit':
		case 'replace':
			return `Editing ${base(input.file_path)}`;
		case 'Write':
		case 'write_file':
			return `Writing ${base(input.file_path)}`;
		case 'Bash':
		case 'shell_command':
		case 'run_shell_command': {
			const cmd = (input.command as string) || '';
			return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
		}
		case 'Glob': return 'Searching files';
		case 'Grep': return 'Searching code';
		case 'WebFetch':
		case 'google_web_search':
		case 'WebSearch':
			return 'Searching the web';
		case 'Task': {
			const desc = typeof input.description === 'string' ? input.description : '';
			return desc ? `Subtask: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}` : 'Running subtask';
		}
		case 'AskUserQuestion': return 'Waiting for your answer';
		case 'EnterPlanMode': return 'Planning';
		case 'NotebookEdit': return 'Editing notebook';
		default: return `Using ${toolName}`;
	}
}

export function processTranscriptLine(
	agentId: number,
	line: string,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;
	if (agent.provider === 'codex') {
		processCodexRecord(agentId, line, agent, agents, waitingTimers, permissionTimers, webview);
		return;
	}
	processClaudeRecord(agentId, line, agent, agents, waitingTimers, permissionTimers, webview);
}

export function processGeminiSessionSnapshot(
	agentId: number,
	rawJson: string,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;
	try {
		const parsed = JSON.parse(rawJson) as { messages?: Array<Record<string, unknown>> };
		const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
		const startIdx = agent.processedGeminiMessages ?? 0;
		if (messages.length <= startIdx) return;
		let currentTurnToolId: string | null = null;
		for (const toolId of agent.activeToolIds) {
			if (toolId.startsWith('gemini-turn:')) {
				currentTurnToolId = toolId;
				break;
			}
		}

		for (let i = startIdx; i < messages.length; i++) {
			const msg = messages[i];
			const msgType = typeof msg.type === 'string' ? msg.type : '';
			const msgId = typeof msg.id === 'string' ? msg.id : `${i}`;
			const ts = typeof msg.timestamp === 'string' ? msg.timestamp : undefined;
			if (ts) {
				agent.lastGeminiMessageTs = ts;
			}

			if (msgType === 'user' && currentTurnToolId === null) {
				const virtualToolId = `gemini-turn:${msgId}`;
				const status = 'Thinking';
				currentTurnToolId = virtualToolId;
				agent.activeToolIds.add(virtualToolId);
				agent.activeToolStatuses.set(virtualToolId, status);
				agent.activeToolNames.set(virtualToolId, 'GeminiTurn');
				webview?.postMessage({ type: 'agentToolStart', id: agentId, toolId: virtualToolId, status });
				webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
				cancelWaitingTimer(agentId, waitingTimers);
			}

			if (msgType === 'gemini') {
				webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
				cancelWaitingTimer(agentId, waitingTimers);
				if (currentTurnToolId) {
					const finished = currentTurnToolId;
					agent.activeToolIds.delete(finished);
					agent.activeToolStatuses.delete(finished);
					agent.activeToolNames.delete(finished);
					currentTurnToolId = null;
					setTimeout(() => {
						webview?.postMessage({ type: 'agentToolDone', id: agentId, toolId: finished });
					}, TOOL_DONE_DELAY_MS);
				}
			}

			const toolCalls = Array.isArray(msg.toolCalls) ? msg.toolCalls as Array<Record<string, unknown>> : [];
			for (const call of toolCalls) {
				const callId = typeof call.id === 'string' ? call.id : '';
				if (!callId) continue;
				if (!agent.seenToolCalls) agent.seenToolCalls = new Set();
				if (!agent.seenToolDone) agent.seenToolDone = new Set();
				if (!agent.seenToolCalls.has(callId)) {
					const toolName = typeof call.name === 'string' ? call.name : 'Tool';
					const args = (call.args as Record<string, unknown>) || {};
					const status = formatToolStatus(toolName, args);
					agent.seenToolCalls.add(callId);
					agent.activeToolIds.add(callId);
					agent.activeToolStatuses.set(callId, status);
					agent.activeToolNames.set(callId, toolName);
					webview?.postMessage({ type: 'agentToolStart', id: agentId, toolId: callId, status });
					webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
					cancelWaitingTimer(agentId, waitingTimers);
				}

				const doneStatus = typeof call.status === 'string' ? call.status : '';
				if ((doneStatus === 'success' || doneStatus === 'error') && !agent.seenToolDone.has(callId)) {
					agent.seenToolDone.add(callId);
					agent.activeToolIds.delete(callId);
					agent.activeToolStatuses.delete(callId);
					agent.activeToolNames.delete(callId);
					const toolId = callId;
					setTimeout(() => {
						webview?.postMessage({ type: 'agentToolDone', id: agentId, toolId });
					}, TOOL_DONE_DELAY_MS);
				}
			}

			if (msgType === 'gemini') {
				startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
			}
		}

		agent.processedGeminiMessages = messages.length;
	} catch {
		// ignore malformed session snapshot
	}
}

function processCodexRecord(
	agentId: number,
	line: string,
	agent: AgentState,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	try {
		const record = JSON.parse(line) as Record<string, unknown>;
		const topType = record.type;
		if (topType === 'response_item') {
			const payload = record.payload as Record<string, unknown> | undefined;
			if (!payload) return;
			const payloadType = payload.type;
			if (payloadType === 'function_call') {
				const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
				const toolName = typeof payload.name === 'string' ? payload.name : 'Tool';
				if (!callId) return;
				let args: Record<string, unknown> = {};
				const rawArgs = payload.arguments;
				if (typeof rawArgs === 'string') {
					try {
						args = JSON.parse(rawArgs) as Record<string, unknown>;
					} catch {
						args = { command: rawArgs };
					}
				}
				const status = formatToolStatus(toolName, args);
				agent.activeToolIds.add(callId);
				agent.activeToolStatuses.set(callId, status);
				agent.activeToolNames.set(callId, toolName);
				webview?.postMessage({ type: 'agentToolStart', id: agentId, toolId: callId, status });
				webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
				cancelWaitingTimer(agentId, waitingTimers);
				startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
			} else if (payloadType === 'function_call_output') {
				const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
				if (!callId) return;
				agent.activeToolIds.delete(callId);
				agent.activeToolStatuses.delete(callId);
				agent.activeToolNames.delete(callId);
				setTimeout(() => {
					webview?.postMessage({ type: 'agentToolDone', id: agentId, toolId: callId });
				}, TOOL_DONE_DELAY_MS);
				startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
			} else if (payloadType === 'message') {
				const role = payload.role;
				if (role === 'assistant') {
					webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
					cancelWaitingTimer(agentId, waitingTimers);
					startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
				}
			}
		} else if (topType === 'event_msg') {
			const payload = record.payload as Record<string, unknown> | undefined;
			const eventType = payload?.type;
			if (eventType === 'task_complete') {
				cancelWaitingTimer(agentId, waitingTimers);
				cancelPermissionTimer(agentId, permissionTimers);
				if (agent.activeToolIds.size > 0) {
					agent.activeToolIds.clear();
					agent.activeToolStatuses.clear();
					agent.activeToolNames.clear();
					webview?.postMessage({ type: 'agentToolsClear', id: agentId });
				}
				agent.isWaiting = true;
				agent.permissionSent = false;
				webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
			}
		}
	} catch {
		// ignore malformed lines
	}
}

function processClaudeRecord(
	agentId: number,
	line: string,
	agent: AgentState,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	try {
		const record = JSON.parse(line);

		if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
			const blocks = record.message.content as Array<{
				type: string; id?: string; name?: string; input?: Record<string, unknown>;
			}>;
			const hasToolUse = blocks.some(b => b.type === 'tool_use');

			if (hasToolUse) {
				cancelWaitingTimer(agentId, waitingTimers);
				agent.isWaiting = false;
				agent.hadToolsInTurn = true;
				webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
				let hasNonExemptTool = false;
				for (const block of blocks) {
					if (block.type === 'tool_use' && block.id) {
						const toolName = block.name || '';
						const status = formatToolStatus(toolName, block.input || {});
						agent.activeToolIds.add(block.id);
						agent.activeToolStatuses.set(block.id, status);
						agent.activeToolNames.set(block.id, toolName);
						if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
							hasNonExemptTool = true;
						}
						webview?.postMessage({
							type: 'agentToolStart',
							id: agentId,
							toolId: block.id,
							status,
						});
					}
				}
				if (hasNonExemptTool) {
					startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, webview);
				}
			} else if (blocks.some(b => b.type === 'text') && !agent.hadToolsInTurn) {
				startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
			}
		} else if (record.type === 'progress') {
			processProgressRecord(agentId, record, agents, waitingTimers, permissionTimers, webview);
		} else if (record.type === 'user') {
			const content = record.message?.content;
			if (Array.isArray(content)) {
				const blocks = content as Array<{ type: string; tool_use_id?: string }>;
				const hasToolResult = blocks.some(b => b.type === 'tool_result');
				if (hasToolResult) {
					for (const block of blocks) {
						if (block.type === 'tool_result' && block.tool_use_id) {
							const completedToolId = block.tool_use_id;
							if (agent.activeToolNames.get(completedToolId) === 'Task') {
								agent.activeSubagentToolIds.delete(completedToolId);
								agent.activeSubagentToolNames.delete(completedToolId);
								webview?.postMessage({
									type: 'subagentClear',
									id: agentId,
									parentToolId: completedToolId,
								});
							}
							agent.activeToolIds.delete(completedToolId);
							agent.activeToolStatuses.delete(completedToolId);
							agent.activeToolNames.delete(completedToolId);
							const toolId = completedToolId;
							setTimeout(() => {
								webview?.postMessage({
									type: 'agentToolDone',
									id: agentId,
									toolId,
								});
							}, TOOL_DONE_DELAY_MS);
						}
					}
					if (agent.activeToolIds.size === 0) {
						agent.hadToolsInTurn = false;
					}
				} else {
					cancelWaitingTimer(agentId, waitingTimers);
					clearAgentActivity(agent, agentId, permissionTimers, webview);
					agent.hadToolsInTurn = false;
				}
			} else if (typeof content === 'string' && content.trim()) {
				cancelWaitingTimer(agentId, waitingTimers);
				clearAgentActivity(agent, agentId, permissionTimers, webview);
				agent.hadToolsInTurn = false;
			}
		} else if (record.type === 'system' && record.subtype === 'turn_duration') {
			cancelWaitingTimer(agentId, waitingTimers);
			cancelPermissionTimer(agentId, permissionTimers);
			if (agent.activeToolIds.size > 0) {
				agent.activeToolIds.clear();
				agent.activeToolStatuses.clear();
				agent.activeToolNames.clear();
				agent.activeSubagentToolIds.clear();
				agent.activeSubagentToolNames.clear();
				webview?.postMessage({ type: 'agentToolsClear', id: agentId });
			}
			agent.isWaiting = true;
			agent.permissionSent = false;
			agent.hadToolsInTurn = false;
			webview?.postMessage({
				type: 'agentStatus',
				id: agentId,
				status: 'waiting',
			});
		}
	} catch {
		// Ignore malformed lines
	}
}

function processProgressRecord(
	agentId: number,
	record: Record<string, unknown>,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;

	const parentToolId = record.parentToolUseID as string | undefined;
	if (!parentToolId) return;

	const data = record.data as Record<string, unknown> | undefined;
	if (!data) return;

	const dataType = data.type as string | undefined;
	if (dataType === 'bash_progress' || dataType === 'mcp_progress') {
		if (agent.activeToolIds.has(parentToolId)) {
			startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, webview);
		}
		return;
	}

	if (agent.activeToolNames.get(parentToolId) !== 'Task') return;

	const msg = data.message as Record<string, unknown> | undefined;
	if (!msg) return;

	const msgType = msg.type as string;
	const innerMsg = msg.message as Record<string, unknown> | undefined;
	const content = innerMsg?.content;
	if (!Array.isArray(content)) return;

	if (msgType === 'assistant') {
		let hasNonExemptSubTool = false;
		for (const block of content) {
			if (block.type === 'tool_use' && block.id) {
				const toolName = block.name || '';
				const status = formatToolStatus(toolName, block.input || {});

				let subTools = agent.activeSubagentToolIds.get(parentToolId);
				if (!subTools) {
					subTools = new Set();
					agent.activeSubagentToolIds.set(parentToolId, subTools);
				}
				subTools.add(block.id);

				let subNames = agent.activeSubagentToolNames.get(parentToolId);
				if (!subNames) {
					subNames = new Map();
					agent.activeSubagentToolNames.set(parentToolId, subNames);
				}
				subNames.set(block.id, toolName);

				if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
					hasNonExemptSubTool = true;
				}

				webview?.postMessage({
					type: 'subagentToolStart',
					id: agentId,
					parentToolId,
					toolId: block.id,
					status,
				});
			}
		}
		if (hasNonExemptSubTool) {
			startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, webview);
		}
	} else if (msgType === 'user') {
		for (const block of content) {
			if (block.type === 'tool_result' && block.tool_use_id) {
				const subTools = agent.activeSubagentToolIds.get(parentToolId);
				if (subTools) {
					subTools.delete(block.tool_use_id);
				}
				const subNames = agent.activeSubagentToolNames.get(parentToolId);
				if (subNames) {
					subNames.delete(block.tool_use_id);
				}

				const toolId = block.tool_use_id;
				setTimeout(() => {
					webview?.postMessage({
						type: 'subagentToolDone',
						id: agentId,
						parentToolId,
						toolId,
					});
				}, TOOL_DONE_DELAY_MS);
			}
		}
		let stillHasNonExempt = false;
		for (const [, subNames] of agent.activeSubagentToolNames) {
			for (const [, toolName] of subNames) {
				if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
					stillHasNonExempt = true;
					break;
				}
			}
			if (stillHasNonExempt) break;
		}
		if (stillHasNonExempt) {
			startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, webview);
		}
	}
}

