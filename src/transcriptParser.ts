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
	PERMISSION_TIMER_SHELL_DELAY_MS,
} from './constants.js';

const CODEX_SHELL_LIKE_TOOLS = new Set(['exec_command', 'shell', 'shell_command']);

const APPROVAL_SIGNAL_PATTERNS = [
	/\bapprove\b/i,
	/\bapproval\b/i,
	/\ballow\b/i,
	/\bpermission\b/i,
	/do you want me to/i,
	/would you like me to/i,
	/should i proceed/i,
	/can i proceed/i,
	/confirm/i,
];

export const PERMISSION_EXEMPT_TOOLS = new Set([
	'Task',
	'AskUserQuestion',
	'EnterPlanMode',
	'update_plan',
	'request_user_input',
]);

export function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
	const base = (p: unknown) => typeof p === 'string' ? path.basename(p) : '';
	switch (toolName) {
		case 'Read': return `Reading ${base(input.file_path)}`;
		case 'Edit': return `Editing ${base(input.file_path)}`;
		case 'Write': return `Writing ${base(input.file_path)}`;
		case 'Bash': {
			const cmd = (input.command as string) || '';
			return `Running: ${truncateStatusText(cmd, BASH_COMMAND_DISPLAY_MAX_LENGTH)}`;
		}
		case 'Glob': return 'Searching files';
		case 'Grep': return 'Searching code';
		case 'WebFetch': return 'Fetching web content';
		case 'WebSearch': return 'Searching the web';
		case 'Task': {
			const desc = typeof input.description === 'string' ? input.description : '';
			return desc ? `Subtask: ${truncateStatusText(desc, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH)}` : 'Running subtask';
		}
		case 'AskUserQuestion': return 'Waiting for your answer';
		case 'EnterPlanMode': return 'Planning';
		case 'NotebookEdit': return 'Editing notebook';
		default: return `Using ${toolName}`;
	}
}

function formatCodexToolStatus(toolName: string, input: Record<string, unknown>): string {
	switch (toolName) {
		case 'exec_command':
		case 'shell':
		case 'shell_command': {
			const command = extractShellCommand(input);
			return command
				? `Running: ${truncateStatusText(command, BASH_COMMAND_DISPLAY_MAX_LENGTH)}`
				: 'Running command';
		}
		case 'apply_patch':
			return 'Editing files';
		case 'update_plan':
			return 'Planning';
		default:
			if (toolName.toLowerCase().includes('plan')) {
				return 'Planning';
			}
			return `Using ${toolName}`;
	}
}

function truncateStatusText(text: string, maxLength: number): string {
	return text.length > maxLength ? `${text.slice(0, maxLength)}\u2026` : text;
}

function extractShellCommand(input: Record<string, unknown>): string {
	const cmd = input.cmd;
	if (typeof cmd === 'string' && cmd.trim()) {
		return cmd;
	}

	const command = input.command;
	if (typeof command === 'string' && command.trim()) {
		return command;
	}
	if (Array.isArray(command)) {
		return command
			.filter((part): part is string => typeof part === 'string')
			.join(' ')
			.trim();
	}

	return '';
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
	try {
		const record = JSON.parse(line) as Record<string, unknown>;

		if (record.type === 'response_item' || record.type === 'event_msg') {
			processCodexRecord(agentId, record, agents, waitingTimers, permissionTimers, webview);
			return;
		}

		const message = record.message as { content?: unknown } | undefined;
		if (record.type === 'assistant' && Array.isArray(message?.content)) {
			const blocks = message.content as Array<{
				type: string;
				id?: string;
				name?: string;
				input?: Record<string, unknown>;
			}>;
			const hasToolUse = blocks.some((b) => b.type === 'tool_use');

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
						console.log(`[Pixel Agents] Agent ${agentId} tool start: ${block.id} ${status}`);
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
			} else if (blocks.some((b) => b.type === 'text') && !agent.hadToolsInTurn) {
				startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
			}
		} else if (record.type === 'progress') {
			processProgressRecord(agentId, record, agents, waitingTimers, permissionTimers, webview);
		} else if (record.type === 'user') {
			const content = message?.content;
			if (Array.isArray(content)) {
				const blocks = content as Array<{ type: string; tool_use_id?: string }>;
				const hasToolResult = blocks.some((b) => b.type === 'tool_result');
				if (hasToolResult) {
					for (const block of blocks) {
						if (block.type === 'tool_result' && block.tool_use_id) {
							console.log(`[Pixel Agents] Agent ${agentId} tool done: ${block.tool_use_id}`);
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

			clearTrackedToolState(agent, agentId, webview);

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

function processCodexRecord(
	agentId: number,
	record: Record<string, unknown>,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;

	if (record.type === 'response_item') {
		const payload = record.payload as Record<string, unknown> | undefined;
		if (!payload) return;

		const payloadType = payload.type;
		if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
			const toolId = typeof payload.call_id === 'string' ? payload.call_id : '';
			if (!toolId) return;

			const toolName = typeof payload.name === 'string' ? payload.name : '';
			const input = parseCodexToolInput(payload);
			const status = formatCodexToolStatus(toolName, input);

			cancelWaitingTimer(agentId, waitingTimers);
			agent.isWaiting = false;
			agent.hadToolsInTurn = true;
			agent.activeToolIds.add(toolId);
			agent.activeToolStatuses.set(toolId, status);
			agent.activeToolNames.set(toolId, toolName);
			webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
			webview?.postMessage({ type: 'agentToolStart', id: agentId, toolId, status });

			if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
				const timerDelay = CODEX_SHELL_LIKE_TOOLS.has(toolName)
					? PERMISSION_TIMER_SHELL_DELAY_MS
					: undefined;
				startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, webview, timerDelay);
			}
			return;
		}

		if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
			const toolId = typeof payload.call_id === 'string' ? payload.call_id : '';
			if (!toolId) return;

			agent.activeToolIds.delete(toolId);
			agent.activeToolStatuses.delete(toolId);
			agent.activeToolNames.delete(toolId);

			setTimeout(() => {
				webview?.postMessage({ type: 'agentToolDone', id: agentId, toolId });
			}, TOOL_DONE_DELAY_MS);

			if (agent.activeToolIds.size === 0) {
				agent.hadToolsInTurn = false;
			}
			return;
		}

		if (payloadType === 'message' && payload.role === 'assistant') {
			const assistantText = extractMessageText(payload.content);
			if (assistantText) {
				maybeSignalPermissionWait(agentId, assistantText, agents, permissionTimers, webview);
			}
		}
		return;
	}

	if (record.type === 'event_msg') {
		const payload = record.payload as Record<string, unknown> | undefined;
		if (!payload) return;

		const eventType = payload.type;
		if (eventType === 'task_started') {
			cancelWaitingTimer(agentId, waitingTimers);
			agent.isWaiting = false;
			webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
			return;
		}

		if (eventType === 'user_message') {
			cancelWaitingTimer(agentId, waitingTimers);
			clearAgentActivity(agent, agentId, permissionTimers, webview);
			agent.hadToolsInTurn = false;
			return;
		}

		if (eventType === 'task_complete') {
			cancelWaitingTimer(agentId, waitingTimers);
			cancelPermissionTimer(agentId, permissionTimers);
			clearTrackedToolState(agent, agentId, webview);

			agent.isWaiting = true;
			agent.permissionSent = false;
			agent.hadToolsInTurn = false;
			webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
			return;
		}

		if (eventType === 'turn_aborted') {
			cancelWaitingTimer(agentId, waitingTimers);
			clearAgentActivity(agent, agentId, permissionTimers, webview);
			agent.hadToolsInTurn = false;
			return;
		}

		if (eventType === 'agent_message' && typeof payload.message === 'string') {
			maybeSignalPermissionWait(agentId, payload.message, agents, permissionTimers, webview);
		}
	}
}

function parseCodexToolInput(payload: Record<string, unknown>): Record<string, unknown> {
	const args = payload.arguments;
	if (typeof args === 'string') {
		try {
			const parsed = JSON.parse(args) as unknown;
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			// ignore parse errors
		}
	}

	const input = payload.input;
	if (input && typeof input === 'object' && !Array.isArray(input)) {
		return input as Record<string, unknown>;
	}

	if (typeof input === 'string') {
		return { input };
	}

	return {};
}

function extractMessageText(content: unknown): string {
	if (!Array.isArray(content)) return '';
	const chunks: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== 'object') continue;
		const rec = part as { type?: string; text?: string };
		if (
			(rec.type === 'output_text' || rec.type === 'input_text' || rec.type === 'text')
			&& typeof rec.text === 'string'
		) {
			chunks.push(rec.text);
		}
	}
	return chunks.join(' ').trim();
}

function maybeSignalPermissionWait(
	agentId: number,
	assistantText: string,
	agents: Map<number, AgentState>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	if (!looksLikeApprovalPrompt(assistantText)) return;
	const agent = agents.get(agentId);
	if (!agent) return;
	if (!hasNonExemptActiveTools(agent)) return;
	if (agent.permissionSent) return;

	cancelPermissionTimer(agentId, permissionTimers);
	agent.permissionSent = true;
	webview?.postMessage({ type: 'agentToolPermission', id: agentId });
}

function looksLikeApprovalPrompt(text: string): boolean {
	const normalized = text.trim();
	if (!normalized) return false;
	return APPROVAL_SIGNAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasNonExemptActiveTools(agent: AgentState): boolean {
	for (const toolId of agent.activeToolIds) {
		const toolName = agent.activeToolNames.get(toolId);
		if (!PERMISSION_EXEMPT_TOOLS.has(toolName || '')) {
			return true;
		}
	}

	for (const [, subToolNames] of agent.activeSubagentToolNames) {
		for (const [, toolName] of subToolNames) {
			if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
				return true;
			}
		}
	}

	return false;
}

function clearTrackedToolState(
	agent: AgentState,
	agentId: number,
	webview: vscode.Webview | undefined,
): void {
	const hadTrackedState =
		agent.activeToolIds.size > 0
		|| agent.activeToolStatuses.size > 0
		|| agent.activeToolNames.size > 0
		|| agent.activeSubagentToolIds.size > 0
		|| agent.activeSubagentToolNames.size > 0;

	agent.activeToolIds.clear();
	agent.activeToolStatuses.clear();
	agent.activeToolNames.clear();
	agent.activeSubagentToolIds.clear();
	agent.activeSubagentToolNames.clear();

	if (hadTrackedState) {
		webview?.postMessage({ type: 'agentToolsClear', id: agentId });
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
				console.log(`[Pixel Agents] Agent ${agentId} subagent tool start: ${block.id} ${status} (parent: ${parentToolId})`);

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
				console.log(`[Pixel Agents] Agent ${agentId} subagent tool done: ${block.tool_use_id} (parent: ${parentToolId})`);

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
