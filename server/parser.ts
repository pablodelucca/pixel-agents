import * as path from 'path';
import type { TrackedAgent, ServerMessage } from './types.js';

const READING_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);
const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'AskUserQuestion']);
const PERMISSION_TIMER_DELAY_MS = 7000;
const TEXT_IDLE_DELAY_MS = 5000;
const TOOL_DONE_DELAY_MS = 300;
const BASH_COMMAND_DISPLAY_MAX_LENGTH = 30;
const TASK_DESCRIPTION_DISPLAY_MAX_LENGTH = 40;
const IDLE_ACTIVITY_TIMEOUT_MS = 120_000; // 2 min — long-running tools (builds, tests) need time

// Timer maps (module-level)
const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
const idleTimeoutTimers = new Map<number, ReturnType<typeof setTimeout>>();

function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
  switch (toolName) {
    case 'Read':
      return `Reading ${base(input.file_path)}`;
    case 'Edit':
      return `Editing ${base(input.file_path)}`;
    case 'Write':
      return `Writing ${base(input.file_path)}`;
    case 'Bash': {
      const cmd = (input.command as string) || '';
      return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
    }
    case 'Glob':
      return 'Searching files';
    case 'Grep':
      return 'Searching code';
    case 'WebFetch':
      return 'Fetching web content';
    case 'WebSearch':
      return 'Searching the web';
    case 'Task': {
      const desc = typeof input.description === 'string' ? input.description : '';
      return desc
        ? `Subtask: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}`
        : 'Running subtask';
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

function cancelTimer(agentId: number, timers: Map<number, ReturnType<typeof setTimeout>>): void {
  const t = timers.get(agentId);
  if (t) {
    clearTimeout(t);
    timers.delete(agentId);
  }
}

function startWaitingTimer(agent: TrackedAgent, emit: (msg: ServerMessage) => void): void {
  cancelTimer(agent.id, waitingTimers);
  waitingTimers.set(
    agent.id,
    setTimeout(() => {
      waitingTimers.delete(agent.id);
      agent.isWaiting = true;
      agent.hadToolsInTurn = false;
      emit({ type: 'agentStatus', id: agent.id, status: 'waiting' });
    }, TEXT_IDLE_DELAY_MS),
  );
}

function startIdleTimeout(agent: TrackedAgent, emit: (msg: ServerMessage) => void): void {
  cancelTimer(agent.id, idleTimeoutTimers);
  idleTimeoutTimers.set(
    agent.id,
    setTimeout(() => {
      idleTimeoutTimers.delete(agent.id);
      if (agent.activity !== 'idle' && agent.activity !== 'waiting') {
        clearAgentActivity(agent, emit);
        agent.isWaiting = true;
        agent.hadToolsInTurn = false;
        agent.activity = 'waiting';
        emit({ type: 'agentStatus', id: agent.id, status: 'waiting' });
      }
    }, IDLE_ACTIVITY_TIMEOUT_MS),
  );
}

function startPermissionTimer(agent: TrackedAgent, emit: (msg: ServerMessage) => void): void {
  cancelTimer(agent.id, permissionTimers);
  permissionTimers.set(
    agent.id,
    setTimeout(() => {
      permissionTimers.delete(agent.id);
      // Check if there are still active non-exempt tools
      let hasNonExempt = false;
      for (const [, toolName] of agent.activeToolNames) {
        if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
          hasNonExempt = true;
          break;
        }
      }
      if (!hasNonExempt) {
        // Also check subagent tools
        for (const [, subNames] of agent.activeSubagentToolNames) {
          for (const [, toolName] of subNames) {
            if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
              hasNonExempt = true;
              break;
            }
          }
          if (hasNonExempt) break;
        }
      }
      if (hasNonExempt && !agent.permissionSent) {
        agent.permissionSent = true;
        emit({ type: 'agentToolPermission', id: agent.id });
      }
    }, PERMISSION_TIMER_DELAY_MS),
  );
}

export function processTranscriptLine(
  line: string,
  agent: TrackedAgent,
  emit: (msg: ServerMessage) => void,
): void {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line);
  } catch {
    return;
  }

  const type = record.type as string;

  if (type === 'assistant') {
    handleAssistantMessage(record, agent, emit);
  } else if (type === 'user') {
    handleUserMessage(record, agent, emit);
  } else if (type === 'system') {
    handleSystemMessage(record, agent, emit);
  } else if (type === 'progress') {
    handleProgressMessage(record, agent, emit);
  }
}

function handleAssistantMessage(
  record: Record<string, unknown>,
  agent: TrackedAgent,
  emit: (msg: ServerMessage) => void,
): void {
  const message = record.message as Record<string, unknown> | undefined;
  if (!message?.content) return;

  const content = message.content as Array<Record<string, unknown>>;
  if (!Array.isArray(content)) return;

  const hasToolUse = content.some((b) => b.type === 'tool_use');

  if (hasToolUse) {
    cancelTimer(agent.id, waitingTimers);
    agent.isWaiting = false;
    agent.hadToolsInTurn = true;
    emit({ type: 'agentStatus', id: agent.id, status: 'active' });

    let hasNonExemptTool = false;
    for (const block of content) {
      if (block.type === 'tool_use' && block.id) {
        const toolId = block.id as string;
        const toolName = (block.name as string) || '';
        const input = (block.input as Record<string, unknown>) || {};
        const status = formatToolStatus(toolName, input);

        agent.activeTools.set(toolId, { toolId, toolName, status });
        agent.activeToolNames.set(toolId, toolName);
        agent.lastActivityTime = Date.now();

        const activity = READING_TOOLS.has(toolName) ? 'reading' : 'typing';
        agent.activity = activity;

        if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
          hasNonExemptTool = true;
        }

        emit({ type: 'agentToolStart', id: agent.id, toolId, status });
      }
    }
    if (hasNonExemptTool) {
      agent.permissionSent = false;
      startPermissionTimer(agent, emit);
    }
    startIdleTimeout(agent, emit);
  } else if (content.some((b) => b.type === 'text') && !agent.hadToolsInTurn) {
    // Text-only response — use silence-based idle detection
    startWaitingTimer(agent, emit);
  }
}

function handleUserMessage(
  record: Record<string, unknown>,
  agent: TrackedAgent,
  emit: (msg: ServerMessage) => void,
): void {
  const message = record.message as Record<string, unknown> | undefined;
  if (!message?.content) return;

  const content = message.content;
  if (Array.isArray(content)) {
    const blocks = content as Array<Record<string, unknown>>;
    const hasToolResult = blocks.some((b) => b.type === 'tool_result');

    if (hasToolResult) {
      for (const block of blocks) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          const completedToolId = block.tool_use_id as string;

          // If completed tool was a Task, clear its subagent tools
          if (agent.activeToolNames.get(completedToolId) === 'Task') {
            agent.activeSubagentToolIds.delete(completedToolId);
            agent.activeSubagentToolNames.delete(completedToolId);
            emit({
              type: 'subagentClear',
              id: agent.id,
              parentToolId: completedToolId,
            });
          }

          agent.activeTools.delete(completedToolId);
          agent.activeToolNames.delete(completedToolId);

          // Delay the done message slightly (matches upstream)
          const toolId = completedToolId;
          setTimeout(() => {
            emit({ type: 'agentToolDone', id: agent.id, toolId });
          }, TOOL_DONE_DELAY_MS);
        }
      }
      if (agent.activeTools.size === 0) {
        agent.hadToolsInTurn = false;
      }
    } else {
      // New user text prompt — new turn starting
      cancelTimer(agent.id, waitingTimers);
      cancelTimer(agent.id, idleTimeoutTimers);
      clearAgentActivity(agent, emit);
      agent.hadToolsInTurn = false;
    }
  } else if (typeof content === 'string' && (content as string).trim()) {
    cancelTimer(agent.id, waitingTimers);
    cancelTimer(agent.id, idleTimeoutTimers);
    clearAgentActivity(agent, emit);
    agent.hadToolsInTurn = false;
  }
}

function handleSystemMessage(
  record: Record<string, unknown>,
  agent: TrackedAgent,
  emit: (msg: ServerMessage) => void,
): void {
  const subtype = record.subtype as string | undefined;

  if (subtype === 'turn_duration') {
    cancelTimer(agent.id, waitingTimers);
    cancelTimer(agent.id, permissionTimers);
    cancelTimer(agent.id, idleTimeoutTimers);

    if (agent.activeTools.size > 0) {
      agent.activeTools.clear();
      agent.activeToolNames.clear();
      agent.activeSubagentToolIds.clear();
      agent.activeSubagentToolNames.clear();
      emit({ type: 'agentToolsClear', id: agent.id });
    }

    agent.isWaiting = true;
    agent.permissionSent = false;
    agent.hadToolsInTurn = false;
    agent.activity = 'waiting';
    emit({ type: 'agentStatus', id: agent.id, status: 'waiting' });
  }
}

function handleProgressMessage(
  record: Record<string, unknown>,
  agent: TrackedAgent,
  emit: (msg: ServerMessage) => void,
): void {
  const parentToolId = record.parentToolUseID as string | undefined;
  if (!parentToolId) return;

  const data = record.data as Record<string, unknown> | undefined;
  if (!data) return;

  const dataType = data.type as string | undefined;

  // bash_progress / mcp_progress: restart permission timer
  if (dataType === 'bash_progress' || dataType === 'mcp_progress') {
    if (agent.activeTools.has(parentToolId)) {
      startPermissionTimer(agent, emit);
    }
    return;
  }

  // Only handle subagent progress for Task tools
  if (agent.activeToolNames.get(parentToolId) !== 'Task') return;

  const msg = data.message as Record<string, unknown> | undefined;
  if (!msg) return;

  const msgType = msg.type as string;
  const innerMsg = msg.message as Record<string, unknown> | undefined;
  const content = innerMsg?.content;
  if (!Array.isArray(content)) return;

  if (msgType === 'assistant') {
    let hasNonExemptSubTool = false;
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === 'tool_use' && block.id) {
        const toolId = block.id as string;
        const toolName = (block.name as string) || '';
        const input = (block.input as Record<string, unknown>) || {};
        const status = formatToolStatus(toolName, input);

        let subTools = agent.activeSubagentToolIds.get(parentToolId);
        if (!subTools) {
          subTools = new Set();
          agent.activeSubagentToolIds.set(parentToolId, subTools);
        }
        subTools.add(toolId);

        let subNames = agent.activeSubagentToolNames.get(parentToolId);
        if (!subNames) {
          subNames = new Map();
          agent.activeSubagentToolNames.set(parentToolId, subNames);
        }
        subNames.set(toolId, toolName);

        if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
          hasNonExemptSubTool = true;
        }

        emit({
          type: 'subagentToolStart',
          id: agent.id,
          parentToolId,
          toolId,
          status,
        });
      }
    }
    if (hasNonExemptSubTool) {
      startPermissionTimer(agent, emit);
    }
  } else if (msgType === 'user') {
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        const toolId = block.tool_use_id as string;
        const subTools = agent.activeSubagentToolIds.get(parentToolId);
        if (subTools) subTools.delete(toolId);
        const subNames = agent.activeSubagentToolNames.get(parentToolId);
        if (subNames) subNames.delete(toolId);

        setTimeout(() => {
          emit({
            type: 'subagentToolDone',
            id: agent.id,
            parentToolId,
            toolId,
          });
        }, TOOL_DONE_DELAY_MS);
      }
    }
  }
}

function clearAgentActivity(agent: TrackedAgent, emit: (msg: ServerMessage) => void): void {
  cancelTimer(agent.id, permissionTimers);
  cancelTimer(agent.id, idleTimeoutTimers);
  if (agent.activeTools.size > 0) {
    agent.activeTools.clear();
    agent.activeToolNames.clear();
    agent.activeSubagentToolIds.clear();
    agent.activeSubagentToolNames.clear();
    emit({ type: 'agentToolsClear', id: agent.id });
  }
  if (agent.permissionSent) {
    agent.permissionSent = false;
    emit({ type: 'agentToolPermissionClear', id: agent.id });
  }
  agent.activity = 'idle';
}
