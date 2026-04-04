import {
  ASYNC_AGENT_SUCCESS_PREFIX,
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
} from './constants.js';
import type { NormalizedAgentEvent, ParserAgentState } from './types.js';

function basenameOf(filePath: unknown): string {
  if (typeof filePath !== 'string') return '';
  const normalized = filePath.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function truncateWithEllipsis(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}…`;
}

export function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Read':
      return `Reading ${basenameOf(input.file_path)}`;
    case 'Edit':
      return `Editing ${basenameOf(input.file_path)}`;
    case 'Write':
      return `Writing ${basenameOf(input.file_path)}`;
    case 'Bash': {
      const command = typeof input.command === 'string' ? input.command : '';
      return `Running: ${truncateWithEllipsis(command, BASH_COMMAND_DISPLAY_MAX_LENGTH)}`;
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
    case 'Agent': {
      const description = typeof input.description === 'string' ? input.description : '';
      if (!description) return 'Running subtask';
      return `Subtask: ${truncateWithEllipsis(description, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH)}`;
    }
    case 'AskUserQuestion':
      return 'Waiting for your answer';
    case 'EnterPlanMode':
      return 'Planning';
    case 'NotebookEdit':
      return 'Editing notebook';
    default:
      return `Using ${toolName}`;
  }
}

type JsonRecord = Record<string, unknown>;

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function extractContent(record: JsonRecord): unknown {
  const message = asObject(record.message);
  return message?.content ?? record.content;
}

function clearParentToolSubagents(
  agentId: number,
  parentToolId: string,
  state: ParserAgentState,
  events: NormalizedAgentEvent[],
): void {
  state.activeSubagentToolIds.delete(parentToolId);
  state.activeSubagentToolNames.delete(parentToolId);
  events.push({
    type: 'subagentClear',
    id: agentId,
    parentToolId,
  });
}

function removeTool(toolId: string, state: ParserAgentState): void {
  state.activeToolIds.delete(toolId);
  state.activeToolNames.delete(toolId);
  state.activeToolStatuses.delete(toolId);
  state.backgroundAgentToolIds.delete(toolId);
}

function hasForegroundTools(state: ParserAgentState): boolean {
  for (const toolId of state.activeToolIds) {
    if (!state.backgroundAgentToolIds.has(toolId)) return true;
  }
  return false;
}

function clearForegroundTools(
  agentId: number,
  state: ParserAgentState,
  events: NormalizedAgentEvent[],
): void {
  let changed = false;
  for (const toolId of [...state.activeToolIds]) {
    if (state.backgroundAgentToolIds.has(toolId)) continue;
    const toolName = state.activeToolNames.get(toolId);
    removeTool(toolId, state);
    changed = true;
    if (toolName === 'Task' || toolName === 'Agent') {
      clearParentToolSubagents(agentId, toolId, state, events);
    }
  }
  if (changed) {
    events.push({ type: 'agentToolsClear', id: agentId });
    for (const toolId of state.backgroundAgentToolIds) {
      const status = state.activeToolStatuses.get(toolId);
      if (!status) continue;
      events.push({
        type: 'agentToolStart',
        id: agentId,
        toolId,
        status,
      });
    }
  }
}

function isAsyncAgentResult(block: Record<string, unknown>): boolean {
  const content = block.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      const itemObject = asObject(item);
      if (!itemObject) continue;
      const text = asString(itemObject.text);
      if (text?.startsWith(ASYNC_AGENT_SUCCESS_PREFIX)) return true;
    }
    return false;
  }
  return asString(content)?.startsWith(ASYNC_AGENT_SUCCESS_PREFIX) ?? false;
}

function parseProgressRecord(
  agentId: number,
  record: JsonRecord,
  state: ParserAgentState,
): NormalizedAgentEvent[] {
  const events: NormalizedAgentEvent[] = [];
  const parentToolId = asString(record.parentToolUseID);
  if (!parentToolId) return events;

  const data = asObject(record.data);
  if (!data) return events;

  const dataType = asString(data.type);
  if (dataType === 'bash_progress' || dataType === 'mcp_progress') {
    return events;
  }

  const parentToolName = state.activeToolNames.get(parentToolId);
  if (parentToolName !== 'Task' && parentToolName !== 'Agent') return events;

  const progressMessage = asObject(data.message);
  const progressType = asString(progressMessage?.type);
  const innerMessage = asObject(progressMessage?.message);
  const content = asArray(innerMessage?.content);
  if (!progressType || !content) return events;

  if (progressType === 'assistant') {
    for (const block of content) {
      const blockObject = asObject(block);
      if (!blockObject) continue;
      if (asString(blockObject.type) !== 'tool_use') continue;
      const toolId = asString(blockObject.id);
      if (!toolId) continue;
      const toolName = asString(blockObject.name) ?? '';
      const input = asObject(blockObject.input) ?? {};
      const status = formatToolStatus(toolName, input);

      let subToolIds = state.activeSubagentToolIds.get(parentToolId);
      if (!subToolIds) {
        subToolIds = new Set();
        state.activeSubagentToolIds.set(parentToolId, subToolIds);
      }
      subToolIds.add(toolId);

      let subToolNames = state.activeSubagentToolNames.get(parentToolId);
      if (!subToolNames) {
        subToolNames = new Map();
        state.activeSubagentToolNames.set(parentToolId, subToolNames);
      }
      subToolNames.set(toolId, toolName);

      events.push({
        type: 'subagentToolStart',
        id: agentId,
        parentToolId,
        toolId,
        status,
      });
    }
    return events;
  }

  if (progressType === 'user') {
    for (const block of content) {
      const blockObject = asObject(block);
      if (!blockObject) continue;
      if (asString(blockObject.type) !== 'tool_result') continue;
      const toolId = asString(blockObject.tool_use_id);
      if (!toolId) continue;

      state.activeSubagentToolIds.get(parentToolId)?.delete(toolId);
      state.activeSubagentToolNames.get(parentToolId)?.delete(toolId);

      events.push({
        type: 'subagentToolDone',
        id: agentId,
        parentToolId,
        toolId,
      });
    }
  }

  return events;
}

export function normalizeTranscriptLine(
  agentId: number,
  line: string,
  state: ParserAgentState,
): NormalizedAgentEvent[] {
  let record: JsonRecord;
  try {
    record = JSON.parse(line) as JsonRecord;
  } catch {
    return [];
  }

  const events: NormalizedAgentEvent[] = [];
  const recordType = asString(record.type);

  if (recordType === 'assistant') {
    const content = extractContent(record);
    const contentArray = asArray(content);

    if (contentArray) {
      let hasToolUse = false;
      for (const block of contentArray) {
        const blockObject = asObject(block);
        if (!blockObject || asString(blockObject.type) !== 'tool_use') continue;
        const toolId = asString(blockObject.id);
        if (!toolId) continue;
        hasToolUse = true;

        const toolName = asString(blockObject.name) ?? '';
        const input = asObject(blockObject.input) ?? {};
        const status = formatToolStatus(toolName, input);

        state.activeToolIds.add(toolId);
        state.activeToolNames.set(toolId, toolName);
        state.activeToolStatuses.set(toolId, status);
        state.hadToolsInTurn = true;
        state.isWaiting = false;

        events.push({
          type: 'agentToolStart',
          id: agentId,
          toolId,
          status,
          toolName,
        });
      }

      if (hasToolUse) {
        events.unshift({ type: 'agentStatus', id: agentId, status: 'active' });
      }
      return events;
    }

    if (typeof content === 'string') {
      state.isWaiting = false;
      events.push({ type: 'agentStatus', id: agentId, status: 'active' });
      return events;
    }

    return events;
  }

  if (recordType === 'progress') {
    return parseProgressRecord(agentId, record, state);
  }

  if (recordType === 'user') {
    const content = extractContent(record);
    const contentArray = asArray(content);
    let handledToolResult = false;

    if (contentArray) {
      for (const block of contentArray) {
        const blockObject = asObject(block);
        if (!blockObject || asString(blockObject.type) !== 'tool_result') continue;
        const completedToolId = asString(blockObject.tool_use_id);
        if (!completedToolId) continue;
        handledToolResult = true;

        const completedToolName = state.activeToolNames.get(completedToolId);
        if (
          (completedToolName === 'Task' || completedToolName === 'Agent') &&
          isAsyncAgentResult(blockObject)
        ) {
          state.backgroundAgentToolIds.add(completedToolId);
          continue;
        }

        if (completedToolName === 'Task' || completedToolName === 'Agent') {
          clearParentToolSubagents(agentId, completedToolId, state, events);
        }

        removeTool(completedToolId, state);

        events.push({
          type: 'agentToolDone',
          id: agentId,
          toolId: completedToolId,
        });
      }

      if (!handledToolResult) {
        clearForegroundTools(agentId, state, events);
        state.hadToolsInTurn = false;
      } else if (!hasForegroundTools(state)) {
        state.hadToolsInTurn = false;
      }
      return events;
    }

    if (typeof content === 'string' && content.trim().length > 0) {
      clearForegroundTools(agentId, state, events);
      state.hadToolsInTurn = false;
    }
    return events;
  }

  if (recordType === 'queue-operation' && asString(record.operation) === 'enqueue') {
    const content = asString(record.content);
    if (!content) return events;
    const match = /<tool-use-id>(.*?)<\/tool-use-id>/.exec(content);
    const completedToolId = match?.[1];
    if (!completedToolId || !state.backgroundAgentToolIds.has(completedToolId)) return events;

    clearParentToolSubagents(agentId, completedToolId, state, events);
    removeTool(completedToolId, state);
    events.push({ type: 'agentToolDone', id: agentId, toolId: completedToolId });
    return events;
  }

  if (recordType === 'system' && asString(record.subtype) === 'turn_duration') {
    clearForegroundTools(agentId, state, events);
    state.hadToolsInTurn = false;
    state.isWaiting = true;
    events.push({ type: 'agentStatus', id: agentId, status: 'waiting' });
    return events;
  }

  return events;
}
