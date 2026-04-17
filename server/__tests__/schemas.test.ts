import { describe, expect, it } from 'vitest';

import { parseConfig, validateConfig } from '../../src/schemas/config.js';
import { hasValidLayoutStructure, parseLayout, validateLayout } from '../../src/schemas/layout.js';
import {
  parseTranscriptLine,
  validateTranscriptRecord,
} from '../../src/schemas/transcript.js';

describe('TranscriptRecordSchema', () => {
  describe('validateTranscriptRecord', () => {
    it('validates a minimal assistant record', () => {
      const record = { type: 'assistant' };
      const result = validateTranscriptRecord(record);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('assistant');
    });

    it('validates an assistant record with message content', () => {
      const record = {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Hello' }],
        },
      };
      const result = validateTranscriptRecord(record);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('assistant');
    });

    it('validates an assistant record with tool_use', () => {
      const record = {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-123',
              name: 'Read',
              input: { file_path: '/foo.ts' },
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      };
      const result = validateTranscriptRecord(record);
      expect(result).not.toBeNull();
      expect(result?.message?.usage?.input_tokens).toBe(100);
    });

    it('validates a user record with tool_result', () => {
      const record = {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tool-123' }],
        },
      };
      const result = validateTranscriptRecord(record);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('user');
    });

    it('validates a system record with subtype', () => {
      const record = {
        type: 'system',
        subtype: 'turn_duration',
      };
      const result = validateTranscriptRecord(record);
      expect(result).not.toBeNull();
      expect(result?.subtype).toBe('turn_duration');
    });

    it('validates a progress record', () => {
      const record = {
        type: 'progress',
        parentToolUseID: 'tool-456',
        data: {
          type: 'bash_progress',
          message: { output: 'running...' },
        },
      };
      const result = validateTranscriptRecord(record);
      expect(result).not.toBeNull();
      expect(result?.parentToolUseID).toBe('tool-456');
    });

    it('validates a queue-operation record', () => {
      const record = {
        type: 'queue-operation',
        operation: 'enqueue',
        content: '<tool-use-id>abc</tool-use-id>',
      };
      const result = validateTranscriptRecord(record);
      expect(result).not.toBeNull();
      expect(result?.operation).toBe('enqueue');
    });

    it('rejects records with invalid type', () => {
      const record = { type: 'invalid-type' };
      const result = validateTranscriptRecord(record);
      expect(result).toBeNull();
    });

    it('rejects non-object data', () => {
      expect(validateTranscriptRecord('string')).toBeNull();
      expect(validateTranscriptRecord(123)).toBeNull();
      expect(validateTranscriptRecord(null)).toBeNull();
      expect(validateTranscriptRecord(undefined)).toBeNull();
    });

    it('allows extra fields (passthrough)', () => {
      const record = {
        type: 'assistant',
        extraField: 'extra value',
        teamName: 'my-team',
      };
      const result = validateTranscriptRecord(record);
      expect(result).not.toBeNull();
      expect((result as Record<string, unknown>).extraField).toBe('extra value');
      expect(result?.teamName).toBe('my-team');
    });
  });

  describe('parseTranscriptLine', () => {
    it('parses valid JSONL line', () => {
      const line = '{"type":"assistant","message":{"content":"hello"}}';
      const result = parseTranscriptLine(line);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('assistant');
    });

    it('returns null for invalid JSON', () => {
      const result = parseTranscriptLine('not json');
      expect(result).toBeNull();
    });

    it('returns null for valid JSON with invalid schema', () => {
      const result = parseTranscriptLine('{"type":"unknown"}');
      expect(result).toBeNull();
    });
  });
});

describe('LayoutSchema', () => {
  describe('validateLayout', () => {
    it('validates a minimal valid layout', () => {
      const layout = {
        version: 1,
        cols: 10,
        rows: 5,
        tiles: [1, 1, 1, 1, 1],
        furniture: [],
      };
      const result = validateLayout(layout, false);
      expect(result).not.toBeNull();
      expect(result?.version).toBe(1);
      expect(result?.cols).toBe(10);
    });

    it('validates a layout with furniture', () => {
      const layout = {
        version: 1,
        cols: 10,
        rows: 5,
        tiles: [1, 1, 1, 1, 1],
        furniture: [
          { uid: 'f1', type: 'DESK_FRONT', row: 2, col: 3 },
          { uid: 'f2', type: 'CHAIR_FRONT', row: 3, col: 3, color: { h: 180, s: 50, b: 50, c: 0 } },
        ],
      };
      const result = validateLayout(layout, false);
      expect(result).not.toBeNull();
      expect(result?.furniture.length).toBe(2);
    });

    it('validates a layout with tileColors', () => {
      const layout = {
        version: 1,
        cols: 2,
        rows: 2,
        tiles: [1, 1, 1, 1],
        furniture: [],
        tileColors: [
          { h: 0, s: 50, b: 50, c: 0 },
          null,
          { h: 180, s: 30, b: 70, c: 10, colorize: true },
          null,
        ],
      };
      const result = validateLayout(layout, false);
      expect(result).not.toBeNull();
      expect(result?.tileColors?.length).toBe(4);
    });

    it('rejects layout with version !== 1', () => {
      const layout = {
        version: 2,
        cols: 10,
        rows: 5,
        tiles: [],
        furniture: [],
      };
      const result = validateLayout(layout, false);
      expect(result).toBeNull();
    });

    it('rejects layout with missing required fields', () => {
      const layout = { version: 1 };
      const result = validateLayout(layout, false);
      expect(result).toBeNull();
    });

    it('rejects layout with invalid cols/rows', () => {
      const layout = {
        version: 1,
        cols: -1,
        rows: 5,
        tiles: [],
        furniture: [],
      };
      const result = validateLayout(layout, false);
      expect(result).toBeNull();
    });

    it('rejects non-object data', () => {
      expect(validateLayout('string', false)).toBeNull();
      expect(validateLayout(null, false)).toBeNull();
    });
  });

  describe('parseLayout', () => {
    it('parses valid JSON layout', () => {
      const json =
        '{"version":1,"cols":10,"rows":5,"tiles":[1,1,1],"furniture":[]}';
      const result = parseLayout(json, false);
      expect(result).not.toBeNull();
    });

    it('returns null for invalid JSON', () => {
      const result = parseLayout('not json', false);
      expect(result).toBeNull();
    });

    it('returns null for valid JSON with invalid schema', () => {
      const result = parseLayout('{"version":2}', false);
      expect(result).toBeNull();
    });
  });

  describe('hasValidLayoutStructure', () => {
    it('returns true for valid basic structure', () => {
      expect(hasValidLayoutStructure({ version: 1, tiles: [] })).toBe(true);
    });

    it('returns false for wrong version', () => {
      expect(hasValidLayoutStructure({ version: 2, tiles: [] })).toBe(false);
    });

    it('returns false for missing tiles', () => {
      expect(hasValidLayoutStructure({ version: 1 })).toBe(false);
    });

    it('returns false for non-array tiles', () => {
      expect(hasValidLayoutStructure({ version: 1, tiles: 'not array' })).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(hasValidLayoutStructure(null)).toBe(false);
      expect(hasValidLayoutStructure('string')).toBe(false);
    });
  });
});

describe('ConfigSchema', () => {
  describe('validateConfig', () => {
    it('validates a valid config', () => {
      const config = { externalAssetDirectories: ['/path/one', '/path/two'] };
      const result = validateConfig(config, false);
      expect(result.externalAssetDirectories).toEqual(['/path/one', '/path/two']);
    });

    it('returns default for empty object', () => {
      const result = validateConfig({}, false);
      expect(result.externalAssetDirectories).toEqual([]);
    });

    it('returns default for null', () => {
      const result = validateConfig(null, false);
      expect(result.externalAssetDirectories).toEqual([]);
    });

    it('returns default for undefined', () => {
      const result = validateConfig(undefined, false);
      expect(result.externalAssetDirectories).toEqual([]);
    });

    it('returns default for invalid type', () => {
      const result = validateConfig({ externalAssetDirectories: 'not-array' }, false);
      expect(result.externalAssetDirectories).toEqual([]);
    });
  });

  describe('parseConfig', () => {
    it('parses valid JSON config', () => {
      const json = '{"externalAssetDirectories":["/foo","/bar"]}';
      const result = parseConfig(json, false);
      expect(result.externalAssetDirectories).toEqual(['/foo', '/bar']);
    });

    it('returns default for invalid JSON', () => {
      const result = parseConfig('not json', false);
      expect(result.externalAssetDirectories).toEqual([]);
    });

    it('returns default for empty JSON object', () => {
      const result = parseConfig('{}', false);
      expect(result.externalAssetDirectories).toEqual([]);
    });
  });
});
