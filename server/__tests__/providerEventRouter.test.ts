import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PROVIDER_ID } from '../../src/providers/providerTypes.js';
import type { AgentState } from '../../src/types.js';
import { ProviderEventRouter } from '../src/providerEventRouter.js';

function createTestAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 1,
    sessionId: 'sess-1',
    terminalRef: undefined,
    isExternal: false,
    providerId: DEFAULT_PROVIDER_ID,
    projectDir: '/workspace',
    jsonlFile: '',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    activeSubagentToolStatuses: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    ...overrides,
  };
}

function createMockWebview() {
  const messages: Array<Record<string, unknown>> = [];
  return {
    postMessage: vi.fn((message: Record<string, unknown>) => {
      messages.push(message);
      return Promise.resolve(true);
    }),
    messages,
  };
}

describe('ProviderEventRouter', () => {
  it('routes Codex events into the existing webview contract', () => {
    const agents = new Map<number, AgentState>();
    const agent = createTestAgent();
    agents.set(agent.id, agent);
    const webview = createMockWebview();
    const router = new ProviderEventRouter(agents, () => webview as never);

    router.handleEvent('codex', {
      session_id: 'sess-1',
      hook_event_name: 'CodexEvent',
      method: 'item/started',
      params: {
        item: {
          id: 'cmd_1',
          type: 'commandExecution',
          command: 'npm run lint',
        },
      },
    });

    router.handleEvent('codex', {
      session_id: 'sess-1',
      hook_event_name: 'CodexEvent',
      method: 'item/commandExecution/requestApproval',
      params: {
        itemId: 'cmd_1',
      },
    });

    router.handleEvent('codex', {
      session_id: 'sess-1',
      hook_event_name: 'CodexEvent',
      method: 'turn/completed',
      params: {
        turn: {
          id: 'turn_1',
          status: 'completed',
        },
      },
    });

    expect(webview.messages).toContainEqual({
      type: 'agentToolStart',
      id: 1,
      toolId: 'cmd_1',
      toolName: 'Bash',
      status: 'Running: npm run lint',
    });
    expect(webview.messages).toContainEqual({
      type: 'agentToolPermission',
      id: 1,
    });
    expect(webview.messages).toContainEqual({
      type: 'agentToolDone',
      id: 1,
      toolId: 'cmd_1',
    });
    expect(webview.messages).toContainEqual({
      type: 'agentStatus',
      id: 1,
      status: 'waiting',
    });
  });

  it('routes sub-agent Codex items through the subagent overlay contract', () => {
    const agents = new Map<number, AgentState>();
    const agent = createTestAgent();
    agents.set(agent.id, agent);
    const webview = createMockWebview();
    const router = new ProviderEventRouter(agents, () => webview as never);

    router.handleEvent('codex', {
      session_id: 'sess-1',
      hook_event_name: 'CodexEvent',
      method: 'item/started',
      params: {
        item: {
          id: 'cmd_2',
          type: 'commandExecution',
          command: 'rg TODO',
          source: {
            type: 'subAgent',
            parentItemId: 'task_1',
          },
        },
      },
    });

    expect(webview.messages).toContainEqual({
      type: 'subagentToolStart',
      id: 1,
      parentToolId: 'task_1',
      toolId: 'cmd_2',
      toolName: 'Grep',
      status: 'Searching code',
    });
  });

  it('maps Codex spawnAgent child threads onto the subagent overlay and ignores child turn completion', () => {
    const agents = new Map<number, AgentState>();
    const agent = createTestAgent();
    agents.set(agent.id, agent);
    const webview = createMockWebview();
    const router = new ProviderEventRouter(agents, () => webview as never);

    router.handleEvent('codex', {
      session_id: 'sess-1',
      hook_event_name: 'CodexEvent',
      method: 'thread/started',
      params: {
        thread: {
          id: 'root-thread',
        },
      },
    });

    router.handleEvent('codex', {
      session_id: 'sess-1',
      hook_event_name: 'CodexEvent',
      method: 'item/started',
      params: {
        threadId: 'root-thread',
        item: {
          id: 'spawn_1',
          type: 'collabAgentToolCall',
          tool: 'spawnAgent',
          prompt: 'Inspect src/providers',
        },
      },
    });

    router.handleEvent('codex', {
      session_id: 'sess-1',
      hook_event_name: 'CodexEvent',
      method: 'item/completed',
      params: {
        threadId: 'root-thread',
        item: {
          id: 'spawn_1',
          type: 'collabAgentToolCall',
          tool: 'spawnAgent',
          prompt: 'Inspect src/providers',
          receiverThreadIds: ['child-thread'],
        },
      },
    });

    router.handleEvent('codex', {
      session_id: 'sess-1',
      hook_event_name: 'CodexEvent',
      method: 'item/started',
      params: {
        threadId: 'child-thread',
        item: {
          id: 'cmd_child_1',
          type: 'commandExecution',
          command: 'rg TODO',
        },
      },
    });

    router.handleEvent('codex', {
      session_id: 'sess-1',
      hook_event_name: 'CodexEvent',
      method: 'turn/completed',
      params: {
        threadId: 'child-thread',
        turn: {
          id: 'child-turn-1',
          status: 'completed',
        },
      },
    });

    router.handleEvent('codex', {
      session_id: 'sess-1',
      hook_event_name: 'CodexEvent',
      method: 'item/completed',
      params: {
        threadId: 'root-thread',
        item: {
          id: 'close_1',
          type: 'collabAgentToolCall',
          tool: 'closeAgent',
          receiverThreadIds: ['child-thread'],
        },
      },
    });

    expect(webview.messages).toContainEqual({
      type: 'agentToolStart',
      id: 1,
      toolId: 'spawn_1',
      toolName: 'Agent',
      status: 'Subtask: Inspect src/providers',
    });
    expect(webview.messages).toContainEqual({
      type: 'subagentToolStart',
      id: 1,
      parentToolId: 'spawn_1',
      toolId: 'cmd_child_1',
      toolName: 'Grep',
      status: 'Searching code',
    });
    expect(webview.messages).toContainEqual({
      type: 'subagentToolDone',
      id: 1,
      parentToolId: 'spawn_1',
      toolId: 'cmd_child_1',
    });
    expect(webview.messages).toContainEqual({
      type: 'subagentClear',
      id: 1,
      parentToolId: 'spawn_1',
    });
    expect(
      webview.messages.some(
        (message) =>
          message.type === 'agentStatus' && message.id === 1 && message.status === 'waiting',
      ),
    ).toBe(false);
  });
});
