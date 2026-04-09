import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../../src/types.js';
import { HookEventHandler } from '../src/hookEventHandler.js';

/** Minimal AgentState for testing. */
function createTestAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 1,
    terminalRef: undefined,
    isExternal: true,
    projectDir: '/test',
    jsonlFile: '/test/session.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    hasScannedSinceIdle: false,
    seenUnknownRecordTypes: new Set(),
    ...overrides,
  } as AgentState;
}

function createMockWebview() {
  const messages: Array<Record<string, unknown>> = [];
  return {
    postMessage: vi.fn((msg: Record<string, unknown>) => {
      messages.push(msg);
      return Promise.resolve(true);
    }),
    messages,
  };
}

describe('HookEventHandler', () => {
  let agents: Map<number, AgentState>;
  let waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
  let permissionTimers: Map<number, ReturnType<typeof setTimeout>>;
  let mockWebview: ReturnType<typeof createMockWebview>;
  let handler: HookEventHandler;

  beforeEach(() => {
    agents = new Map();
    waitingTimers = new Map();
    permissionTimers = new Map();
    mockWebview = createMockWebview();
    handler = new HookEventHandler(
      agents,
      waitingTimers,
      permissionTimers,
      () => mockWebview as unknown as import('vscode').Webview,
    );
  });

  // 1. PermissionRequest sends agentToolPermission
  it('PermissionRequest sends agentToolPermission', () => {
    const agent = createTestAgent({ id: 1 });
    agents.set(1, agent);
    handler.registerAgent('sess-1', 1);

    handler.handleEvent('claude', {
      hook_event_name: 'PermissionRequest',
      session_id: 'sess-1',
    });

    const msg = mockWebview.messages.find((m) => m.type === 'agentToolPermission');
    expect(msg).toBeTruthy();
    expect(msg?.id).toBe(1);
  });

  // 2. PermissionRequest cancels permission timer
  it('PermissionRequest cancels permission timer', () => {
    const agent = createTestAgent({ id: 1 });
    agents.set(1, agent);
    handler.registerAgent('sess-1', 1);

    const timer = setTimeout(() => {}, 10000);
    permissionTimers.set(1, timer);

    handler.handleEvent('claude', {
      hook_event_name: 'PermissionRequest',
      session_id: 'sess-1',
    });

    expect(permissionTimers.has(1)).toBe(false);
  });

  // 3. PermissionRequest notifies sub-agents
  it('PermissionRequest notifies sub-agents', () => {
    const agent = createTestAgent({ id: 1 });
    agent.activeSubagentToolNames.set('tool-parent', new Map([['sub-1', 'Read']]));
    agents.set(1, agent);
    handler.registerAgent('sess-1', 1);

    handler.handleEvent('claude', {
      hook_event_name: 'PermissionRequest',
      session_id: 'sess-1',
    });

    const subMsg = mockWebview.messages.find((m) => m.type === 'subagentToolPermission');
    expect(subMsg).toBeTruthy();
    expect(subMsg?.parentToolId).toBe('tool-parent');
  });

  // 4. Notification permission_prompt shows bubble
  it('Notification permission_prompt sends agentToolPermission', () => {
    const agent = createTestAgent({ id: 1 });
    agents.set(1, agent);
    handler.registerAgent('sess-1', 1);

    handler.handleEvent('claude', {
      hook_event_name: 'Notification',
      session_id: 'sess-1',
      notification_type: 'permission_prompt',
    });

    const msg = mockWebview.messages.find((m) => m.type === 'agentToolPermission');
    expect(msg).toBeTruthy();
    expect(agent.permissionSent).toBe(true);
  });

  // 5. Notification idle_prompt marks waiting
  it('Notification idle_prompt marks agent waiting', () => {
    const agent = createTestAgent({ id: 1 });
    agents.set(1, agent);
    handler.registerAgent('sess-1', 1);

    handler.handleEvent('claude', {
      hook_event_name: 'Notification',
      session_id: 'sess-1',
      notification_type: 'idle_prompt',
    });

    expect(agent.isWaiting).toBe(true);
    const msg = mockWebview.messages.find(
      (m) => m.type === 'agentStatus' && m.status === 'waiting',
    );
    expect(msg).toBeTruthy();
  });

  // 6. Stop marks agent waiting
  it('Stop marks agent waiting', () => {
    const agent = createTestAgent({ id: 1 });
    agents.set(1, agent);
    handler.registerAgent('sess-1', 1);

    handler.handleEvent('claude', {
      hook_event_name: 'Stop',
      session_id: 'sess-1',
    });

    expect(agent.isWaiting).toBe(true);
    // agentToolsClear only sent when there are foreground tools
    // With empty tools, only agentStatus waiting is sent
    const waitMsg = mockWebview.messages.find(
      (m) => m.type === 'agentStatus' && m.status === 'waiting',
    );
    expect(waitMsg).toBeTruthy();
  });

  // 7. Stop clears foreground tools, preserves background
  it('Stop clears foreground tools but preserves background agents', () => {
    const agent = createTestAgent({ id: 1 });
    agent.activeToolIds.add('fg-tool');
    agent.activeToolStatuses.set('fg-tool', 'Running');
    agent.activeToolNames.set('fg-tool', 'Bash');
    agent.activeToolIds.add('bg-tool');
    agent.activeToolStatuses.set('bg-tool', 'Background task');
    agent.activeToolNames.set('bg-tool', 'Agent');
    agent.backgroundAgentToolIds.add('bg-tool');
    agents.set(1, agent);
    handler.registerAgent('sess-1', 1);

    handler.handleEvent('claude', {
      hook_event_name: 'Stop',
      session_id: 'sess-1',
    });

    // Foreground cleared
    expect(agent.activeToolIds.has('fg-tool')).toBe(false);
    // Background preserved
    expect(agent.activeToolIds.has('bg-tool')).toBe(true);
    // agentToolsClear was sent (had foreground tools)
    const clearMsg = mockWebview.messages.find((m) => m.type === 'agentToolsClear');
    expect(clearMsg).toBeTruthy();
    // Background tool re-sent
    const reSent = mockWebview.messages.find(
      (m) => m.type === 'agentToolStart' && m.toolId === 'bg-tool',
    );
    expect(reSent).toBeTruthy();
  });

  // 8. Sets hookDelivered flag
  it('sets hookDelivered flag on agent', () => {
    const agent = createTestAgent({ id: 1 });
    (agent as AgentState & { hookDelivered?: boolean }).hookDelivered = false;
    agents.set(1, agent);
    handler.registerAgent('sess-1', 1);

    handler.handleEvent('claude', {
      hook_event_name: 'Stop',
      session_id: 'sess-1',
    });

    expect((agent as AgentState & { hookDelivered?: boolean }).hookDelivered).toBe(true);
  });

  // 9. Buffers events for unknown session
  it('buffers events for unknown session', () => {
    // No agent registered for 'unknown-sess'
    handler.handleEvent('claude', {
      hook_event_name: 'Stop',
      session_id: 'unknown-sess',
    });

    // No messages sent (buffered)
    expect(mockWebview.messages).toHaveLength(0);
  });

  // 10. Flushes buffer on registerAgent
  it('flushes buffered events on registerAgent', () => {
    const agent = createTestAgent({ id: 1 });
    agents.set(1, agent);

    // Buffer event before registration
    handler.handleEvent('claude', {
      hook_event_name: 'Stop',
      session_id: 'sess-1',
    });
    expect(mockWebview.messages).toHaveLength(0);

    // Register triggers flush
    handler.registerAgent('sess-1', 1);

    const waitMsg = mockWebview.messages.find(
      (m) => m.type === 'agentStatus' && m.status === 'waiting',
    );
    expect(waitMsg).toBeTruthy();
  });

  // 11. Prunes expired buffered events
  it('prunes expired buffered events', async () => {
    // Buffer an event
    handler.handleEvent('claude', {
      hook_event_name: 'Stop',
      session_id: 'expired-sess',
    });

    // Wait well past HOOK_EVENT_BUFFER_MS (5000) + prune interval cycle
    await new Promise((r) => setTimeout(r, 7000));

    // Now register -- event should have been pruned
    const agent = createTestAgent({ id: 2 });
    agents.set(2, agent);
    handler.registerAgent('expired-sess', 2);

    // No messages (event was pruned)
    expect(mockWebview.messages).toHaveLength(0);

    handler.dispose();
  });

  // 12. Auto-discovers agent by sessionId
  it('auto-discovers agent by sessionId field', () => {
    const agent = createTestAgent({ id: 1 });
    (agent as AgentState & { sessionId?: string }).sessionId = 'auto-sess';
    agents.set(1, agent);
    // Don't explicitly register

    handler.handleEvent('claude', {
      hook_event_name: 'Stop',
      session_id: 'auto-sess',
    });

    expect(agent.isWaiting).toBe(true);
  });

  // 13. Dispose cleans up
  it('dispose cleans up timers and maps', () => {
    handler.registerAgent('sess-1', 1);
    handler.handleEvent('claude', {
      hook_event_name: 'Stop',
      session_id: 'buffered-sess',
    });

    handler.dispose();

    // Internal state cleaned (no way to inspect directly, but no crash on subsequent calls)
    expect(() => handler.dispose()).not.toThrow();
  });
});
