import * as path from 'path';
import type { AgentState, MessageEmitter } from './types.js';
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
	SUBAGENT_TOOL_NAMES,
	TASK_MGMT_TOOL_NAMES,
} from './constants.js';

export const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'Agent', 'AskUserQuestion', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);

export function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
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
		case 'WebSearch': return 'Searching the web';
		case 'Agent':
		case 'Task': {
			const desc = typeof input.description === 'string' ? input.description : '';
			return desc ? `Subtask: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}` : 'Running subtask';
		}
		case 'TaskCreate': return 'Creating task';
		case 'TaskUpdate': return 'Updating task';
		case 'TaskList': return 'Listing tasks';
		case 'TaskGet': return 'Getting task';
		case 'AskUserQuestion': return 'Waiting for your answer';
		case 'EnterPlanMode': return 'Planning';
		case 'NotebookEdit': return `Editing notebook`;
		default: return `Using ${toolName}`;
	}
}

export function processTranscriptLine(
	agentId: number,
	line: string,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: MessageEmitter | undefined,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;
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
				// Agent is thinking (text output, no tools yet)
				webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'thinking' });
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
							console.log(`[Pixel Agents] Agent ${agentId} tool done: ${block.tool_use_id}`);
							const completedToolId = block.tool_use_id;
							const completedToolName = agent.activeToolNames.get(completedToolId) || '';
							// Parse task management tool results
							if (TASK_MGMT_TOOL_NAMES.has(completedToolName)) {
								parseTaskToolResult(agentId, completedToolName, block, agent, webview);
							}
							// If the completed tool was a Task/Agent, clear its subagent tools
							if (SUBAGENT_TOOL_NAMES.has(completedToolName)) {
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
					// All tools completed — allow text-idle timer as fallback
					// for turn-end detection when turn_duration is not emitted
					if (agent.activeToolIds.size === 0) {
						agent.hadToolsInTurn = false;
					}
				} else {
					// New user text prompt — new turn starting
					cancelWaitingTimer(agentId, waitingTimers);
					clearAgentActivity(agent, agentId, permissionTimers, webview);
					agent.hadToolsInTurn = false;
				}
			} else if (typeof content === 'string' && content.trim()) {
				// New user text prompt — new turn starting
				cancelWaitingTimer(agentId, waitingTimers);
				clearAgentActivity(agent, agentId, permissionTimers, webview);
				agent.hadToolsInTurn = false;
			}
		} else if (record.type === 'system' && record.subtype === 'turn_duration') {
			cancelWaitingTimer(agentId, waitingTimers);
			cancelPermissionTimer(agentId, permissionTimers);

			// Definitive turn-end: clean up any stale tool state
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
	webview: MessageEmitter | undefined,
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

	// Verify parent is an active Task/Agent tool (agent_progress handling)
	if (!SUBAGENT_TOOL_NAMES.has(agent.activeToolNames.get(parentToolId) || '')) return;

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
				}, 300);
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

function sendTaskUpdate(agentId: number, agent: AgentState, webview: MessageEmitter | undefined): void {
	const tasks = Array.from(agent.tasks.values());
	webview?.postMessage({ type: 'agentTaskUpdate', id: agentId, tasks });
}

function parseTaskToolResult(
	agentId: number,
	toolName: string,
	block: Record<string, unknown>,
	agent: AgentState,
	webview: MessageEmitter | undefined,
): void {
	// Extract text content from the tool_result block
	const content = block.content;
	let text = '';
	if (typeof content === 'string') {
		text = content;
	} else if (Array.isArray(content)) {
		for (const part of content) {
			if (typeof part === 'object' && part !== null && (part as Record<string, unknown>).type === 'text') {
				text += (part as Record<string, unknown>).text || '';
			}
		}
	}
	if (!text) return;

	try {
		if (toolName === 'TaskList') {
			// TaskList is authoritative — replace full task state
			// Parse the structured output to extract task entries
			const taskLines = text.split('\n').filter(l => l.trim());
			const newTasks = new Map<string, { taskId: string; subject: string; status: string }>();
			for (const line of taskLines) {
				// Match patterns like "- [id] subject (status)" or structured JSON
				const match = line.match(/(?:^|\s)(\d+)\.\s+(.+?)\s*\((\w+)\)\s*$/);
				if (match) {
					newTasks.set(match[1], { taskId: match[1], subject: match[2].trim(), status: match[3] });
					continue;
				}
				// Try JSON parsing for structured results
				try {
					const parsed = JSON.parse(line);
					if (parsed.id && parsed.subject) {
						const id = String(parsed.id);
						newTasks.set(id, { taskId: id, subject: parsed.subject, status: parsed.status || 'pending' });
					}
				} catch { /* not JSON, skip */ }
			}
			// Also try parsing the entire text as JSON (array of tasks)
			try {
				const parsed = JSON.parse(text);
				if (Array.isArray(parsed)) {
					for (const item of parsed) {
						if (item.id && item.subject) {
							const id = String(item.id);
							newTasks.set(id, { taskId: id, subject: item.subject, status: item.status || 'pending' });
						}
					}
				}
			} catch { /* not JSON array */ }
			if (newTasks.size > 0) {
				agent.tasks = newTasks;
				sendTaskUpdate(agentId, agent, webview);
			}
		} else if (toolName === 'TaskCreate') {
			// Extract task from creation result
			try {
				const parsed = JSON.parse(text);
				if (parsed.id && parsed.subject) {
					const id = String(parsed.id);
					agent.tasks.set(id, { taskId: id, subject: parsed.subject, status: parsed.status || 'pending' });
					sendTaskUpdate(agentId, agent, webview);
				}
			} catch {
				// Try to extract from text format: "Created task 1: subject"
				const match = text.match(/(?:Created|Added)\s+task\s+(\d+):\s+(.+)/i);
				if (match) {
					agent.tasks.set(match[1], { taskId: match[1], subject: match[2].trim(), status: 'pending' });
					sendTaskUpdate(agentId, agent, webview);
				}
			}
		} else if (toolName === 'TaskUpdate') {
			// Extract updated task info
			try {
				const parsed = JSON.parse(text);
				if (parsed.id) {
					const id = String(parsed.id);
					const existing = agent.tasks.get(id);
					if (existing) {
						if (parsed.status) existing.status = parsed.status;
						if (parsed.subject) existing.subject = parsed.subject;
						sendTaskUpdate(agentId, agent, webview);
					} else if (parsed.subject) {
						agent.tasks.set(id, { taskId: id, subject: parsed.subject, status: parsed.status || 'pending' });
						sendTaskUpdate(agentId, agent, webview);
					}
				}
			} catch {
				// Try text format: "Updated task 1 status to completed"
				const match = text.match(/(?:Updated|Changed)\s+task\s+(\d+)\s+.*?(?:status\s+to\s+)?(\w+)/i);
				if (match) {
					const existing = agent.tasks.get(match[1]);
					if (existing) {
						existing.status = match[2];
						sendTaskUpdate(agentId, agent, webview);
					}
				}
			}
		} else if (toolName === 'TaskGet') {
			// TaskGet returns a single task — update if we already track it
			try {
				const parsed = JSON.parse(text);
				if (parsed.id && parsed.subject) {
					const id = String(parsed.id);
					agent.tasks.set(id, { taskId: id, subject: parsed.subject, status: parsed.status || 'pending' });
					sendTaskUpdate(agentId, agent, webview);
				}
			} catch { /* ignore */ }
		}
	} catch {
		// Ignore parsing errors
	}
}
