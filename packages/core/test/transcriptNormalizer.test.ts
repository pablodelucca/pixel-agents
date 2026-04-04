import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createParserState } from '../src/types.js';
import { normalizeTranscriptLine } from '../src/transcriptNormalizer.js';

describe('normalizeTranscriptLine', () => {
  it('emits tool start events for assistant tool_use blocks', () => {
    const state = createParserState();
    const line = JSON.stringify({
      type: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'Read',
          input: { file_path: '/tmp/a.ts' },
        },
      ],
    });

    const events = normalizeTranscriptLine(1, line, state);
    assert.equal(events[0]?.type, 'agentStatus');
    assert.equal(events[1]?.type, 'agentToolStart');
    assert.equal(state.activeToolIds.has('tool-1'), true);
  });

  it('emits tool done for matching tool_result', () => {
    const state = createParserState();
    normalizeTranscriptLine(
      1,
      JSON.stringify({
        type: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Edit', input: { file_path: 'x.ts' } }],
      }),
      state,
    );

    const events = normalizeTranscriptLine(
      1,
      JSON.stringify({
        type: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1' }],
      }),
      state,
    );

    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { type: 'agentToolDone', id: 1, toolId: 'tool-1' });
    assert.equal(state.activeToolIds.size, 0);
  });

  it('handles sub-agent progress events', () => {
    const state = createParserState();
    normalizeTranscriptLine(
      1,
      JSON.stringify({
        type: 'assistant',
        content: [{ type: 'tool_use', id: 'parent', name: 'Task', input: { description: 'Do X' } }],
      }),
      state,
    );

    const startEvents = normalizeTranscriptLine(
      1,
      JSON.stringify({
        type: 'progress',
        parentToolUseID: 'parent',
        data: {
          type: 'agent_progress',
          message: {
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', id: 'sub-1', name: 'Read', input: { file_path: 'a.ts' } },
              ],
            },
          },
        },
      }),
      state,
    );
    assert.equal(startEvents[0]?.type, 'subagentToolStart');

    const doneEvents = normalizeTranscriptLine(
      1,
      JSON.stringify({
        type: 'progress',
        parentToolUseID: 'parent',
        data: {
          type: 'agent_progress',
          message: {
            type: 'user',
            message: {
              content: [{ type: 'tool_result', tool_use_id: 'sub-1' }],
            },
          },
        },
      }),
      state,
    );
    assert.equal(doneEvents[0]?.type, 'subagentToolDone');
  });

  it('marks agent as waiting on turn_duration', () => {
    const state = createParserState();
    const events = normalizeTranscriptLine(
      1,
      JSON.stringify({ type: 'system', subtype: 'turn_duration' }),
      state,
    );
    assert.equal(events.at(-1)?.type, 'agentStatus');
    assert.equal(state.isWaiting, true);
  });
});
