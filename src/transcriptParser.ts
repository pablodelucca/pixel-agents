import * as path from 'path';
import type * as vscode from 'vscode';

import {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
  TEXT_IDLE_DELAY_MS,
  TOOL_DONE_DELAY_MS,
} from './constants.js';
import {
  cancelPermissionTimer,
  cancelWaitingTimer,
  clearAgentActivity,
  startPermissionTimer,
  startWaitingTimer,
} from './timerManager.js';
import type { AgentState } from './types.js';

export const PERMISSION_EXEMPT_TOOLS = new Set([
  'Task',
  'Agent',
  'AskUserQuestion',
  'request_user_input',
  'spawn_agent',
  'wait',
]);

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) + '\u2026' : value;
}

export function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
  switch (toolName) {
    case 'Read':
      return `Reading ${base(input.file_path)}`;
    case 'Edit':
      return `Editing ${base(input.file_path)}`;
    case 'Write':
      return `Writing ${base(input.file_path)}`;
    case 'Bash': {
      const cmd = ((input.command as string) || '').trim();
      return `Running: ${truncateText(cmd, BASH_COMMAND_DISPLAY_MAX_LENGTH)}`;
    }
    case 'Glob':
      return 'Searching files';
    case 'Grep':
      return 'Searching code';
    case 'WebFetch':
      return 'Fetching web content';
    case 'WebSearch':
      return 'Searching the web';
    case 'Task':
    case 'Agent':
    case 'spawn_agent': {
      const desc =
        (typeof input.message === 'string' && input.message) ||
        (typeof input.description === 'string' && input.description) ||
        '';
      return desc
        ? `Subtask: ${truncateText(desc, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH)}`
        : 'Running subtask';
    }
    case 'AskUserQuestion':
      return 'Waiting for your answer';
    case 'EnterPlanMode':
    case 'update_plan':
      return 'Planning';
    case 'NotebookEdit':
      return 'Editing notebook';
    case 'shell_command':
    case 'exec_command': {
      const cmd = ((input.command as string) || (input.cmd as string) || '').trim();
      return `Running: ${truncateText(cmd, BASH_COMMAND_DISPLAY_MAX_LENGTH)}`;
    }
    case 'apply_patch':
      return 'Applying patch';
    case 'read_file':
      return `Reading ${base(input.file_path || input.path)}`;
    case 'list_dir':
      return 'Listing directory';
    case 'web_search_call':
      return 'Searching the web';
    case 'request_user_input':
      return 'Waiting for your answer';
    case 'write_stdin': {
      const chars = typeof input.chars === 'string' ? input.chars : '';
      return chars.trim() ? 'Writing terminal input' : 'Reading terminal output';
    }
    case 'wait':
      return 'Waiting on subtask';
    default:
      return `Using ${toolName}`;
  }
}

export function processCodexTranscriptLine(
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

    if (record.type === 'response_item' && record.payload?.type === 'function_call') {
      const toolName = record.payload.name || '';
      const toolId = record.payload.call_id;
      let input: Record<string, unknown> = {};
      try {
        input =
          typeof record.payload.arguments === 'string'
            ? JSON.parse(record.payload.arguments)
            : record.payload.arguments || {};
      } catch {
        /* ignore */
      }

      const status = formatToolStatus(toolName, input);
      cancelWaitingTimer(agentId, waitingTimers);
      agent.isWaiting = false;
      agent.hadToolsInTurn = true;
      webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });

      console.log(`[Pixel Agents] Agent ${agentId} tool start: ${toolId} ${status}`);
      agent.activeToolIds.add(toolId);
      agent.activeToolStatuses.set(toolId, status);
      agent.activeToolNames.set(toolId, toolName);

      if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
        startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, webview);
      }
      webview?.postMessage({ type: 'agentToolStart', id: agentId, toolId, status });
      return;
    }

    if (record.type === 'response_item' && record.payload?.type === 'function_call_output') {
      const toolId = record.payload.call_id;
      const completedToolName = agent.activeToolNames.get(toolId);
      console.log(`[Pixel Agents] Agent ${agentId} tool done: ${toolId}`);
      agent.activeToolIds.delete(toolId);
      agent.activeToolStatuses.delete(toolId);
      agent.activeToolNames.delete(toolId);
      setTimeout(() => {
        webview?.postMessage({ type: 'agentToolDone', id: agentId, toolId });
        if (completedToolName === 'spawn_agent') {
          webview?.postMessage({
            type: 'subagentClear',
            id: agentId,
            parentToolId: toolId,
          });
        }
      }, TOOL_DONE_DELAY_MS);
      if (agent.activeToolIds.size === 0) {
        agent.hadToolsInTurn = false;
      }
      return;
    }

    if (record.type === 'event_msg' && record.payload?.type === 'agent_message') {
      cancelWaitingTimer(agentId, waitingTimers);
      cancelPermissionTimer(agentId, permissionTimers);
      startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
    }
  } catch {
    // Ignore malformed lines
  }
}

export function processClaudeTranscriptLine(
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

    if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
      const blocks = record.message.content as Array<{
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
      const content = record.message?.content;
      if (Array.isArray(content)) {
        const blocks = content as Array<{ type: string; tool_use_id?: string }>;
        const hasToolResult = blocks.some((b) => b.type === 'tool_result');
        if (hasToolResult) {
          for (const block of blocks) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              console.log(`[Pixel Agents] Agent ${agentId} tool done: ${block.tool_use_id}`);
              const completedToolId = block.tool_use_id;
              const completedToolName = agent.activeToolNames.get(completedToolId);
              if (completedToolName === 'Task' || completedToolName === 'Agent') {
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

  const parentToolName = agent.activeToolNames.get(parentToolId);
  if (parentToolName !== 'Task' && parentToolName !== 'Agent') return;

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
        console.log(
          `[Pixel Agents] Agent ${agentId} subagent tool start: ${block.id} ${status} (parent: ${parentToolId})`,
        );

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
        console.log(
          `[Pixel Agents] Agent ${agentId} subagent tool done: ${block.tool_use_id} (parent: ${parentToolId})`,
        );

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
