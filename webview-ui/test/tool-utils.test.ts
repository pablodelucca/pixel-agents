import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatAgentStatusLabel } from '../src/agentVisibilityUtils.ts';
import { extractToolName } from '../src/office/toolUtils.ts';

test('prefers specific web search prefix over generic searching prefix', () => {
  assert.equal(extractToolName('Searching the web'), 'WebSearch');
});

test('maps Codex-native terminal polling and planning statuses to meaningful tools', () => {
  assert.equal(extractToolName('Reading terminal output'), 'Read');
  assert.equal(extractToolName('Writing terminal input'), 'Write');
  assert.equal(extractToolName('Planning'), 'NotebookEdit');
});

test('maps Codex subtask statuses to task animation', () => {
  assert.equal(extractToolName('Subtask: inspect the parser flow'), 'Task');
  assert.equal(extractToolName('Waiting on subtask'), 'Task');
});

test('formats active Codex lifecycle labels without falling back to idle', () => {
  assert.equal(formatAgentStatusLabel({ status: 'thinking' }), 'Thinking');
  assert.equal(formatAgentStatusLabel({ status: 'responding' }), 'Responding');
  assert.equal(formatAgentStatusLabel({ status: 'active' }), 'Active');
  assert.equal(formatAgentStatusLabel(undefined), 'Idle');
});
