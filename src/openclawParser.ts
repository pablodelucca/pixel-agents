import * as path from 'path';

import {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
} from './constants.js';
import type { OpenClawAgentState, OpenClawContentBlock,OpenClawRecord } from './openclawTypes.js';

// Tools that don't require permission bubbles
export const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'Agent', 'AskUserQuestion']);

/**
 * Format tool status for display
 */
export function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');

  switch (toolName) {
    case 'read':
    case 'Read':
      return `Reading ${base(input.file_path || input.path)}`;
    case 'edit':
    case 'Edit':
      return `Editing ${base(input.file_path || input.path)}`;
    case 'write':
    case 'Write':
      return `Writing ${base(input.file_path || input.path)}`;
    case 'bash':
    case 'Bash': {
      const cmd = (input.command as string) || '';
      return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
    }
    case 'glob':
    case 'Glob':
      return 'Searching files';
    case 'grep':
    case 'Grep':
      return 'Searching code';
    case 'web_fetch':
    case 'WebFetch':
      return 'Fetching web content';
    case 'web_search':
    case 'WebSearch':
      return 'Searching the web';
    case 'browser':
      return 'Browsing web';
    case 'Task':
    case 'Agent': {
      const desc = typeof input.description === 'string' ? input.description : '';
      return desc
        ? `Subtask: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}`
        : 'Running subtask';
    }
    case 'AskUserQuestion':
      return 'Waiting for your answer';
    default:
      return `Using ${toolName}`;
  }
}

/**
 * Process a single JSONL line from OpenClaw session
 */
export function processOpenClawLine(
  agentId: number,
  line: string,
  agents: Map<number, OpenClawAgentState>,
  webview: { postMessage: (msg: unknown) => void } | undefined,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  try {
    const record = JSON.parse(line) as Record<string, unknown>;

    if (record.type === 'message') {
      // Check if it's a tool result
      if ('role' in record && record.role === 'toolResult') {
        handleToolResult(
          agentId,
          record as { toolCallId?: string; toolName?: string; isError?: boolean },
          agent,
          webview,
        );
      } else {
        const msg = record.message as Record<string, unknown> | undefined;
        if (msg?.role === 'assistant' && Array.isArray(msg.content)) {
          handleAssistantMessage(agentId, msg.content as OpenClawContentBlock[], agent, webview);
        } else if (msg?.role === 'user' && Array.isArray(msg.content)) {
          handleUserMessage(agentId, msg.content as OpenClawContentBlock[], agent, webview);
        }
      }
    }
  } catch {
    // Ignore malformed lines
  }
}

function handleAssistantMessage(
  agentId: number,
  content: OpenClawContentBlock[],
  agent: OpenClawAgentState,
  webview: { postMessage: (msg: unknown) => void } | undefined,
): void {
  const toolCalls = content.filter((b) => b.type === 'toolCall');

  if (toolCalls.length > 0) {
    agent.isWaiting = false;
    webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });

    for (const block of toolCalls) {
      if (block.type === 'toolCall' && block.id) {
        const toolName = block.name || '';
        const status = formatToolStatus(toolName, block.arguments || {});
        console.log(`[Pixel Agents] OpenClaw agent ${agentId} tool start: ${block.id} ${status}`);

        agent.activeToolIds.add(block.id);
        agent.activeToolStatuses.set(block.id, status);
        agent.activeToolNames.set(block.id, toolName);

        webview?.postMessage({
          type: 'agentToolStart',
          id: agentId,
          toolId: block.id,
          status,
        });
      }
    }
  } else if (content.some((b) => b.type === 'text')) {
    // Text-only response
    agent.isWaiting = true;
    webview?.postMessage({
      type: 'agentStatus',
      id: agentId,
      status: 'waiting',
    });
  }
}

function handleToolResult(
  agentId: number,
  record: { toolCallId?: string; toolName?: string; isError?: boolean },
  agent: OpenClawAgentState,
  webview: { postMessage: (msg: unknown) => void } | undefined,
): void {
  const toolId = record.toolCallId;
  if (!toolId) return;

  console.log(`[Pixel Agents] OpenClaw agent ${agentId} tool done: ${toolId}`);

  agent.activeToolIds.delete(toolId);
  agent.activeToolStatuses.delete(toolId);
  agent.activeToolNames.delete(toolId);

  // Delay to prevent flicker
  setTimeout(() => {
    webview?.postMessage({
      type: 'agentToolDone',
      id: agentId,
      toolId,
    });
  }, 300);

  // If all tools done, mark as waiting
  if (agent.activeToolIds.size === 0) {
    agent.isWaiting = true;
    webview?.postMessage({
      type: 'agentStatus',
      id: agentId,
      status: 'waiting',
    });
  }
}

function handleUserMessage(
  agentId: number,
  content: OpenClawContentBlock[],
  agent: OpenClawAgentState,
  webview: { postMessage: (msg: unknown) => void } | undefined,
): void {
  // New user message = new turn, clear all tool state
  if (agent.activeToolIds.size > 0) {
    agent.activeToolIds.clear();
    agent.activeToolStatuses.clear();
    agent.activeToolNames.clear();
    webview?.postMessage({ type: 'agentToolsClear', id: agentId });
  }

  agent.isWaiting = false;
  webview?.postMessage({
    type: 'agentStatus',
    id: agentId,
    status: 'active',
  });
}
