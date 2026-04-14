import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOpenAgentMessage,
  getEnabledProviderOptions,
  resolveSelectedProvider,
} from '../src/providers/providerUi.ts';

test('buildOpenAgentMessage creates a provider-aware launch payload', () => {
  assert.deepEqual(
    buildOpenAgentMessage({
      providerId: 'codex',
      bypassPermissions: true,
      folderPath: 'C:/workspace/project',
    }),
    {
      type: 'openAgent',
      providerId: 'codex',
      bypassPermissions: true,
      folderPath: 'C:/workspace/project',
    },
  );
});

test('resolveSelectedProvider prefers the stored provider when it remains enabled', () => {
  assert.equal(resolveSelectedProvider(['claude', 'codex'], 'codex', 'claude'), 'codex');
});

test('resolveSelectedProvider falls back to the first enabled provider when needed', () => {
  assert.equal(resolveSelectedProvider(['codex'], 'claude', 'claude'), 'codex');
  assert.equal(resolveSelectedProvider(['codex'], undefined, 'claude'), 'codex');
});

test('getEnabledProviderOptions exposes stable labels for enabled providers only', () => {
  assert.deepEqual(getEnabledProviderOptions(['codex']), [
    {
      id: 'codex',
      label: 'Codex',
    },
  ]);
});
