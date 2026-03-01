/**
 * Opencode transcript parser.
 *
 * Opencode is an open-source AI coding assistant that can work with multiple
 * LLM providers. This parser handles its JSONL session transcript format.
 *
 * Opencode may store session data in different formats depending on version,
 * so this parser is designed to be lenient and handle multiple variants:
 *
 * 1. If Opencode produces Claude-compatible JSONL (assistant/user/system records),
 *    we delegate to the standard Claude Code parser for those records.
 * 2. For Opencode-specific record formats, we translate them to the standard
 *    agent events (tool start/done, status changes).
 *
 * Supported Opencode JSONL record types:
 * - { role: "assistant", content: [...] } — assistant messages with tool calls
 * - { role: "user", content: [...] } — user messages / tool results
 * - { type: "tool_call", name: "...", id: "...", arguments: {...} } — tool invocations
 * - { type: "tool_result", id: "...", output: "..." } — tool completions
 * - { type: "status", status: "thinking"|"idle"|"error" } — status changes
 * - { type: "event", event: "turn_end" } — turn boundaries
 */

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
import { processTranscriptLine, PERMISSION_EXEMPT_TOOLS } from './transcriptParser.js';

/**
 * Format a tool status string for Opencode tools.
 * Maps Opencode tool names to human-readable status strings.
 */
function formatOpencodeToolStatus(toolName: string, args: Record<string, unknown>): string {
	const base = (p: unknown) => typeof p === 'string' ? path.basename(p) : '';
	const normalized = toolName.toLowerCase();

	// Map common Opencode tool names to statuses
	if (normalized.includes('read') || normalized.includes('file_read')) {
		return `Reading ${base(args.path || args.file_path || args.file)}`;
	}
	if (normalized.includes('write') || normalized.includes('file_write')) {
		return `Writing ${base(args.path || args.file_path || args.file)}`;
	}
	if (normalized.includes('edit') || normalized.includes('patch') || normalized.includes('file_edit')) {
		return `Editing ${base(args.path || args.file_path || args.file)}`;
	}
	if (normalized.includes('bash') || normalized.includes('shell') || normalized.includes('exec') || normalized.includes('command')) {
		const cmd = (args.command as string) || (args.cmd as string) || '';
		return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
	}
	if (normalized.includes('search') || normalized.includes('grep') || normalized.includes('find')) {
		return 'Searching code';
	}
	if (normalized.includes('glob') || normalized.includes('list') || normalized.includes('ls')) {
		return 'Searching files';
	}
	if (normalized.includes('web') || normalized.includes('fetch') || normalized.includes('http')) {
		return 'Fetching web content';
	}
	if (normalized.includes('task') || normalized.includes('subtask') || normalized.includes('agent')) {
		const desc = typeof args.description === 'string' ? args.description : '';
		return desc ? `Subtask: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}` : 'Running subtask';
	}
	return `Using ${toolName}`;
}

/**
 * Process a single JSONL transcript line from an Opencode session.
 */
export function processOpencodeTranscriptLine(
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
		const record = JSON.parse(line);

		// ── Format 1: Claude-compatible records (type: assistant/user/system) ──
		// If the record looks like Claude Code format, delegate to the standard parser.
		if (record.type === 'assistant' || record.type === 'user' || record.type === 'system' || record.type === 'progress') {
			processTranscriptLine(agentId, line, agents, waitingTimers, permissionTimers, webview);
			return;
		}

		// ── Format 2: Role-based records (role: assistant/user) ──
		if (record.role === 'assistant') {
			const content = record.content;
			if (Array.isArray(content)) {
				const hasToolCall = content.some((b: Record<string, unknown>) =>
					b.type === 'tool_use' || b.type === 'tool_call' || b.type === 'function_call'
				);

				if (hasToolCall) {
					cancelWaitingTimer(agentId, waitingTimers);
					agent.isWaiting = false;
					agent.hadToolsInTurn = true;
					webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });

					let hasNonExemptTool = false;
					for (const block of content) {
						const blockType = block.type as string;
						if ((blockType === 'tool_use' || blockType === 'tool_call' || blockType === 'function_call') && (block.id || block.call_id)) {
							const toolId = (block.id || block.call_id) as string;
							const toolName = (block.name || block.function?.name || '') as string;
							const input = (block.input || block.arguments || block.function?.arguments || {}) as Record<string, unknown>;
							const status = formatOpencodeToolStatus(toolName, input);

							agent.activeToolIds.add(toolId);
							agent.activeToolStatuses.set(toolId, status);
							agent.activeToolNames.set(toolId, toolName);

							if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
								hasNonExemptTool = true;
							}

							webview?.postMessage({
								type: 'agentToolStart',
								id: agentId,
								toolId,
								status,
							});
						}
					}
					if (hasNonExemptTool) {
						startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, webview);
					}
				} else if (content.some((b: Record<string, unknown>) => b.type === 'text') && !agent.hadToolsInTurn) {
					startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
				}
			} else if (typeof content === 'string' && !agent.hadToolsInTurn) {
				// Plain text assistant response
				startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
			}
			return;
		}

		if (record.role === 'user') {
			const content = record.content;
			if (Array.isArray(content)) {
				const hasToolResult = content.some((b: Record<string, unknown>) =>
					b.type === 'tool_result' || b.type === 'function_result'
				);
				if (hasToolResult) {
					for (const block of content) {
						const resultId = (block.tool_use_id || block.call_id || block.id) as string | undefined;
						if ((block.type === 'tool_result' || block.type === 'function_result') && resultId) {
							agent.activeToolIds.delete(resultId);
							agent.activeToolStatuses.delete(resultId);
							agent.activeToolNames.delete(resultId);

							const toolId = resultId;
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
					// New user message — new turn
					cancelWaitingTimer(agentId, waitingTimers);
					clearAgentActivity(agent, agentId, permissionTimers, webview);
					agent.hadToolsInTurn = false;
				}
			} else if (typeof content === 'string' && content.trim()) {
				cancelWaitingTimer(agentId, waitingTimers);
				clearAgentActivity(agent, agentId, permissionTimers, webview);
				agent.hadToolsInTurn = false;
			}
			return;
		}

		// ── Format 3: Standalone tool_call / tool_result records ──
		if (record.type === 'tool_call' && (record.id || record.call_id)) {
			cancelWaitingTimer(agentId, waitingTimers);
			agent.isWaiting = false;
			agent.hadToolsInTurn = true;
			webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });

			const toolId = (record.id || record.call_id) as string;
			const toolName = (record.name || record.function || '') as string;
			const input = (record.arguments || record.input || {}) as Record<string, unknown>;
			const status = formatOpencodeToolStatus(toolName, input);

			agent.activeToolIds.add(toolId);
			agent.activeToolStatuses.set(toolId, status);
			agent.activeToolNames.set(toolId, toolName);

			webview?.postMessage({ type: 'agentToolStart', id: agentId, toolId, status });
			startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, webview);
			return;
		}

		if (record.type === 'tool_result' && (record.id || record.tool_use_id || record.call_id)) {
			const toolId = (record.id || record.tool_use_id || record.call_id) as string;
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

		// ── Format 4: Status / event records ──
		if (record.type === 'status') {
			const status = record.status as string;
			if (status === 'idle' || status === 'done' || status === 'waiting') {
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
				agent.hadToolsInTurn = false;
				webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
			} else if (status === 'thinking' || status === 'running' || status === 'active') {
				agent.isWaiting = false;
				webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
			}
			return;
		}

		if (record.type === 'event') {
			if (record.event === 'turn_end' || record.event === 'turn_complete') {
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
				agent.hadToolsInTurn = false;
				webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
			}
			return;
		}

	} catch {
		// Ignore malformed lines
	}
}
