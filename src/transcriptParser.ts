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
import type { AgentState, ToolActivityPayload } from './types.js';

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

export interface ToolStatusDetails {
  text: string;
  target?: string;
  command?: string;
}

export function formatToolStatus(
  toolName: string,
  input: Record<string, unknown>,
): ToolStatusDetails {
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
  switch (toolName) {
    case TOOL_NAMES.READ:
      return {
        text: `${TOOL_STATUS_TEXT.READING} ${base(input.file_path)}`,
        target: base(input.file_path),
      };
    case TOOL_NAMES.EDIT:
      return {
        text: `${TOOL_STATUS_TEXT.EDITING} ${base(input.file_path)}`,
        target: base(input.file_path),
      };
    case TOOL_NAMES.WRITE:
      return {
        text: `${TOOL_STATUS_TEXT.WRITING} ${base(input.file_path)}`,
        target: base(input.file_path),
      };
    case TOOL_NAMES.BASH: {
      const cmd = asTrimmedString(input.command);
      return {
        text: `${TOOL_STATUS_TEXT.RUNNING_PREFIX}${truncateText(
          cmd,
          BASH_COMMAND_DISPLAY_MAX_LENGTH,
        )}`,
        command: cmd,
      };
    }
    case TOOL_NAMES.GLOB:
      return { text: TOOL_STATUS_TEXT.SEARCHING_FILES };
    case TOOL_NAMES.GREP:
      return { text: TOOL_STATUS_TEXT.SEARCHING_CODE };
    case TOOL_NAMES.WEB_FETCH:
      return { text: TOOL_STATUS_TEXT.FETCHING_WEB_CONTENT };
    case TOOL_NAMES.WEB_SEARCH:
      return { text: TOOL_STATUS_TEXT.SEARCHING_THE_WEB };
    case TOOL_NAMES.TASK:
    case TOOL_NAMES.AGENT: {
      const desc = typeof input.description === 'string' ? input.description : undefined;
      return { text: formatSubtaskStatus(desc) };
    }
    case TOOL_NAMES.ASK_USER_QUESTION:
    case TOOL_NAMES.REQUEST_USER_INPUT:
      return { text: TOOL_STATUS_TEXT.WAITING_FOR_YOUR_ANSWER };
    case TOOL_NAMES.ENTER_PLAN_MODE:
    case TOOL_NAMES.UPDATE_PLAN:
      return { text: TOOL_STATUS_TEXT.PLANNING };
    case TOOL_NAMES.NOTEBOOK_EDIT:
      return { text: TOOL_STATUS_TEXT.EDITING_NOTEBOOK };
    case TOOL_NAMES.SHELL_COMMAND:
    case TOOL_NAMES.EXEC_COMMAND: {
      const cmd = asTrimmedString(input.command) || asTrimmedString(input.cmd);
      return {
        text: `${TOOL_STATUS_TEXT.RUNNING_PREFIX}${truncateText(
          cmd,
          BASH_COMMAND_DISPLAY_MAX_LENGTH,
        )}`,
        command: cmd,
      };
    }
    case TOOL_NAMES.APPLY_PATCH:
      return { text: TOOL_STATUS_TEXT.APPLYING_PATCH };
    case TOOL_NAMES.READ_FILE:
      return {
        text: `${TOOL_STATUS_TEXT.READING} ${base(input.file_path || input.path)}`,
        target: base(input.file_path || input.path),
      };
    case TOOL_NAMES.LIST_DIR:
      return { text: TOOL_STATUS_TEXT.LISTING_DIRECTORY };
    case TOOL_NAMES.WEB_SEARCH_CALL:
      return { text: TOOL_STATUS_TEXT.SEARCHING_THE_WEB };
    case TOOL_NAMES.WRITE_STDIN: {
      const chars = typeof input.chars === 'string' ? input.chars : '';
      return {
        text: chars.trim()
          ? TOOL_STATUS_TEXT.WRITING_TERMINAL_INPUT
          : TOOL_STATUS_TEXT.READING_TERMINAL_OUTPUT,
      };
    }
    case TOOL_NAMES.WAIT:
      return { text: TOOL_STATUS_TEXT.WAITING_ON_SUBTASK };
    case TOOL_NAMES.SPAWN_AGENT: {
      const desc =
        (typeof input.message === 'string' && input.message) ||
        (typeof input.description === 'string' && input.description) ||
        '';
      return { text: formatSubtaskStatus(desc) };
    }
    default:
      return { text: `${TOOL_STATUS_TEXT.USING_PREFIX}${toolName}` };
  }
}

function createToolActivity(
  toolId: string,
  toolName: string,
  statusInfo: ToolStatusDetails,
  parentToolId?: string,
): ToolActivityPayload {
  return {
    toolId,
    toolName,
    statusText: statusInfo.text,
    target: statusInfo.target,
    command: statusInfo.command,
    startTime: Date.now(),
    confidence: 'high',
    parentToolId,
    source: 'transcript',
    permissionState: 'none',
    inferred: false,
  };
}

function finalizeToolActivity(activity?: ToolActivityPayload): ToolActivityPayload | undefined {
  if (!activity) return undefined;
  return { ...activity, durationMs: Date.now() - activity.startTime };
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

      const statusInfo = formatToolStatus(toolName, input);
      const status = statusInfo.text;
      cancelWaitingTimer(agentId, waitingTimers);
      agent.isWaiting = false;
      agent.hadToolsInTurn = true;
      webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });

      console.log(`[Pixel Agents] Agent ${agentId} tool start: ${toolId} ${status}`);
      agent.activeToolIds.add(toolId);
      agent.activeToolStatuses.set(toolId, status);
      agent.activeToolNames.set(toolId, toolName);
      agent.activeToolActivities.set(toolId, createToolActivity(toolId, toolName, statusInfo));

      if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
        startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, webview);
      }
      webview?.postMessage({
        type: 'agentToolStart',
        id: agentId,
        toolId,
        status,
        activity: agent.activeToolActivities.get(toolId),
      });
      return;
    }

    if (record.type === 'response_item' && record.payload?.type === 'function_call_output') {
      const toolId = record.payload.call_id;
      const completedToolName = agent.activeToolNames.get(toolId);
      const toolActivity = agent.activeToolActivities.get(toolId);
      if (toolActivity) {
        agent.activeToolActivities.delete(toolId);
      }
      const snapshot = toolActivity ? { ...toolActivity } : undefined;
      console.log(`[Pixel Agents] Agent ${agentId} tool done: ${toolId}`);
      agent.activeToolIds.delete(toolId);
      agent.activeToolStatuses.delete(toolId);
      agent.activeToolNames.delete(toolId);
      setTimeout(() => {
        webview?.postMessage({
          type: 'agentToolDone',
          id: agentId,
          toolId,
          activity: finalizeToolActivity(snapshot),
        });
        if (completedToolName === TOOL_NAMES.SPAWN_AGENT) {
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
            const statusInfo = formatToolStatus(toolName, block.input || {});
            const status = statusInfo.text;
            console.log(`[Pixel Agents] Agent ${agentId} tool start: ${block.id} ${status}`);
            agent.activeToolIds.add(block.id);
            agent.activeToolStatuses.set(block.id, status);
            agent.activeToolNames.set(block.id, toolName);
            agent.activeToolActivities.set(
              block.id,
              createToolActivity(block.id, toolName, statusInfo),
            );
            if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
              hasNonExemptTool = true;
            }
            webview?.postMessage({
              type: 'agentToolStart',
              id: agentId,
              toolId: block.id,
              status,
              activity: agent.activeToolActivities.get(block.id),
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
                agent.activeSubagentToolActivities.delete(completedToolId);
                webview?.postMessage({
                  type: 'subagentClear',
                  id: agentId,
                  parentToolId: completedToolId,
                });
              }
              const toolActivity = agent.activeToolActivities.get(completedToolId);
              if (toolActivity) {
                agent.activeToolActivities.delete(completedToolId);
              }
              agent.activeToolIds.delete(completedToolId);
              agent.activeToolStatuses.delete(completedToolId);
              agent.activeToolNames.delete(completedToolId);
              const toolId = completedToolId;
              const snapshot = toolActivity ? { ...toolActivity } : undefined;
              setTimeout(() => {
                webview?.postMessage({
                  type: 'agentToolDone',
                  id: agentId,
                  toolId,
                  activity: finalizeToolActivity(snapshot),
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
        agent.activeToolActivities.clear();
        agent.activeSubagentToolIds.clear();
        agent.activeSubagentToolNames.clear();
        agent.activeSubagentToolActivities.clear();
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
        const statusInfo = formatToolStatus(toolName, block.input || {});
        const status = statusInfo.text;
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

        let subActivities = agent.activeSubagentToolActivities.get(parentToolId);
        if (!subActivities) {
          subActivities = new Map();
          agent.activeSubagentToolActivities.set(parentToolId, subActivities);
        }
        const subActivity = createToolActivity(block.id, toolName, statusInfo, parentToolId);
        subActivities.set(block.id, subActivity);

        if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
          hasNonExemptSubTool = true;
        }

        webview?.postMessage({
          type: 'subagentToolStart',
          id: agentId,
          parentToolId,
          toolId: block.id,
          status,
          activity: subActivity,
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
        const subActivities = agent.activeSubagentToolActivities.get(parentToolId);
        const subActivity = subActivities?.get(block.tool_use_id);
        if (subActivities && subActivities.delete(block.tool_use_id) && subActivities.size === 0) {
          agent.activeSubagentToolActivities.delete(parentToolId);
        }

        const toolId = block.tool_use_id;
        const snapshot = subActivity ? { ...subActivity } : undefined;
        setTimeout(() => {
          webview?.postMessage({
            type: 'subagentToolDone',
            id: agentId,
            parentToolId,
            toolId,
            activity: finalizeToolActivity(snapshot),
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
