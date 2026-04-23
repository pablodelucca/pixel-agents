import { describe, expect, it } from 'vitest';

import type { AgentState } from '../../src/types.js';

function createAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 1,
    sessionId: 'sess-1',
    isExternal: false,
    projectDir: '/Users/pimai/Documents/pixel-agents',
    jsonlFile: '/tmp/sess-1.jsonl',
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
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    inputTokens: 0,
    outputTokens: 0,
    recentTools: [],
    messageCount: 0,
    llmRefineCount: 0,
    lastLlmRefineAt: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('agentNamer', () => {
  it('placeholder — to be replaced by real tests', () => {
    expect(createAgent().id).toBe(1);
  });
});
