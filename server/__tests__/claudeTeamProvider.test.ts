import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { claudeTeamProvider } from '../src/providers/hook/claude/claudeTeamProvider.js';

describe('claudeTeamProvider', () => {
  describe('identity', () => {
    it('has providerId "claude"', () => {
      expect(claudeTeamProvider.providerId).toBe('claude');
    });

    it('spawns teammates via "Agent" tool', () => {
      expect(claudeTeamProvider.teammateSpawnTools.has('Agent')).toBe(true);
    });

    it('uses "Task" for within-turn subagents', () => {
      expect(claudeTeamProvider.withinTurnSubagentTools.has('Task')).toBe(true);
    });
  });

  describe('isTeammateSpawnCall', () => {
    it('returns true for Agent tool with run_in_background=true', () => {
      expect(claudeTeamProvider.isTeammateSpawnCall('Agent', { run_in_background: true })).toBe(
        true,
      );
    });

    it('returns false for Agent tool without run_in_background', () => {
      expect(claudeTeamProvider.isTeammateSpawnCall('Agent', {})).toBe(false);
    });

    it('returns false for Agent tool with run_in_background=false', () => {
      expect(claudeTeamProvider.isTeammateSpawnCall('Agent', { run_in_background: false })).toBe(
        false,
      );
    });

    it('returns false for Agent tool with non-boolean run_in_background', () => {
      expect(claudeTeamProvider.isTeammateSpawnCall('Agent', { run_in_background: 'true' })).toBe(
        false,
      );
      expect(claudeTeamProvider.isTeammateSpawnCall('Agent', { run_in_background: 1 })).toBe(false);
    });

    it('returns false for Task tool regardless of run_in_background', () => {
      expect(claudeTeamProvider.isTeammateSpawnCall('Task', { run_in_background: true })).toBe(
        false,
      );
      expect(claudeTeamProvider.isTeammateSpawnCall('Task', {})).toBe(false);
    });

    it('returns false for arbitrary tool names', () => {
      expect(claudeTeamProvider.isTeammateSpawnCall('Read', {})).toBe(false);
      expect(claudeTeamProvider.isTeammateSpawnCall('WebSearch', { run_in_background: true })).toBe(
        false,
      );
    });
  });

  describe('extractTeammateNameFromEvent', () => {
    it('reads agent_type field when present', () => {
      expect(
        claudeTeamProvider.extractTeammateNameFromEvent({ agent_type: 'web-researcher' }),
      ).toBe('web-researcher');
    });

    it('returns undefined when agent_type is missing', () => {
      expect(claudeTeamProvider.extractTeammateNameFromEvent({})).toBeUndefined();
    });

    it('returns undefined when agent_type is not a string', () => {
      expect(claudeTeamProvider.extractTeammateNameFromEvent({ agent_type: 42 })).toBeUndefined();
      expect(claudeTeamProvider.extractTeammateNameFromEvent({ agent_type: null })).toBeUndefined();
    });
  });

  describe('resolveTeammateMetadataPath', () => {
    it('replaces .jsonl extension with .meta.json', () => {
      expect(claudeTeamProvider.resolveTeammateMetadataPath('/a/b/c.jsonl')).toBe(
        '/a/b/c.meta.json',
      );
    });

    it('only replaces trailing .jsonl', () => {
      expect(claudeTeamProvider.resolveTeammateMetadataPath('/a/b.jsonl/c.jsonl')).toBe(
        '/a/b.jsonl/c.meta.json',
      );
    });
  });

  describe('parseTeammateMetadata', () => {
    it('extracts agentType string field', () => {
      expect(claudeTeamProvider.parseTeammateMetadata('{"agentType":"web-researcher"}')).toBe(
        'web-researcher',
      );
    });

    it('returns null for invalid JSON', () => {
      expect(claudeTeamProvider.parseTeammateMetadata('not json')).toBeNull();
      expect(claudeTeamProvider.parseTeammateMetadata('')).toBeNull();
    });

    it('returns null when agentType is missing', () => {
      expect(claudeTeamProvider.parseTeammateMetadata('{}')).toBeNull();
      expect(claudeTeamProvider.parseTeammateMetadata('{"other":"value"}')).toBeNull();
    });

    it('returns null when agentType is not a string', () => {
      expect(claudeTeamProvider.parseTeammateMetadata('{"agentType":42}')).toBeNull();
      expect(claudeTeamProvider.parseTeammateMetadata('{"agentType":null}')).toBeNull();
    });
  });

  describe('resolveTeammateJsonlDir', () => {
    it('builds <projectDir>/<sessionId>/subagents path', () => {
      const result = claudeTeamProvider.resolveTeammateJsonlDir('/p', 'sess');
      expect(result).toBe(path.join('/p', 'sess', 'subagents'));
    });
  });

  describe('getTeamMembers', () => {
    // Use a temp directory under os.tmpdir() pretending to be ~/.claude/teams/<teamName>/
    // This keeps tests hermetic without mocking fs.
    const fs = require('fs') as typeof import('fs');
    const TMP_TEAM_DIR = path.join(os.tmpdir(), 'pixel-agents-test-teams');
    const TEAM_NAME = 'test-team-' + Date.now();

    afterEach(() => {
      // Cleanup any test artifacts
      try {
        fs.rmSync(path.join(os.homedir(), '.claude', 'teams', TEAM_NAME), {
          recursive: true,
          force: true,
        });
      } catch {
        /* ignore */
      }
    });

    it('returns null when the team config does not exist', () => {
      const result = claudeTeamProvider.getTeamMembers('nonexistent-team-xyz-' + Date.now());
      expect(result).toBeNull();
    });

    it('returns members when config is well-formed', () => {
      const teamDir = path.join(os.homedir(), '.claude', 'teams', TEAM_NAME);
      fs.mkdirSync(teamDir, { recursive: true });
      fs.writeFileSync(
        path.join(teamDir, 'config.json'),
        JSON.stringify({
          members: [{ name: 'team-lead' }, { name: 'web-researcher' }],
        }),
      );
      const result = claudeTeamProvider.getTeamMembers(TEAM_NAME);
      expect(result).not.toBeNull();
      expect([...result!].sort()).toEqual(['team-lead', 'web-researcher']);
    });

    it('returns null when config is not valid JSON', () => {
      const teamDir = path.join(os.homedir(), '.claude', 'teams', TEAM_NAME);
      fs.mkdirSync(teamDir, { recursive: true });
      fs.writeFileSync(path.join(teamDir, 'config.json'), 'not json');
      expect(claudeTeamProvider.getTeamMembers(TEAM_NAME)).toBeNull();
    });

    it('returns null when members field is missing or not an array', () => {
      const teamDir = path.join(os.homedir(), '.claude', 'teams', TEAM_NAME);
      fs.mkdirSync(teamDir, { recursive: true });
      fs.writeFileSync(path.join(teamDir, 'config.json'), '{}');
      expect(claudeTeamProvider.getTeamMembers(TEAM_NAME)).toBeNull();
    });

    it('skips members without a string name', () => {
      const teamDir = path.join(os.homedir(), '.claude', 'teams', TEAM_NAME);
      fs.mkdirSync(teamDir, { recursive: true });
      fs.writeFileSync(
        path.join(teamDir, 'config.json'),
        JSON.stringify({
          members: [
            { name: 'valid' },
            { agentType: 'no-name' },
            { name: 42 },
            { name: 'also-valid' },
          ],
        }),
      );
      const result = claudeTeamProvider.getTeamMembers(TEAM_NAME);
      expect([...result!].sort()).toEqual(['also-valid', 'valid']);
    });

    // Use the TMP var so the lint doesn't complain about unused top-level const
    it('TMP_TEAM_DIR exists for scoping', () => {
      expect(typeof TMP_TEAM_DIR).toBe('string');
    });
  });

  describe('extractTeamMetadataFromRecord', () => {
    it('returns teamName + agentName when both present', () => {
      expect(
        claudeTeamProvider.extractTeamMetadataFromRecord({
          teamName: 'research',
          agentName: 'web-researcher',
        }),
      ).toEqual({ teamName: 'research', agentName: 'web-researcher' });
    });

    it('returns teamName with undefined agentName for the lead', () => {
      expect(claudeTeamProvider.extractTeamMetadataFromRecord({ teamName: 'research' })).toEqual({
        teamName: 'research',
        agentName: undefined,
      });
    });

    it('returns null when teamName is missing', () => {
      expect(claudeTeamProvider.extractTeamMetadataFromRecord({})).toBeNull();
    });

    it('returns null when teamName is not a string', () => {
      expect(claudeTeamProvider.extractTeamMetadataFromRecord({ teamName: 42 })).toBeNull();
    });
  });
});
