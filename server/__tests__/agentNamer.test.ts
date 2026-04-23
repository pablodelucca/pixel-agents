import { describe, expect, it } from 'vitest';

import { parseRefinedName } from '../../src/agentNamer.js';
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

describe('parseRefinedName', () => {
  it('accepts 1 lowercase word', () => {
    expect(parseRefinedName('orquestrador')).toBe('orquestrador');
  });

  it('accepts 2 lowercase words', () => {
    expect(parseRefinedName('obsidian escritor')).toBe('obsidian escritor');
  });

  it('accepts 3 lowercase words', () => {
    expect(parseRefinedName('pixel-agents orquestrador marketing')).toBe(
      'pixel-agents orquestrador marketing',
    );
  });

  it('trims surrounding whitespace and trailing newline', () => {
    expect(parseRefinedName('  obsidian escritor \n')).toBe('obsidian escritor');
  });

  it('accepts accented chars', () => {
    expect(parseRefinedName('pesquisa avançada')).toBe('pesquisa avançada');
  });

  it('rejects uppercase', () => {
    expect(parseRefinedName('Obsidian Escritor')).toBeNull();
  });

  it('rejects punctuation', () => {
    expect(parseRefinedName('obsidian, escritor')).toBeNull();
  });

  it('rejects more than 3 words', () => {
    expect(parseRefinedName('a b c d')).toBeNull();
  });

  it('rejects empty and whitespace-only', () => {
    expect(parseRefinedName('')).toBeNull();
    expect(parseRefinedName('   ')).toBeNull();
  });

  it('rejects strings longer than 30 chars', () => {
    expect(parseRefinedName('a'.repeat(31))).toBeNull();
  });
});
