import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AGENT_PROVIDER_ID,
  resolveProviderAdapter,
  type StoredAgentProviderConfig,
} from '../src/agentProvider.js';

describe('resolveProviderAdapter', () => {
  it('returns Claude defaults when provider is undefined', () => {
    const adapter = resolveProviderAdapter(undefined);
    assert.equal(adapter.id, AGENT_PROVIDER_ID.CLAUDE);
    assert.equal(adapter.displayName, 'Claude Code');
    assert.equal(adapter.buildLaunchCommand('session-1'), 'claude --session-id session-1');
  });

  it('supports custom template placeholders', () => {
    const provider: StoredAgentProviderConfig = {
      id: AGENT_PROVIDER_ID.CUSTOM,
      customDisplayName: 'My Agent',
      customCommand: 'my-cli run --id {sessionId} {bypassFlag}',
      customProjectsRoot: '~/custom/projects',
    };
    const adapter = resolveProviderAdapter(provider);
    assert.equal(adapter.id, AGENT_PROVIDER_ID.CUSTOM);
    assert.equal(adapter.displayName, 'My Agent');
    assert.equal(
      adapter.buildLaunchCommand('abc', true),
      'my-cli run --id abc --dangerously-skip-permissions',
    );
    assert.equal(adapter.buildLaunchCommand('abc', false), 'my-cli run --id abc');
  });

  it('uses codex launch command compatible with recent codex CLI', () => {
    const adapter = resolveProviderAdapter({ id: AGENT_PROVIDER_ID.CODEX });
    assert.equal(adapter.id, AGENT_PROVIDER_ID.CODEX);
    assert.equal(adapter.buildLaunchCommand('session-1'), 'codex --no-alt-screen');
  });
});
