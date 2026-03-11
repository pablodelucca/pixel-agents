import * as path from 'path';
import type * as vscode from 'vscode';

import {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  COPILOT_TURN_END_DELAY_MS,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
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

export const COPILOT_PERMISSION_EXEMPT_TOOLS = new Set(['task', 'ask_user', 'report_intent']);

function formatCopilotToolStatus(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
  switch (toolName) {
    case 'view':
      return `Reading ${base(input.path)}`;
    case 'edit':
      return `Editing ${base(input.path)}`;
    case 'create':
      return `Writing ${base(input.path)}`;
    case 'powershell': {
      const cmd = (input.command as string) || '';
      return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
    }
    case 'glob':
      return 'Searching files';
    case 'grep':
      return 'Searching code';
    case 'web_fetch':
      return 'Fetching web content';
    case 'task': {
      const desc = typeof input.description === 'string' ? input.description : '';
      return desc
        ? `Subtask: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}`
        : 'Running subtask';
    }
    case 'explore':
      return 'Exploring';
    case 'ask_user':
      return 'Waiting for your answer';
    case 'exit_plan_mode':
      return 'Planning';
    case 'store_memory':
      return 'Saving memory';
    case 'sql':
      return 'Querying database';
    case 'task_complete':
      return 'Completing task';
    case 'ide-get_diagnostics':
      return 'Getting diagnostics';
    case 'ide-get_selection':
      return 'Getting selection';
    default:
      if (toolName.startsWith('github-mcp-server')) return 'Using GitHub API';
      return `Using ${toolName}`;
  }
}

export function processCopilotTranscriptLine(
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
    const eventType = record.type as string;
    const data = (record.data ?? {}) as Record<string, unknown>;

    // Synthesize explore tool events if Copilot reports explore mode but emits no tool event
    if (
      eventType === 'assistant.turn_start' &&
      !agent.isWaiting &&
      !agent.hadToolsInTurn &&
      (data['mode'] === 'explore' || data['toolName'] === 'explore')
    ) {
      webview?.postMessage({
        type: 'agentToolStart',
        id: agentId,
        toolId: 'explore_synth',
        status: 'Exploring',
      });
      agent.activeToolIds.add('explore_synth');
      agent.activeToolStatuses.set('explore_synth', 'Exploring');
      agent.activeToolNames.set('explore_synth', 'explore');
      agent.hadToolsInTurn = true;
    }

    switch (eventType) {
      case 'user.message': {
        cancelWaitingTimer(agentId, waitingTimers);
        clearAgentActivity(agent, agentId, permissionTimers, webview);
        agent.hadToolsInTurn = false;
        break;
      }

      case 'assistant.turn_start': {
        cancelWaitingTimer(agentId, waitingTimers);
        agent.isWaiting = false;
        webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
        break;
      }

      case 'assistant.turn_end': {
        // Resolve synthesized explore tool before clearing
        if (agent.activeToolIds.has('explore_synth')) {
          agent.activeToolIds.delete('explore_synth');
          agent.activeToolStatuses.delete('explore_synth');
          agent.activeToolNames.delete('explore_synth');
          setTimeout(() => {
            webview?.postMessage({
              type: 'agentToolDone',
              id: agentId,
              toolId: 'explore_synth',
            });
          }, TOOL_DONE_DELAY_MS);
        }
        cancelPermissionTimer(agentId, permissionTimers);
        startWaitingTimer(agentId, COPILOT_TURN_END_DELAY_MS, agents, waitingTimers, webview);
        if (agent.activeToolIds.size > 0) {
          agent.activeToolIds.clear();
          agent.activeToolStatuses.clear();
          agent.activeToolNames.clear();
          agent.activeSubagentToolIds.clear();
          agent.activeSubagentToolNames.clear();
          webview?.postMessage({ type: 'agentToolsClear', id: agentId });
        }
        agent.hadToolsInTurn = false;
        break;
      }

      case 'tool.execution_start': {
        const toolCallId = data.toolCallId as string | undefined;
        const toolName = (data.toolName as string) || '';
        const toolInput = (data.arguments as Record<string, unknown>) || {};
        const parentToolCallId = data.parentToolCallId as string | undefined;

        if (!toolCallId) break;

        if (parentToolCallId) {
          if (agent.activeToolNames.get(parentToolCallId) !== 'task') break;

          const status = formatCopilotToolStatus(toolName, toolInput);
          let subTools = agent.activeSubagentToolIds.get(parentToolCallId);
          if (!subTools) {
            subTools = new Set();
            agent.activeSubagentToolIds.set(parentToolCallId, subTools);
          }
          subTools.add(toolCallId);

          let subNames = agent.activeSubagentToolNames.get(parentToolCallId);
          if (!subNames) {
            subNames = new Map();
            agent.activeSubagentToolNames.set(parentToolCallId, subNames);
          }
          subNames.set(toolCallId, toolName);

          if (!COPILOT_PERMISSION_EXEMPT_TOOLS.has(toolName)) {
            startPermissionTimer(
              agentId,
              agents,
              permissionTimers,
              COPILOT_PERMISSION_EXEMPT_TOOLS,
              webview,
            );
          }

          webview?.postMessage({
            type: 'subagentToolStart',
            id: agentId,
            parentToolId: parentToolCallId,
            toolId: toolCallId,
            status,
          });
        } else {
          cancelWaitingTimer(agentId, waitingTimers);
          agent.isWaiting = false;
          agent.hadToolsInTurn = true;
          webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });

          const status = formatCopilotToolStatus(toolName, toolInput);
          console.log(`[Pixel Agents] Agent ${agentId} tool start: ${toolCallId} ${status}`);
          agent.activeToolIds.add(toolCallId);
          agent.activeToolStatuses.set(toolCallId, status);
          agent.activeToolNames.set(toolCallId, toolName);

          if (!COPILOT_PERMISSION_EXEMPT_TOOLS.has(toolName)) {
            startPermissionTimer(
              agentId,
              agents,
              permissionTimers,
              COPILOT_PERMISSION_EXEMPT_TOOLS,
              webview,
            );
          }

          webview?.postMessage({
            type: 'agentToolStart',
            id: agentId,
            toolId: toolCallId,
            status,
          });
        }
        break;
      }

      case 'tool.execution_complete': {
        const toolCallId = data.toolCallId as string | undefined;
        const parentToolCallId = data.parentToolCallId as string | undefined;

        if (!toolCallId) break;

        if (parentToolCallId) {
          const subTools = agent.activeSubagentToolIds.get(parentToolCallId);
          if (subTools) subTools.delete(toolCallId);
          const subNames = agent.activeSubagentToolNames.get(parentToolCallId);
          if (subNames) subNames.delete(toolCallId);

          const tid = toolCallId;
          setTimeout(() => {
            webview?.postMessage({
              type: 'subagentToolDone',
              id: agentId,
              parentToolId: parentToolCallId,
              toolId: tid,
            });
          }, TOOL_DONE_DELAY_MS);

          let stillHasNonExempt = false;
          for (const [, names] of agent.activeSubagentToolNames) {
            for (const [, name] of names) {
              if (!COPILOT_PERMISSION_EXEMPT_TOOLS.has(name)) {
                stillHasNonExempt = true;
                break;
              }
            }
            if (stillHasNonExempt) break;
          }
          if (stillHasNonExempt) {
            startPermissionTimer(
              agentId,
              agents,
              permissionTimers,
              COPILOT_PERMISSION_EXEMPT_TOOLS,
              webview,
            );
          }
        } else {
          console.log(`[Pixel Agents] Agent ${agentId} tool done: ${toolCallId}`);

          if (agent.activeToolNames.get(toolCallId) === 'task') {
            agent.activeSubagentToolIds.delete(toolCallId);
            agent.activeSubagentToolNames.delete(toolCallId);
            webview?.postMessage({
              type: 'subagentClear',
              id: agentId,
              parentToolId: toolCallId,
            });
          }

          agent.activeToolIds.delete(toolCallId);
          agent.activeToolStatuses.delete(toolCallId);
          agent.activeToolNames.delete(toolCallId);

          const tid = toolCallId;
          setTimeout(() => {
            webview?.postMessage({
              type: 'agentToolDone',
              id: agentId,
              toolId: tid,
            });
          }, TOOL_DONE_DELAY_MS);
        }
        break;
      }

      case 'subagent.completed': {
        const toolCallId = data.toolCallId as string | undefined;
        if (!toolCallId) break;
        agent.activeSubagentToolIds.delete(toolCallId);
        agent.activeSubagentToolNames.delete(toolCallId);
        webview?.postMessage({
          type: 'subagentClear',
          id: agentId,
          parentToolId: toolCallId,
        });
        break;
      }

      case 'abort': {
        cancelWaitingTimer(agentId, waitingTimers);
        cancelPermissionTimer(agentId, permissionTimers);
        clearAgentActivity(agent, agentId, permissionTimers, webview);
        agent.hadToolsInTurn = false;
        break;
      }

      default:
        break;
    }
  } catch {
    // Ignore malformed lines
  }
}
