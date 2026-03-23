import assert from 'node:assert/strict';
import test from 'node:test';

import { getSessionDisplayName } from './sessionDisplayName.js';

test('omits raw thread ids for single-workspace sessions', () => {
  const displayName = getSessionDisplayName(
    ['C:\\Users\\Moham\\Documents\\Docker\\codex-office\\pixel-agents-codex'],
    'C:\\Users\\Moham\\Documents\\Docker\\codex-office\\pixel-agents-codex',
    '019d127a-ec41-7d21-a7ae-85cf610d4a1c',
  );

  assert.equal(displayName, undefined);
});

test('uses the workspace folder name in multi-root workspaces when no readable thread name exists', () => {
  const displayName = getSessionDisplayName(
    [
      'C:\\Users\\Moham\\Documents\\Docker\\codex-office\\pixel-agents-codex',
      'C:\\Users\\Moham\\Documents\\Docker\\codex-office\\kavita',
    ],
    'C:\\Users\\Moham\\Documents\\Docker\\codex-office\\pixel-agents-codex',
    undefined,
  );

  assert.equal(displayName, 'pixel-agents-codex');
});

test('keeps readable thread names', () => {
  const displayName = getSessionDisplayName(
    ['C:\\Users\\Moham\\Documents\\Docker\\codex-office\\pixel-agents-codex'],
    'C:\\Users\\Moham\\Documents\\Docker\\codex-office\\pixel-agents-codex',
    'Summarize package.json',
  );

  assert.equal(displayName, 'Summarize package.json');
});
