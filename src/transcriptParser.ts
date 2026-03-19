import * as path from 'path';
import type * as vscode from 'vscode';

import {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  PERMISSION_EXEMPT_TOOLS,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
  TEXT_IDLE_DELAY_MS,
  TOOL_DONE_DELAY_MS,
  TOOL_NAMES,
  TOOL_STATUS_TEXT,
} from './constants.js';
import {
  cancelPermissionTimer,
  cancelWaitingTimer,
  clearAgentActivity,
  startPermissionTimer,
  startWaitingTimer,
} from './timerManager.js';
import type { AgentState } from './types.js';

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) + '\u2026' : value;
}

function formatSubtaskStatus(desc?: string): string {
  if (desc && desc.trim()) {
    return `${TOOL_STATUS_TEXT.SUBTASK_PREFIX}${truncateText(
      desc.trim(),
      TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
    )}`;
  }
  return TOOL_STATUS_TEXT.RUNNING_SUBTASK;
}

export function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
  switch (toolName) {
    case TOOL_NAMES.READ:
      return `${TOOL_STATUS_TEXT.READING} ${base(input.file_path)}`;
    case TOOL_NAMES.EDIT:
      return `${TOOL_STATUS_TEXT.EDITING} ${base(input.file_path)}`;
    case TOOL_NAMES.WRITE:
      return `${TOOL_STATUS_TEXT.WRITING} ${base(input.file_path)}`;
    case TOOL_NAMES.BASH: {
      const cmd = asTrimmedString(input.command);
      return `${TOOL_STATUS_TEXT.RUNNING_PREFIX}${truncateText(
        cmd,
        BASH_COMMAND_DISPLAY_MAX_LENGTH,
      )}`;
    }
    case TOOL_NAMES.GLOB:
      return TOOL_STATUS_TEXT.SEARCHING_FILES;
    case TOOL_NAMES.GREP:
      return TOOL_STATUS_TEXT.SEARCHING_CODE;
    case TOOL_NAMES.WEB_FETCH:
      return TOOL_STATUS_TEXT.FETCHING_WEB_CONTENT;
    case TOOL_NAMES.WEB_SEARCH:
      return TOOL_STATUS_TEXT.SEARCHING_THE_WEB;
    case TOOL_NAMES.TASK:
    case TOOL_NAMES.AGENT: {
      const desc = typeof input.description === 'string' ? input.description : undefined;
      return formatSubtaskStatus(desc);
    }
    case TOOL_NAMES.ASK_USER_QUESTION:
    case TOOL_NAMES.REQUEST_USER_INPUT:
      return TOOL_STATUS_TEXT.WAITING_FOR_YOUR_ANSWER;
    case TOOL_NAMES.ENTER_PLAN_MODE:
    case TOOL_NAMES.UPDATE_PLAN:
      return TOOL_STATUS_TEXT.PLANNING;
    case TOOL_NAMES.NOTEBOOK_EDIT:
      return TOOL_STATUS_TEXT.EDITING_NOTEBOOK;
    case TOOL_NAMES.SHELL_COMMAND:
    case TOOL_NAMES.EXEC_COMMAND: {
      const cmd = asTrimmedString(input.command) || asTrimmedString(input.cmd);
      return `${TOOL_STATUS_TEXT.RUNNING_PREFIX}${truncateText(
        cmd,
        BASH_COMMAND_DISPLAY_MAX_LENGTH,
      )}`;
    }
    case TOOL_NAMES.APPLY_PATCH:
      return TOOL_STATUS_TEXT.APPLYING_PATCH;
    case TOOL_NAMES.READ_FILE:
      return `${TOOL_STATUS_TEXT.READING} ${base(input.file_path || input.path)}`;
    case TOOL_NAMES.LIST_DIR:
      return TOOL_STATUS_TEXT.LISTING_DIRECTORY;
    case TOOL_NAMES.WEB_SEARCH_CALL:
      return TOOL_STATUS_TEXT.SEARCHING_THE_WEB;
    case TOOL_NAMES.WRITE_STDIN: {
      const chars = typeof input.chars === 'string' ? input.chars : '';
      return chars.trim()
        ? TOOL_STATUS_TEXT.WRITING_TERMINAL_INPUT
        : TOOL_STATUS_TEXT.READING_TERMINAL_OUTPUT;
    }
    case TOOL_NAMES.WAIT:
      return TOOL_STATUS_TEXT.WAITING_ON_SUBTASK;
    case TOOL_NAMES.SPAWN_AGENT: {
      const desc =
        (typeof input.message === 'string' && input.message) ||
        (typeof input.description === 'string' && input.description) ||
        '';
      return formatSubtaskStatus(desc);
    }
    default:
      return `${TOOL_STATUS_TEXT.USING_PREFIX}${toolName}`;
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
