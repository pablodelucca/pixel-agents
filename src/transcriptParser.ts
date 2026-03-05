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

export const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'AskUserQuestion', 'request_user_input', 'wait']);

function asRecord(value: unknown): Record<string, unknown> {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

function normalizeInput(input: unknown): Record<string, unknown> {
	if (typeof input === 'string') {
		return { input };
	}
	return asRecord(input);
}

function parseJsonObject(value: unknown): Record<string, unknown> {
	if (typeof value !== 'string') return {};
	try {
		const parsed = JSON.parse(value) as unknown;
		return asRecord(parsed);
	} catch {
		return {};
	}
}

function parseJsonValue(value: unknown): unknown {
	if (typeof value !== 'string') return null;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return null;
	}
}

function truncateLabel(value: string): string {
	return value.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH
		? `${value.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH)}\u2026`
		: value;
}

function buildCodexSubagentParentToolId(subagentSessionId: string): string {
	return `codex-subagent:${subagentSessionId}`;
}

function clearCodexSubagentByParentToolId(
	agentId: number,
	agent: AgentState,
	parentToolId: string,
	webview: vscode.Webview | undefined,
): void {
	let targetSubagentId: string | null = null;
	for (const [subagentId, mappedParentToolId] of agent.codexSubagentParentToolIds) {
		if (mappedParentToolId === parentToolId) {
			targetSubagentId = subagentId;
			break;
		}
	}
	if (targetSubagentId) {
		agent.codexSubagentParentToolIds.delete(targetSubagentId);
		agent.codexSubagentLabels.delete(targetSubagentId);
	}
	agent.activeSubagentToolIds.delete(parentToolId);
	agent.activeSubagentToolNames.delete(parentToolId);
	webview?.postMessage({
		type: 'subagentClear',
		id: agentId,
		parentToolId,
	});
}

function clearAllCodexSubagents(
	agentId: number,
	agent: AgentState,
	webview: vscode.Webview | undefined,
): void {
	const parentToolIds = new Set(agent.codexSubagentParentToolIds.values());
	for (const parentToolId of parentToolIds) {
		clearCodexSubagentByParentToolId(agentId, agent, parentToolId, webview);
	}
	agent.codexPendingSpawnCalls.clear();
	agent.codexWaitCallMap.clear();
}

function ensureCodexSubagentLinked(
	agentId: number,
	agent: AgentState,
	subagentSessionId: string,
	labelRaw: string,
	webview: vscode.Webview | undefined,
): string {
	const parentToolId = agent.codexSubagentParentToolIds.get(subagentSessionId)
		?? buildCodexSubagentParentToolId(subagentSessionId);
	const label = labelRaw.trim() || 'Sub-agent';
	agent.codexSubagentParentToolIds.set(subagentSessionId, parentToolId);
	agent.codexSubagentLabels.set(subagentSessionId, label);
	webview?.postMessage({
		type: 'codexSubagentLinked',
		id: agentId,
		parentToolId,
		subagentId: subagentSessionId,
		label,
	});
	return parentToolId;
}

function trackSubagentToolStart(
	agent: AgentState,
	parentToolId: string,
	toolId: string,
	toolName: string,
): void {
	let subTools = agent.activeSubagentToolIds.get(parentToolId);
	if (!subTools) {
		subTools = new Set();
		agent.activeSubagentToolIds.set(parentToolId, subTools);
	}
	subTools.add(toolId);

	let subToolNames = agent.activeSubagentToolNames.get(parentToolId);
	if (!subToolNames) {
		subToolNames = new Map();
		agent.activeSubagentToolNames.set(parentToolId, subToolNames);
	}
	subToolNames.set(toolId, toolName);
}

function trackSubagentToolDone(
	agent: AgentState,
	parentToolId: string,
	toolId: string,
): boolean {
	const subTools = agent.activeSubagentToolIds.get(parentToolId);
	if (subTools) {
		subTools.delete(toolId);
	}
	const subToolNames = agent.activeSubagentToolNames.get(parentToolId);
	if (subToolNames) {
		subToolNames.delete(toolId);
	}
	const hasAny = (subTools && subTools.size > 0) || (subToolNames && subToolNames.size > 0);
	if (!hasAny) {
		agent.activeSubagentToolIds.delete(parentToolId);
		agent.activeSubagentToolNames.delete(parentToolId);
	}
	return !hasAny;
}

function extractCodexSpawnLabel(inputRaw: unknown): string {
	const input = normalizeInput(inputRaw);
	const nickname = typeof input.agent_nickname === 'string' ? input.agent_nickname.trim() : '';
	if (nickname) return truncateLabel(nickname);
	const description = typeof input.description === 'string' ? input.description.trim() : '';
	if (description) return truncateLabel(description);
	const message = typeof input.message === 'string' ? input.message.trim() : '';
	if (!message) return 'Sub-agent';
	const firstSentence = message.split(/[.!?\n]/, 1)[0]?.trim() ?? '';
	return truncateLabel(firstSentence || message);
}

function extractCompletedWaitSubagentIds(waitOutputRaw: unknown): string[] {
	const parsed = parseJsonValue(waitOutputRaw);
	const parsedRecord = asRecord(parsed);
	const statusRecord = asRecord(parsedRecord.status);
	const completed: string[] = [];
	for (const [subagentId, stateRaw] of Object.entries(statusRecord)) {
		const state = asRecord(stateRaw);
		if (Object.keys(state).some(k => ['completed', 'failed', 'cancelled', 'closed', 'error'].includes(k))) {
			completed.push(subagentId);
		}
	}
	return completed;
}

export function formatToolStatus(toolName: string, inputRaw: unknown): string {
	const input = normalizeInput(inputRaw);
	const base = (p: unknown) => typeof p === 'string' ? path.basename(p) : '';
	switch (toolName) {
		case 'Read': return `Reading ${base(input.file_path)}`;
		case 'Edit': return `Editing ${base(input.file_path)}`;
		case 'Write': return `Writing ${base(input.file_path)}`;
		case 'Bash': {
			const cmd = (input.command as string) || '';
			return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
		}
		case 'Glob': return 'Searching files';
		case 'Grep': return 'Searching code';
		case 'WebFetch': return 'Fetching web content';
		case 'WebSearch':
		case 'web_search_call': return 'Searching the web';
		case 'Task': {
			const desc = typeof input.description === 'string' ? input.description : '';
			return desc ? `Subtask: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}` : 'Running subtask';
		}
		case 'AskUserQuestion':
		case 'request_user_input': return 'Waiting for your answer';
		case 'EnterPlanMode': return 'Planning';
		case 'NotebookEdit': return 'Editing notebook';
		case 'exec_command': {
			const cmd = (input.cmd as string) || '';
			return cmd ? `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}` : 'Running command';
		}
		case 'write_stdin': return 'Interacting with process';
		case 'apply_patch': return 'Editing files';
		case 'js_repl': return 'Running JS REPL';
		case 'spawn_agent': return 'Spawning sub-agent';
		default: return `Using ${toolName}`;
	}
}

function beginTool(
	agentId: number,
	agent: AgentState,
	toolId: string,
	toolName: string,
	toolInput: unknown,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	agents: Map<number, AgentState>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	cancelWaitingTimer(agentId, waitingTimers);
	agent.isWaiting = false;
	agent.hadToolsInTurn = true;
	const status = formatToolStatus(toolName, toolInput);
	console.log(`[Pixel Agents] Agent ${agentId} tool start: ${toolId} ${status}`);
	agent.activeToolIds.add(toolId);
	agent.activeToolStatuses.set(toolId, status);
	agent.activeToolNames.set(toolId, toolName);
	webview?.postMessage({
		type: 'agentStatus',
		id: agentId,
		status: 'active',
	});
	webview?.postMessage({
		type: 'agentToolStart',
		id: agentId,
		toolId,
		status,
	});
	if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
		startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, webview);
	}
}

function finishTool(
	agentId: number,
	agent: AgentState,
	toolId: string,
	webview: vscode.Webview | undefined,
): void {
	if (!agent.activeToolIds.has(toolId)) return;
	console.log(`[Pixel Agents] Agent ${agentId} tool done: ${toolId}`);
	const toolName = agent.activeToolNames.get(toolId) || '';
	if (toolName === 'Task') {
		agent.activeSubagentToolIds.delete(toolId);
		agent.activeSubagentToolNames.delete(toolId);
		webview?.postMessage({
			type: 'subagentClear',
			id: agentId,
			parentToolId: toolId,
		});
	}
	if (toolName === 'wait') {
		const waitMap = agent.codexWaitCallMap.get(toolId);
		if (waitMap) {
			for (const [subagentSessionId, subToolId] of waitMap) {
				const parentToolId = agent.codexSubagentParentToolIds.get(subagentSessionId)
					?? buildCodexSubagentParentToolId(subagentSessionId);
				trackSubagentToolDone(agent, parentToolId, subToolId);
				setTimeout(() => {
					webview?.postMessage({
						type: 'subagentToolDone',
						id: agentId,
						parentToolId,
						toolId: subToolId,
					});
				}, TOOL_DONE_DELAY_MS);
			}
			agent.codexWaitCallMap.delete(toolId);
		}
	}
	if (toolName === 'spawn_agent') {
		agent.codexPendingSpawnCalls.delete(toolId);
	}
	agent.activeToolIds.delete(toolId);
	agent.activeToolStatuses.delete(toolId);
	agent.activeToolNames.delete(toolId);
	setTimeout(() => {
		webview?.postMessage({
			type: 'agentToolDone',
			id: agentId,
			toolId,
		});
	}, TOOL_DONE_DELAY_MS);
	if (agent.activeToolIds.size === 0) {
		agent.hadToolsInTurn = false;
	}
}

function markTurnWaiting(
	agentId: number,
	agent: AgentState,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
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
	clearAllCodexSubagents(agentId, agent, webview);

	agent.isWaiting = true;
	agent.permissionSent = false;
	agent.hadToolsInTurn = false;
	webview?.postMessage({
		type: 'agentStatus',
		id: agentId,
		status: 'waiting',
	});
}

function processCodexTranscriptRecord(
	agentId: number,
	record: Record<string, unknown>,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;

	if (record.type === 'session_meta') {
		const payload = asRecord(record.payload);
		const sessionId = typeof payload.id === 'string' ? payload.id : '';
		if (sessionId && agent.codexSessionId !== sessionId) {
			agent.codexSessionId = sessionId;
		}
		return;
	}

	if (record.type === 'response_item') {
		const payload = asRecord(record.payload);
		const payloadType = typeof payload.type === 'string' ? payload.type : '';

		if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
			const toolId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
			if (!toolId) return;
			const toolName = typeof payload.name === 'string' ? payload.name : payloadType;
			const toolInput = payloadType === 'function_call'
				? parseJsonObject(payload.arguments)
				: normalizeInput(payload.input);

			if (toolName === 'spawn_agent') {
				agent.codexPendingSpawnCalls.set(toolId, extractCodexSpawnLabel(toolInput));
			}

			beginTool(agentId, agent, toolId, toolName, toolInput, waitingTimers, agents, permissionTimers, webview);

			if (toolName === 'wait') {
				const waitIdsRaw = toolInput.ids;
				const waitIds = Array.isArray(waitIdsRaw) ? waitIdsRaw.filter(id => typeof id === 'string') as string[] : [];
				const waitMap = new Map<string, string>();
				for (const subagentSessionId of waitIds) {
					const existingLabel = agent.codexSubagentLabels.get(subagentSessionId) || 'Sub-agent';
					const parentToolId = ensureCodexSubagentLinked(agentId, agent, subagentSessionId, existingLabel, webview);
					const subToolId = `${toolId}:${subagentSessionId}`;
					waitMap.set(subagentSessionId, subToolId);
					trackSubagentToolStart(agent, parentToolId, subToolId, 'wait');
					webview?.postMessage({
						type: 'subagentToolStart',
						id: agentId,
						parentToolId,
						toolId: subToolId,
						status: 'Waiting for result',
					});
				}
				if (waitMap.size > 0) {
					agent.codexWaitCallMap.set(toolId, waitMap);
				}
			}

			if (payload.status === 'completed') {
				finishTool(agentId, agent, toolId, webview);
			}
			return;
		}

		if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
			const toolId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
			if (!toolId) return;
			const toolName = agent.activeToolNames.get(toolId) || '';

			if (toolName === 'spawn_agent') {
				const output = parseJsonObject(payload.output);
				const subagentSessionId = typeof output.agent_id === 'string' ? output.agent_id : '';
				if (subagentSessionId) {
					const outputLabel = typeof output.nickname === 'string' ? output.nickname.trim() : '';
					const pendingLabel = agent.codexPendingSpawnCalls.get(toolId) || 'Sub-agent';
					ensureCodexSubagentLinked(
						agentId,
						agent,
						subagentSessionId,
						outputLabel || pendingLabel,
						webview,
					);
				}
				agent.codexPendingSpawnCalls.delete(toolId);
			}

			if (toolName === 'wait') {
				const waitMap = agent.codexWaitCallMap.get(toolId);
				const completedSubagentIds = extractCompletedWaitSubagentIds(payload.output);
				for (const subagentSessionId of completedSubagentIds) {
					const parentToolId = agent.codexSubagentParentToolIds.get(subagentSessionId)
						?? buildCodexSubagentParentToolId(subagentSessionId);
					const subToolId = waitMap?.get(subagentSessionId) ?? `${toolId}:${subagentSessionId}`;
					const shouldClear = trackSubagentToolDone(agent, parentToolId, subToolId);
					setTimeout(() => {
						webview?.postMessage({
							type: 'subagentToolDone',
							id: agentId,
							parentToolId,
							toolId: subToolId,
						});
					}, TOOL_DONE_DELAY_MS);
					if (waitMap) {
						waitMap.delete(subagentSessionId);
					}
					if (shouldClear) {
						clearCodexSubagentByParentToolId(agentId, agent, parentToolId, webview);
					}
				}
				if (waitMap && waitMap.size === 0) {
					agent.codexWaitCallMap.delete(toolId);
				}
			}

			finishTool(agentId, agent, toolId, webview);
			return;
		}

		if (payloadType === 'web_search_call') {
			const toolId = `web-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			beginTool(agentId, agent, toolId, 'web_search_call', payload.action, waitingTimers, agents, permissionTimers, webview);
			finishTool(agentId, agent, toolId, webview);
		}
		return;
	}

	if (record.type === 'event_msg') {
		const payload = asRecord(record.payload);
		const eventType = typeof payload.type === 'string' ? payload.type : '';
		if (eventType === 'task_started') {
			cancelWaitingTimer(agentId, waitingTimers);
			clearAgentActivity(agent, agentId, permissionTimers, webview);
			clearAllCodexSubagents(agentId, agent, webview);
			agent.hadToolsInTurn = false;
			agent.isWaiting = false;
			return;
		}
		if (eventType === 'task_complete') {
			markTurnWaiting(agentId, agent, waitingTimers, permissionTimers, webview);
		}
	}
}

function processClaudeTranscriptRecord(
	agentId: number,
	record: Record<string, unknown>,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;

	if (record.type === 'assistant' && Array.isArray((record.message as Record<string, unknown> | undefined)?.content)) {
		const message = record.message as Record<string, unknown>;
		const blocks = message.content as Array<{
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
		} else if (blocks.some(b => b.type === 'text') && !agent.hadToolsInTurn) {
			// Text-only response in a turn that hasn't used any tools.
			// turn_duration handles tool-using turns reliably but is never
			// emitted for text-only turns, so we use a silence-based timer:
			// if no new JSONL data arrives within TEXT_IDLE_DELAY_MS, mark as waiting.
			startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
		}
	} else if (record.type === 'progress') {
		processProgressRecord(agentId, record, agents, waitingTimers, permissionTimers, webview);
	} else if (record.type === 'user') {
		const content = (record.message as Record<string, unknown> | undefined)?.content;
		if (Array.isArray(content)) {
			const blocks = content as Array<{ type: string; tool_use_id?: string }>;
			const hasToolResult = blocks.some(b => b.type === 'tool_result');
			if (hasToolResult) {
				for (const block of blocks) {
					if (block.type === 'tool_result' && block.tool_use_id) {
						finishTool(agentId, agent, block.tool_use_id, webview);
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
		markTurnWaiting(agentId, agent, waitingTimers, permissionTimers, webview);
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
	try {
		const record = JSON.parse(line) as Record<string, unknown>;
		if (agent.provider === 'codex') {
			processCodexTranscriptRecord(agentId, record, agents, waitingTimers, permissionTimers, webview);
			return;
		}
		processClaudeTranscriptRecord(agentId, record, agents, waitingTimers, permissionTimers, webview);
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

	// bash_progress / mcp_progress: tool is actively executing, not stuck on permission.
	// Restart the permission timer to give the running tool another window.
	const dataType = data.type as string | undefined;
	if (dataType === 'bash_progress' || dataType === 'mcp_progress') {
		if (agent.activeToolIds.has(parentToolId)) {
			startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, webview);
		}
		return;
	}

	// Verify parent is an active Task tool (agent_progress handling)
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

				// Track sub-tool IDs
				let subTools = agent.activeSubagentToolIds.get(parentToolId);
				if (!subTools) {
					subTools = new Set();
					agent.activeSubagentToolIds.set(parentToolId, subTools);
				}
				subTools.add(block.id);

				// Track sub-tool names (for permission checking)
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

				// Remove from tracking
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
		// If there are still active non-exempt sub-agent tools, restart the permission timer
		// (handles the case where one sub-agent completes but another is still stuck)
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
