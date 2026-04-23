import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processTranscriptLine } from '../../src/transcriptParser.js';
import type { AgentState } from '../../src/types.js';

type PostedMessage = { type: string; [key: string]: unknown };

function createAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 1,
    sessionId: 'sess-1',
    isExternal: false,
    projectDir: '/tmp/project',
    jsonlFile: '/tmp/project/sess-1.jsonl',
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
    ...overrides,
  };
}

function createWebview(): { posted: PostedMessage[]; postMessage: (msg: unknown) => void } {
  const posted: PostedMessage[] = [];
  return {
    posted,
    postMessage(msg: unknown) {
      posted.push(msg as PostedMessage);
    },
  };
}

function runLine(
  agent: AgentState,
  record: unknown,
  webview: { postMessage: (msg: unknown) => void },
): void {
  const agents = new Map<number, AgentState>([[agent.id, agent]]);
  processTranscriptLine(
    agent.id,
    JSON.stringify(record),
    agents,
    new Map(),
    new Map(),
    webview as Parameters<typeof processTranscriptLine>[5],
  );
}

describe('processTranscriptLine — Skill invocations (slash-command expansion)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits synthetic Skill start on string content with <command-name>', () => {
    const agent = createAgent();
    const webview = createWebview();

    runLine(
      agent,
      {
        type: 'user',
        message: {
          content:
            '<command-name>/superpowers:brainstorming</command-name>\n<command-args></command-args>',
        },
      },
      webview,
    );

    const status = webview.posted.find((m) => m.type === 'agentStatus');
    const start = webview.posted.find((m) => m.type === 'agentToolStart');
    expect(status).toMatchObject({ type: 'agentStatus', id: 1, status: 'active' });
    expect(start).toMatchObject({
      type: 'agentToolStart',
      id: 1,
      toolName: 'Skill',
      status: 'Skill: superpowers:brainstorming',
    });
    expect(agent.activeSkillToolId).toBeTruthy();
    expect(agent.hadToolsInTurn).toBe(true);
  });

  it('emits synthetic Skill start on array content with "Base directory for this skill:" marker', () => {
    const agent = createAgent();
    const webview = createWebview();

    runLine(
      agent,
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'text',
              text: 'Base directory for this skill: /Users/foo/.claude/skills/graphify\n\nSKILL.md contents...',
            },
          ],
        },
      },
      webview,
    );

    const start = webview.posted.find((m) => m.type === 'agentToolStart');
    expect(start).toMatchObject({
      type: 'agentToolStart',
      id: 1,
      toolName: 'Skill',
      status: 'Skill: graphify',
    });
  });

  it('does not emit Skill events for ordinary user text prompts', () => {
    const agent = createAgent();
    const webview = createWebview();

    runLine(
      agent,
      { type: 'user', message: { content: 'please refactor this function' } },
      webview,
    );

    expect(webview.posted.some((m) => m.type === 'agentToolStart')).toBe(false);
    expect(agent.activeSkillToolId).toBeFalsy();
  });

  it('ends active Skill on turn_duration (system record)', () => {
    const agent = createAgent();
    const webview = createWebview();

    runLine(
      agent,
      {
        type: 'user',
        message: { content: '<command-name>/superpowers:brainstorming</command-name>' },
      },
      webview,
    );
    const skillToolId = agent.activeSkillToolId;
    expect(skillToolId).toBeTruthy();

    runLine(agent, { type: 'system', subtype: 'turn_duration', duration_ms: 1000 }, webview);

    expect(agent.activeSkillToolId).toBeNull();
    // agentToolDone is delayed via setTimeout(TOOL_DONE_DELAY_MS = 300ms)
    vi.advanceTimersByTime(300);
    const done = webview.posted.find((m) => m.type === 'agentToolDone' && m.toolId === skillToolId);
    expect(done).toMatchObject({ type: 'agentToolDone', id: 1, toolId: skillToolId });
  });

  it('ends active Skill when a new user text prompt starts the next turn', () => {
    const agent = createAgent();
    const webview = createWebview();

    runLine(
      agent,
      {
        type: 'user',
        message: { content: '<command-name>/superpowers:brainstorming</command-name>' },
      },
      webview,
    );
    const skillToolId = agent.activeSkillToolId;

    // Simulate a brand new user prompt as array content (no tool_result) — arrives after turn done
    runLine(
      agent,
      { type: 'user', message: { content: [{ type: 'text', text: 'thanks, now do X' }] } },
      webview,
    );

    expect(agent.activeSkillToolId).toBeNull();
    vi.advanceTimersByTime(300);
    const done = webview.posted.find((m) => m.type === 'agentToolDone' && m.toolId === skillToolId);
    expect(done).toBeDefined();
  });

  it('back-to-back Skill invocations: second start ends the first', () => {
    const agent = createAgent();
    const webview = createWebview();

    runLine(
      agent,
      {
        type: 'user',
        message: { content: '<command-name>/superpowers:brainstorming</command-name>' },
      },
      webview,
    );
    const firstId = agent.activeSkillToolId;

    runLine(
      agent,
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'text',
              text: 'Base directory for this skill: /Users/foo/.claude/skills/graphify',
            },
          ],
        },
      },
      webview,
    );
    const secondId = agent.activeSkillToolId;

    expect(firstId).not.toBe(secondId);
    expect(secondId).toBeTruthy();
    vi.advanceTimersByTime(300);
    const doneForFirst = webview.posted.find(
      (m) => m.type === 'agentToolDone' && m.toolId === firstId,
    );
    expect(doneForFirst).toBeDefined();
  });
});
