import assert from 'node:assert/strict';
import test from 'node:test';

test('claude provider keeps the historical terminal label format', async () => {
  const { claudeProvider } = await import('../src/providers/claude/claudeProvider.ts');

  assert.equal(claudeProvider.terminalLabel(3), 'Claude Code #3');
  assert.match(claudeProvider.terminalLabel(12), /^Claude Code #\d+$/);
});

test('claude provider builds the expected launch command', async () => {
  const { claudeProvider } = await import('../src/providers/claude/claudeProvider.ts');

  assert.equal(
    claudeProvider.buildLaunchCommand({
      sessionId: 'session-123',
      bypassPermissions: false,
    }),
    'claude --session-id session-123',
  );

  assert.equal(
    claudeProvider.buildLaunchCommand({
      sessionId: 'session-123',
      bypassPermissions: true,
    }),
    'claude --session-id session-123 --dangerously-skip-permissions',
  );
});
