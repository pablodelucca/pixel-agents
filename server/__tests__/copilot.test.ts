import { describe, expect, it } from 'vitest';

import { copilotProvider } from '../src/providers/hook/copilot/copilot.js';
import {
  extractSessionId,
  formatToolStatus,
  parseTranscriptLine,
} from '../src/providers/hook/copilot/copilotTranscriptParser.js';

describe('copilotProvider', () => {
  describe('identity', () => {
    it('has kind "hook"', () => {
      expect(copilotProvider.kind).toBe('hook');
    });
    it('has id "copilot"', () => {
      expect(copilotProvider.id).toBe('copilot');
    });
    it('has a displayName', () => {
      expect(copilotProvider.displayName).toBe('GitHub Copilot CLI');
    });
    it('has task in subagentToolNames', () => {
      expect(copilotProvider.subagentToolNames.has('task')).toBe(true);
    });
    it('does not have a TeamProvider (Claude-specific)', () => {
      expect(copilotProvider.team).toBeUndefined();
    });
    it('has correct sessionFilePattern for nested structure', () => {
      expect(copilotProvider.sessionFilePattern).toBe('*/events.jsonl');
    });
  });

  describe('normalizeHookEvent', () => {
    it('returns null (hooks not supported yet)', () => {
      expect(
        copilotProvider.normalizeHookEvent({
          hook_event_name: 'Stop',
          session_id: 'x',
        }),
      ).toBeNull();
    });
  });

  describe('areHooksInstalled', () => {
    it('returns false (hooks not supported yet)', async () => {
      expect(await copilotProvider.areHooksInstalled()).toBe(false);
    });
  });

  describe('buildLaunchCommand', () => {
    it('returns copilot --resume=<id> for existing session', () => {
      const result = copilotProvider.buildLaunchCommand?.('abc-123', '/home/user');
      expect(result?.command).toBe('copilot');
      expect(result?.args).toEqual(['--resume=abc-123']);
      expect(result?.env?.PWD).toBe('/home/user');
    });
    it('returns copilot without args for new session', () => {
      const result = copilotProvider.buildLaunchCommand?.('', '/home/user');
      expect(result?.command).toBe('copilot');
      expect(result?.args).toEqual([]);
    });
  });
});

describe('copilotTranscriptParser', () => {
  describe('parseTranscriptLine', () => {
    it('parses tool.execution_start events', () => {
      const line = JSON.stringify({
        type: 'tool.execution_start',
        data: {
          toolCallId: 'toolu_123',
          toolName: 'view',
          arguments: { path: '/foo/bar.ts' },
        },
      });
      const result = parseTranscriptLine(line);
      expect(result?.kind).toBe('toolStart');
      if (result?.kind === 'toolStart') {
        expect(result.toolId).toBe('toolu_123');
        expect(result.toolName).toBe('view');
        expect(result.input).toEqual({ path: '/foo/bar.ts' });
      }
    });

    it('parses tool.execution_complete events', () => {
      const line = JSON.stringify({
        type: 'tool.execution_complete',
        data: {
          toolCallId: 'toolu_123',
          success: true,
          result: { content: 'done' },
        },
      });
      const result = parseTranscriptLine(line);
      expect(result?.kind).toBe('toolEnd');
      if (result?.kind === 'toolEnd') {
        expect(result.toolId).toBe('toolu_123');
      }
    });

    it('parses assistant.turn_end events', () => {
      const line = JSON.stringify({
        type: 'assistant.turn_end',
        data: { turnId: '0' },
      });
      const result = parseTranscriptLine(line);
      expect(result?.kind).toBe('turnEnd');
    });

    it('parses user.message events', () => {
      const line = JSON.stringify({
        type: 'user.message',
        data: { content: 'Hello' },
      });
      const result = parseTranscriptLine(line);
      expect(result?.kind).toBe('userTurn');
    });

    it('parses session.start events', () => {
      const line = JSON.stringify({
        type: 'session.start',
        data: {
          sessionId: 'abc-123',
          producer: 'copilot-agent',
          copilotVersion: '1.0.0',
        },
      });
      const result = parseTranscriptLine(line);
      expect(result?.kind).toBe('sessionStart');
      if (result?.kind === 'sessionStart') {
        expect(result.source).toBe('copilot-agent');
      }
    });

    it('returns assistantStart for assistant.turn_start events', () => {
      const line = JSON.stringify({
        type: 'assistant.turn_start',
        data: { turnId: '0' },
      });
      const result = parseTranscriptLine(line);
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('assistantStart');
    });

    it('returns null for unknown event types', () => {
      const line = JSON.stringify({
        type: 'some.unknown.event',
        data: {},
      });
      expect(parseTranscriptLine(line)).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      expect(parseTranscriptLine('not json')).toBeNull();
      expect(parseTranscriptLine('')).toBeNull();
      expect(parseTranscriptLine('{broken')).toBeNull();
    });

    it('returns null for tool events missing required fields', () => {
      // Missing toolCallId
      const line1 = JSON.stringify({
        type: 'tool.execution_start',
        data: { toolName: 'view' },
      });
      expect(parseTranscriptLine(line1)).toBeNull();

      // Missing toolName
      const line2 = JSON.stringify({
        type: 'tool.execution_start',
        data: { toolCallId: 'toolu_123' },
      });
      expect(parseTranscriptLine(line2)).toBeNull();
    });
  });

  describe('formatToolStatus', () => {
    it('formats view with path', () => {
      expect(formatToolStatus('view', { path: '/a/b/c.ts' })).toBe('Reading c.ts');
    });

    it('formats edit with path', () => {
      expect(formatToolStatus('edit', { path: '/src/main.js' })).toBe('Editing main.js');
    });

    it('formats create with path', () => {
      expect(formatToolStatus('create', { path: '/new/file.txt' })).toBe('Creating file.txt');
    });

    it('formats bash with command', () => {
      expect(formatToolStatus('bash', { command: 'npm test' })).toBe('Running: npm test');
    });

    it('truncates long bash commands', () => {
      const longCmd =
        'npm run this-is-a-very-long-command-that-should-be-truncated-because-it-exceeds-the-limit';
      const result = formatToolStatus('bash', { command: longCmd });
      expect(result.length).toBeLessThan(100);
      expect(result.endsWith('…')).toBe(true);
    });

    it('formats task with description', () => {
      expect(formatToolStatus('task', { description: 'Code review' })).toBe('Subtask: Code review');
    });

    it('formats task without description', () => {
      expect(formatToolStatus('task', {})).toBe('Running subtask');
    });

    it('formats grep with pattern', () => {
      expect(formatToolStatus('grep', { pattern: 'TODO' })).toBe('Searching: TODO');
    });

    it('formats glob with pattern', () => {
      expect(formatToolStatus('glob', { pattern: '*.ts' })).toBe('Finding: *.ts');
    });

    it('formats web_fetch with URL', () => {
      expect(formatToolStatus('web_fetch', { url: 'https://github.com/foo/bar' })).toBe(
        'Fetching github.com',
      );
    });

    it('formats web_fetch with invalid URL', () => {
      expect(formatToolStatus('web_fetch', { url: 'not-a-url' })).toBe('Fetching web content');
    });

    it('formats web_search with query', () => {
      expect(formatToolStatus('web_search', { query: 'typescript generics' })).toBe(
        'Searching: typescript generics',
      );
    });

    it('formats sql with description', () => {
      expect(formatToolStatus('sql', { description: 'Count users' })).toBe('SQL: Count users');
    });

    it('formats GitHub MCP server tools', () => {
      expect(formatToolStatus('github-mcp-server-get_file_contents', {})).toBe(
        'GitHub: Reading file',
      );
      expect(formatToolStatus('github-mcp-server-list_issues', {})).toBe('GitHub: Listing issues');
      expect(formatToolStatus('github-mcp-server-unknown_tool', {})).toBe('GitHub: Unknown Tool');
    });

    it('formats known tools with display names', () => {
      expect(formatToolStatus('report_intent', {})).toBe('Setting intent');
      expect(formatToolStatus('ask_user', {})).toBe('Waiting for answer');
    });

    it('formats unknown tools with readable name', () => {
      expect(formatToolStatus('fancy_tool', {})).toBe('Using fancy tool');
    });

    it('handles undefined input', () => {
      expect(formatToolStatus('view', undefined)).toBe('Reading ');
      expect(formatToolStatus('bash', undefined)).toBe('Running: ');
    });
  });

  describe('extractSessionId', () => {
    it('extracts UUID from session directory path', () => {
      expect(extractSessionId('/home/user/.copilot/session-state/abc-123-def')).toBe('abc-123-def');
    });

    it('handles trailing slash', () => {
      expect(extractSessionId('/home/user/.copilot/session-state/abc-123/')).toBe('abc-123');
    });

    it('handles Windows-style paths', () => {
      // Note: path.basename works differently on different platforms,
      // but our implementation splits on /
      expect(extractSessionId('C:/Users/foo/.copilot/session-state/abc-123')).toBe('abc-123');
    });
  });
});
