import * as path from 'path';
import type * as vscode from 'vscode';

import {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
  TEXT_IDLE_DELAY_MS,
  TOOL_DONE_DELAY_MS,
} from '../../constants.js';
import {
  cancelPermissionTimer,
  cancelWaitingTimer,
  clearAgentActivity,
  startPermissionTimer,
  startWaitingTimer,
} from '../../timerManager.js';
import type { AgentState } from '../../types.js';

export const PERMISSION_EXEMPT_TOOLS = new Set([
  'Task',
  'Agent',
  'task',
  'agent',
  'AskUserQuestion',
  'ask_user',
]);

function normalizeToolName(toolName: unknown): string {
  if (typeof toolName !== 'string') return '';
  return toolName as string;
}

export function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
  console.log(`[Pixel Agents] Formatting status for tool ${toolName} with input:`, input);
  switch (toolName) {
    case 'Read':
    case 'view':
      return `Reading ${base(input.file_path)}`;
    case 'Edit':
    case 'edit':
    case 'report_intent':
      return `Editing ${base(input.file_path)}`;
    case 'Write':
      return `Writing ${base(input.file_path)}`;
    case 'Bash': {
      const cmd = (input.command as string) || '';
      return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
    }
    case 'Glob':
    case 'glob':
      return 'Searching files';
    case 'Grep':
    case 'report_intent':
      return 'Searching code';
    case 'WebFetch':
      return 'Fetching web content';
    case 'WebSearch':
      return 'Searching the web';
    case 'Task':
    case 'Agent':
    case 'task':
    case 'agent': {
      const desc = typeof input.description === 'string' ? input.description : '';
      return desc
        ? `Subtask: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}`
        : 'Running subtask';
    }
    case 'AskUserQuestion':
    case 'ask_user':
      return 'Waiting for your answer';
    case 'EnterPlanMode':
      return 'Planning';
    case 'NotebookEdit':
      return `Editing notebook`;
    default:
      return `Using ${toolName}`;
  }
}

export function processTranscriptLineCopilot(
  agentId: number,
  line: string,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
  const agent = agents.get(agentId);
  // Logs
  console.log('---------------------------------------');
  console.log(agent);
  console.log('---------------------------------------');

  if (!agent) return;
  agent.lastDataAt = Date.now();
  agent.linesProcessed++;
  try {
    const record = JSON.parse(line);

    // Resilient content extraction: support both record.message.content and record.content
    // Claude Code may change the JSONL structure across versions
    const assistantContent = record.message?.content ?? record.content;
    console.log(`[Pixel Agents] Agent ${agentId} record.type :`, record.type);

    // Copilot events

    // Session start: reset all state and start waiting for user input - First event of a session
    if (record.type === 'session.start') {
      console.log(`[Pixel Agents] Agent ${agentId} session started with record:`, record);
      agent.isWaiting = true;
      agent.hadToolsInTurn = false;
      clearAgentActivity(agent, agentId, permissionTimers, webview);
      webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
      startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
      return;
    }

    // User send Message to agent
    if (record.type === 'user.message') {
      const userContent = (record.data as Record<string, unknown> | undefined)?.content;
      if (typeof userContent !== 'string' && !Array.isArray(userContent)) {
        console.log('[Pixel Agents Dev] User content not is a string.');
      }
      cancelWaitingTimer(agentId, waitingTimers);
      clearAgentActivity(agent, agentId, permissionTimers, webview);
      agent.hadToolsInTurn = false;
      return;
    }

    // Agent turn start - start waiting timer for text-only response (if no tool calls)
    if (record.type === 'assistant.turn_start') {
      startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
      webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
      return;
    }

    if (record.type === 'tool.execution_start') {
      const tool = record.data as Record<string, unknown> | undefined;
      const toolCallId = tool?.toolCallId as string | undefined;
      const parentToolCallId = tool?.parentToolCallId as string | undefined;
      const rawName = tool?.toolName ?? tool?.name;
      const toolName = normalizeToolName(rawName);
      const toolInputs = (tool?.toolInputs ?? tool?.input ?? tool?.arguments ?? {}) as Record<
        string,
        unknown
      >;
      const status = formatToolStatus(toolName, toolInputs);

      if (parentToolCallId && toolCallId) {
        // Sub-agent tool: track and emit subagentToolStart
        const parentToolName = agent.activeToolNames.get(parentToolCallId);
        if (
          parentToolName === 'task' ||
          parentToolName === 'Task' ||
          parentToolName === 'agent' ||
          parentToolName === 'Agent'
        ) {
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

          if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
            startPermissionTimer(
              agentId,
              agents,
              permissionTimers,
              PERMISSION_EXEMPT_TOOLS,
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
        }
      } else {
        // Main agent tool — already tracked from assistant.message; just restart permission timer
        if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
          startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, webview);
        }
      }
      return;
    }

    if (record.type === 'assistant.message') {
      const data = record.data as Record<string, unknown> | undefined;
      const parentToolCallId = data?.parentToolCallId as string | undefined;
      const toolCalls = data?.toolRequests;
      console.log(
        `[Pixel Agents Dev] Agent ${agentId} assistant message content : ${assistantContent}`,
      );

      // Sub-agent message: tools are handled by tool.execution_start with parentToolCallId.
      // Skip root-level handling to avoid polluting activeToolIds.
      if (parentToolCallId) {
        return;
      }

      // NOTE: Do NOT clear backgroundAgentToolIds here. For Copilot background agents,
      // the main agent can send a root-level message (e.g. "I've launched 2 agents")
      // while sub-agents are still running. Sub-agents are cleaned up by subagent.completed.

      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        cancelWaitingTimer(agentId, waitingTimers);
        agent.hadToolsInTurn = true;
        agent.isWaiting = false;
        webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });

        let hasNonExemptTool = false;
        for (const t of toolCalls) {
          const tool = t as Record<string, unknown>;
          const toolCallId = tool.toolCallId as string | undefined;
          if (!toolCallId) continue;
          if (agent.activeToolIds.has(toolCallId)) continue;

          const rawName = tool.toolName ?? tool.name;
          const toolName = normalizeToolName(rawName);
          const toolInputs = (tool.toolInputs ?? tool.input ?? tool.arguments ?? {}) as Record<
            string,
            unknown
          >;
          const status = formatToolStatus(toolName, toolInputs);

          agent.activeToolIds.add(toolCallId);
          agent.activeToolNames.set(toolCallId, toolName);
          agent.activeToolStatuses.set(toolCallId, status);

          if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) hasNonExemptTool = true;

          webview?.postMessage({
            type: 'agentToolStart',
            id: agentId,
            toolId: toolCallId,
            status,
          });
        }

        if (hasNonExemptTool) {
          startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, webview);
        }
      } else {
        if (!agent.hadToolsInTurn) {
          startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
        }
      }
      return;
    }

    // Turn end: agent finished its turn — clear tools but preserve background sub-agents
    if (record.type === 'assistant.turn_end') {
      const turnEndData = record.data as Record<string, unknown> | undefined;
      const turnEndParentToolCallId = turnEndData?.parentToolCallId as string | undefined;

      // Sub-agent's own turn ended — the background task is done, remove the character.
      if (turnEndParentToolCallId && agent.backgroundAgentToolIds.has(turnEndParentToolCallId)) {
        agent.activeSubagentToolIds.delete(turnEndParentToolCallId);
        agent.activeSubagentToolNames.delete(turnEndParentToolCallId);
        agent.activeToolIds.delete(turnEndParentToolCallId);
        agent.activeToolStatuses.delete(turnEndParentToolCallId);
        agent.activeToolNames.delete(turnEndParentToolCallId);
        agent.backgroundAgentToolIds.delete(turnEndParentToolCallId);
        webview?.postMessage({
          type: 'subagentClear',
          id: agentId,
          parentToolId: turnEndParentToolCallId,
        });
        if (agent.backgroundAgentToolIds.size === 0) {
          agent.isWaiting = true;
          webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
          startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
        }
        return;
      }

      // Root turn ended — clearAgentActivity preserves backgroundAgentToolIds and re-emits
      // them so sub-agent characters survive until the sub-agent finishes.
      clearAgentActivity(agent, agentId, permissionTimers, webview);
      agent.hadToolsInTurn = false;
      if (agent.backgroundAgentToolIds.size === 0) {
        agent.isWaiting = true;
        webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
        startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
      }
      return;
    }

    if (record.type === 'tool.execution_complete') {
      const data = record.data as Record<string, unknown> | undefined;
      const toolCallId = data?.toolCallId as string | undefined;
      const parentToolCallId = data?.parentToolCallId as string | undefined;

      if (parentToolCallId && toolCallId) {
        // Sub-agent tool completion
        const subTools = agent.activeSubagentToolIds.get(parentToolCallId);
        if (subTools?.has(toolCallId)) {
          subTools.delete(toolCallId);
          const subNames = agent.activeSubagentToolNames.get(parentToolCallId);
          if (subNames) subNames.delete(toolCallId);

          const doneSubToolId = toolCallId;
          const doneParentToolId = parentToolCallId;
          setTimeout(() => {
            webview?.postMessage({
              type: 'subagentToolDone',
              id: agentId,
              parentToolId: doneParentToolId,
              toolId: doneSubToolId,
            });
          }, TOOL_DONE_DELAY_MS);
        }
      } else if (toolCallId && agent.activeToolIds.has(toolCallId)) {
        // Main agent tool completion
        console.log(`[Pixel Agents] Agent ${agentId} tool done: ${toolCallId}`);
        const completedToolName = agent.activeToolNames.get(toolCallId);
        const isTaskTool =
          completedToolName === 'Task' ||
          completedToolName === 'Agent' ||
          completedToolName === 'task' ||
          completedToolName === 'agent';

        // Copilot background tasks: tool.execution_complete fires when the agent IS LAUNCHED,
        // not when it finishes. Register as background so clearAgentActivity preserves it.
        if (isTaskTool && isCopilotBackgroundLaunch(data)) {
          agent.backgroundAgentToolIds.add(toolCallId);
          // Keep in activeToolIds/Names so parentToolCallId lookups work for sub-tools
          return;
        }

        if (isTaskTool) {
          agent.activeSubagentToolIds.delete(toolCallId);
          agent.activeSubagentToolNames.delete(toolCallId);
          agent.backgroundAgentToolIds.delete(toolCallId);
          webview?.postMessage({
            type: 'subagentClear',
            id: agentId,
            parentToolId: toolCallId,
          });
        }
        agent.activeToolIds.delete(toolCallId);
        agent.activeToolStatuses.delete(toolCallId);
        agent.activeToolNames.delete(toolCallId);
        cancelWaitingTimer(agentId, waitingTimers);

        const doneToolId = toolCallId;
        setTimeout(() => {
          webview?.postMessage({
            type: 'agentToolDone',
            id: agentId,
            toolId: doneToolId,
          });
        }, TOOL_DONE_DELAY_MS);

        if (agent.activeToolIds.size === 0) {
          agent.hadToolsInTurn = false;
        }
      }

      return;
    }

    // Copilot sub-agent lifecycle events
    if (record.type === 'subagent.started') {
      const subData = record.data as Record<string, unknown> | undefined;
      const toolCallId = subData?.toolCallId as string | undefined;
      if (!toolCallId) return;
      console.log(
        `[Pixel Agents] Agent ${agentId} subagent started: ${toolCallId} (${subData?.agentDisplayName ?? subData?.agentName ?? 'unknown'})`,
      );
      // Sub-agent character already created via agentToolStart in assistant.message handler.
      // This event confirms the sub-agent is actively running.
      return;
    }

    if (record.type === 'subagent.completed') {
      const subData = record.data as Record<string, unknown> | undefined;
      const toolCallId = subData?.toolCallId as string | undefined;
      if (!toolCallId) return;
      console.log(
        `[Pixel Agents] Agent ${agentId} subagent completed: ${toolCallId} (${subData?.agentDisplayName ?? subData?.agentName ?? 'unknown'})`,
      );

      // Clean up all sub-agent tracking for this tool
      agent.activeSubagentToolIds.delete(toolCallId);
      agent.activeSubagentToolNames.delete(toolCallId);
      agent.backgroundAgentToolIds.delete(toolCallId);
      agent.activeToolIds.delete(toolCallId);
      agent.activeToolStatuses.delete(toolCallId);
      agent.activeToolNames.delete(toolCallId);

      // Remove sub-agent character from webview
      webview?.postMessage({
        type: 'subagentClear',
        id: agentId,
        parentToolId: toolCallId,
      });

      // Send tool done after delay to prevent flicker
      const doneToolId = toolCallId;
      setTimeout(() => {
        webview?.postMessage({
          type: 'agentToolDone',
          id: agentId,
          toolId: doneToolId,
        });
      }, TOOL_DONE_DELAY_MS);

      return;
    }

    // Old events maintained for backward compatibility with Claude Code and other agents using the original transcript format.
    if (record.type && !agent.seenUnknownRecordTypes.has(record.type)) {
      // Log first occurrence of unrecognized record types to help diagnose issues
      // where Claude Code changes JSONL format. Known types we intentionally skip:
      // file-history-snapshot, queue-operation (non-enqueue), etc.
      const knownSkippableTypes = new Set([
        'file-history-snapshot',
        'system',
        'queue-operation',
        'session.start',
        'user.message',
        'assistant.turn_start',
        'assistant.message',
        'assistant.turn_end',
        'tool.execution_start',
        'tool.execution_complete',
        'subagent.started',
        'subagent.completed',
        'system.notification',
      ]);
      if (!knownSkippableTypes.has(record.type)) {
        agent.seenUnknownRecordTypes.add(record.type);
        console.log(
          `[Pixel Agents] Agent ${agentId}: unrecognized record type '${record.type}'. ` +
            `Keys: ${Object.keys(record).join(', ')}`,
        );
      }
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
        console.log(
          `[Pixel Agents] Agent ${agentId} subagent tool done: ${block.tool_use_id} (parent: ${parentToolId})`,
        );

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

/**
 * Detects Copilot background task launches where tool.execution_complete fires
 * as soon as the agent is spawned, not when it finishes.
 * Identified by toolTelemetry.properties.execution_mode === 'background'.
 */
function isCopilotBackgroundLaunch(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const telemetry = data.toolTelemetry as Record<string, unknown> | undefined;
  if (!telemetry) return false;
  const props = telemetry.properties as Record<string, unknown> | undefined;
  return (props?.execution_mode as string | undefined) === 'background';
}

/** Check if a tool_result block indicates an async/background agent launch */
function isAsyncAgentResult(block: Record<string, unknown>): boolean {
  const content = block.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).text === 'string' &&
        ((item as Record<string, unknown>).text as string).startsWith(
          'Async agent launched successfully.',
        )
      ) {
        return true;
      }
    }
  } else if (typeof content === 'string') {
    return content.startsWith('Async agent launched successfully.');
  }
  return false;
}
