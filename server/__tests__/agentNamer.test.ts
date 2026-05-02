import { describe, expect, it, vi } from 'vitest';

import {
  computeHeuristicLabel,
  detectTransition,
  maybeRefineTaskLabel,
  parseRefinedName,
  recordToolUse,
} from '../../src/agentNamer.js';
import type { AgentState } from '../../src/types.js';

type WebviewLike = Parameters<typeof maybeRefineTaskLabel>[1];

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

  it('rejects strings longer than 40 chars', () => {
    expect(parseRefinedName('a'.repeat(41))).toBeNull();
  });
});

describe('computeHeuristicLabel (Phase 2 upgrade)', () => {
  it('returns just workspace when no tools used yet', () => {
    const agent = createAgent({ recentTools: [] });
    expect(computeHeuristicLabel(agent)).toBe('pixel-agents');
  });

  it('returns "[workspace] escritor" when Write+Edit dominate', () => {
    const agent = createAgent({
      recentTools: ['Write', 'Edit', 'Write', 'Edit', 'Read'],
    });
    expect(computeHeuristicLabel(agent)).toBe('pixel-agents escritor');
  });

  it('returns "[workspace] pesquisador" when Read+Grep dominate', () => {
    const agent = createAgent({
      recentTools: ['Read', 'Grep', 'Glob', 'Read', 'Write'],
    });
    expect(computeHeuristicLabel(agent)).toBe('pixel-agents pesquisador');
  });

  it('returns "[workspace] orquestrador" when Task count >= 2 (beats other dominants)', () => {
    const agent = createAgent({
      recentTools: ['Task', 'Task', 'Read', 'Read', 'Read'],
    });
    expect(computeHeuristicLabel(agent)).toBe('pixel-agents orquestrador');
  });

  it('returns "[workspace] operador" when Bash dominates (>50%)', () => {
    const agent = createAgent({
      recentTools: ['Bash', 'Bash', 'Bash', 'Read'],
    });
    expect(computeHeuristicLabel(agent)).toBe('pixel-agents operador');
  });

  it('omits role when no category dominates', () => {
    const agent = createAgent({
      recentTools: ['Read', 'Write', 'Bash', 'Read', 'Write', 'Bash'],
    });
    expect(computeHeuristicLabel(agent)).toBe('pixel-agents');
  });

  it('uses skill name as context when an active skill exists', () => {
    const agent = createAgent({
      projectDir: '/Users/x/repo',
      recentTools: ['Write', 'Edit'],
      activeSkillToolId: 'skill-abc',
      activeToolStatuses: new Map([['skill-abc', 'Skill: superpowers:brainstorming']]),
    });
    expect(computeHeuristicLabel(agent)).toBe('brainstorming escritor');
  });

  it('strips plugin prefix from skill context (superpowers:brainstorming → brainstorming)', () => {
    const agent = createAgent({
      activeSkillToolId: 'skill-abc',
      activeToolStatuses: new Map([['skill-abc', 'Skill: superpowers:brainstorming']]),
      recentTools: [],
    });
    expect(computeHeuristicLabel(agent)).toBe('brainstorming');
  });

  it('lowercases PascalCase workspace names', () => {
    const agent = createAgent({ projectDir: '/Users/x/PiMindIA', recentTools: [] });
    expect(computeHeuristicLabel(agent)).toBe('pimindia');
  });

  it('returns "claude" for workspaces containing .claude', () => {
    const agent = createAgent({ projectDir: '/Users/x/.claude', recentTools: [] });
    expect(computeHeuristicLabel(agent)).toBe('claude');
  });

  it('only considers the most recent NAMER_TOOL_HISTOGRAM_WINDOW entries', () => {
    const old = Array<string>(10).fill('Write');
    const recent = Array<string>(30).fill('Read');
    const agent = createAgent({ recentTools: [...old, ...recent] });
    expect(computeHeuristicLabel(agent)).toBe('pixel-agents pesquisador');
  });
});

describe('recordToolUse', () => {
  it('initializes recentTools if absent', () => {
    const agent = createAgent({ recentTools: undefined });
    recordToolUse(agent, 'Read');
    expect(agent.recentTools).toEqual(['Read']);
  });

  it('appends in order', () => {
    const agent = createAgent({ recentTools: [] });
    recordToolUse(agent, 'Read');
    recordToolUse(agent, 'Write');
    expect(agent.recentTools).toEqual(['Read', 'Write']);
  });

  it('caps the window at NAMER_TOOL_HISTOGRAM_WINDOW', () => {
    const agent = createAgent({ recentTools: [] });
    for (let i = 0; i < 40; i++) {
      recordToolUse(agent, `Tool${i}`);
    }
    expect(agent.recentTools?.length).toBe(30);
    expect(agent.recentTools?.[0]).toBe('Tool10'); // oldest kept
    expect(agent.recentTools?.[29]).toBe('Tool39'); // newest
  });
});

describe('detectTransition', () => {
  const baseSignals = {
    cwdBase: 'pixel-agents',
    lastSkill: null,
    toolHistogram: { Read: 5, Write: 5 },
    messageCountAtLastRefine: 0,
    heuristicRole: 'escritor' as string | null,
  };

  it('returns true when no prior snapshot exists (first call)', () => {
    const agent = createAgent({ nameSignals: undefined, lastLlmRefineAt: 0 });
    expect(detectTransition(agent, 100_000)).toBe(true);
  });

  it('returns false when no signal changed', () => {
    const agent = createAgent({
      recentTools: ['Read', 'Read', 'Read', 'Read', 'Read'],
      messageCount: 0,
      lastLlmRefineAt: 0,
    });
    agent.nameSignals = {
      ...baseSignals,
      heuristicRole: 'pesquisador',
      toolHistogram: { Read: 5 },
    };
    expect(detectTransition(agent, 200_000)).toBe(false);
  });

  it('returns true when the active skill changed', () => {
    const agent = createAgent({
      nameSignals: { ...baseSignals, lastSkill: null },
      activeSkillToolId: 'skill-1',
      activeToolStatuses: new Map([['skill-1', 'Skill: graphify']]),
      recentTools: [],
      messageCount: 0,
      lastLlmRefineAt: 0,
    });
    expect(detectTransition(agent, 200_000)).toBe(true);
  });

  it('returns true when heuristic role changed', () => {
    const agent = createAgent({
      nameSignals: { ...baseSignals, heuristicRole: 'escritor' },
      recentTools: ['Read', 'Read', 'Read', 'Read', 'Read'],
      messageCount: 0,
      lastLlmRefineAt: 0,
    });
    expect(detectTransition(agent, 200_000)).toBe(true);
  });

  it('returns false within throttle window (< 90s since last refine)', () => {
    const agent = createAgent({
      nameSignals: { ...baseSignals, heuristicRole: 'escritor' },
      recentTools: ['Read', 'Read', 'Read', 'Read', 'Read'],
      lastLlmRefineAt: 150_000,
      messageCount: 0,
    });
    expect(detectTransition(agent, 150_000 + 60_000)).toBe(false);
  });
});

describe('maybeRefineTaskLabel', () => {
  const NOW = 1_000_000;

  /** Build a minimal eligible agent: created long enough ago and no prior signals → transition fires. */
  function eligibleAgent(overrides: Partial<AgentState> = {}): AgentState {
    return createAgent({
      createdAt: NOW - 120_000, // 2 min old → eligible
      messageCount: 0,
      recentTools: ['Write', 'Edit', 'Write', 'Edit'],
      nameSignals: undefined,
      lastLlmRefineAt: 0,
      llmRefineCount: 0,
      ...overrides,
    });
  }

  function makeWebview(): { webview: WebviewLike; postMessage: ReturnType<typeof vi.fn> } {
    const postMessage = vi.fn();
    return { webview: { postMessage } as unknown as WebviewLike, postMessage };
  }

  const noBullets = vi.fn().mockResolvedValue([] as string[]);

  it('skips sub-agents (id < 0)', async () => {
    const agent = eligibleAgent({ id: -1 });
    const refineFn = vi.fn().mockResolvedValue('foo');
    await maybeRefineTaskLabel(agent, undefined, noBullets, NOW, refineFn);
    expect(refineFn).not.toHaveBeenCalled();
  });

  it('skips when llmRefineDisabled', async () => {
    const agent = eligibleAgent({ llmRefineDisabled: true });
    const refineFn = vi.fn().mockResolvedValue('foo');
    await maybeRefineTaskLabel(agent, undefined, noBullets, NOW, refineFn);
    expect(refineFn).not.toHaveBeenCalled();
  });

  it('skips when a refine is already in flight', async () => {
    const agent = eligibleAgent({ llmRefineInFlight: true });
    const refineFn = vi.fn().mockResolvedValue('foo');
    await maybeRefineTaskLabel(agent, undefined, noBullets, NOW, refineFn);
    expect(refineFn).not.toHaveBeenCalled();
  });

  it('skips when budget is exhausted', async () => {
    const agent = eligibleAgent({ llmRefineCount: 20 });
    const refineFn = vi.fn().mockResolvedValue('foo');
    await maybeRefineTaskLabel(agent, undefined, noBullets, NOW, refineFn);
    expect(refineFn).not.toHaveBeenCalled();
  });

  it('skips when neither age nor message threshold is met', async () => {
    const agent = eligibleAgent({
      createdAt: NOW - 1_000, // 1s — below 60s
      messageCount: 0,
    });
    const refineFn = vi.fn().mockResolvedValue('foo');
    await maybeRefineTaskLabel(agent, undefined, noBullets, NOW, refineFn);
    expect(refineFn).not.toHaveBeenCalled();
  });

  it('proceeds when message threshold is met even if young', async () => {
    const agent = eligibleAgent({
      createdAt: NOW - 1_000,
      messageCount: 5,
    });
    const refineFn = vi.fn().mockResolvedValue('obsidian escritor');
    await maybeRefineTaskLabel(agent, undefined, noBullets, NOW, refineFn);
    expect(refineFn).toHaveBeenCalledTimes(1);
  });

  it('skips when no transition is detected', async () => {
    // Snapshot matches current state exactly → no transition.
    const agent = eligibleAgent({
      recentTools: ['Read', 'Read', 'Read', 'Read', 'Read'],
      nameSignals: {
        cwdBase: 'pixel-agents',
        lastSkill: null,
        toolHistogram: { Read: 5 },
        messageCountAtLastRefine: 0,
        heuristicRole: 'pesquisador',
      },
      lastLlmRefineAt: NOW - 200_000, // outside throttle window
    });
    const refineFn = vi.fn().mockResolvedValue('foo');
    await maybeRefineTaskLabel(agent, undefined, noBullets, NOW, refineFn);
    expect(refineFn).not.toHaveBeenCalled();
  });

  it('on success: mutates taskLabel, posts agentLabelUpdated, resets failures', async () => {
    const agent = eligibleAgent({ llmRefineConsecutiveFailures: 2 });
    const { webview, postMessage } = makeWebview();
    const refineFn = vi.fn().mockResolvedValue('obsidian escritor');

    await maybeRefineTaskLabel(agent, webview, noBullets, NOW, refineFn);

    expect(agent.taskLabel).toBe('obsidian escritor');
    expect(agent.llmRefineCount).toBe(1);
    expect(agent.lastLlmRefineAt).toBe(NOW);
    expect(agent.llmRefineConsecutiveFailures).toBe(0);
    expect(agent.llmRefineDisabled).not.toBe(true);
    expect(agent.llmRefineInFlight).toBe(false);
    expect(agent.nameSignals).toBeDefined();
    expect(postMessage).toHaveBeenCalledWith({
      type: 'agentLabelUpdated',
      id: agent.id,
      label: 'obsidian escritor',
      source: 'llm',
    });
  });

  it('on failure (1st): increments counter, does NOT disable yet', async () => {
    const agent = eligibleAgent();
    const { webview, postMessage } = makeWebview();
    const refineFn = vi.fn().mockResolvedValue(null);

    await maybeRefineTaskLabel(agent, webview, noBullets, NOW, refineFn);

    expect(agent.llmRefineConsecutiveFailures).toBe(1);
    expect(agent.llmRefineDisabled).not.toBe(true);
    expect(agent.taskLabel).toBeUndefined();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('on 3rd consecutive failure: sets llmRefineDisabled', async () => {
    const agent = eligibleAgent({ llmRefineConsecutiveFailures: 2 });
    const refineFn = vi.fn().mockResolvedValue(null);

    await maybeRefineTaskLabel(agent, undefined, noBullets, NOW, refineFn);

    expect(agent.llmRefineConsecutiveFailures).toBe(3);
    expect(agent.llmRefineDisabled).toBe(true);
  });

  it('success after failures resets the consecutive counter to 0', async () => {
    const agent = eligibleAgent({ llmRefineConsecutiveFailures: 2 });
    const refineFn = vi.fn().mockResolvedValue('obsidian');

    await maybeRefineTaskLabel(agent, undefined, noBullets, NOW, refineFn);

    expect(agent.llmRefineConsecutiveFailures).toBe(0);
    expect(agent.llmRefineDisabled).not.toBe(true);
  });

  it('skips when heuristic label is empty (no workspace, no role)', async () => {
    // projectDir + folderName both falsy-ish: empty workspace label
    const agent = eligibleAgent({
      projectDir: '',
      folderName: '',
      recentTools: [],
    });
    const refineFn = vi.fn().mockResolvedValue('foo');

    await maybeRefineTaskLabel(agent, undefined, noBullets, NOW, refineFn);

    // Heuristic empty → early return BEFORE refineFn but AFTER setting llmRefineInFlight
    // and incrementing nothing. We just verify refineFn not called.
    expect(refineFn).not.toHaveBeenCalled();
    expect(agent.llmRefineInFlight).toBe(false); // finally block resets it
  });
});
