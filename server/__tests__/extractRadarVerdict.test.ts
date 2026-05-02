import { describe, expect, it } from 'vitest';

import { extractRadarVerdict } from '../../src/transcriptParser.js';

describe('extractRadarVerdict', () => {
  // Helper: wrap JSON text in the tool_result content structure
  function toolResult(json: string): Record<string, unknown> {
    return { content: [{ type: 'text', text: json }] };
  }

  describe('verdict extraction', () => {
    it('reads status field (v0.3.0+ shape)', () => {
      const result = extractRadarVerdict(toolResult(JSON.stringify({ status: 'PROCEED' })));
      expect(result.verdict).toBe('PROCEED');
    });

    it('reads verdict field as fallback (v0.2.x shape)', () => {
      const result = extractRadarVerdict(toolResult(JSON.stringify({ verdict: 'DENY' })));
      expect(result.verdict).toBe('DENY');
    });

    it('prefers status over verdict when both present', () => {
      const result = extractRadarVerdict(
        toolResult(JSON.stringify({ status: 'PROCEED', verdict: 'DENY' })),
      );
      expect(result.verdict).toBe('PROCEED');
    });

    it('returns HOLD for unknown verdict value', () => {
      const result = extractRadarVerdict(toolResult(JSON.stringify({ status: 'UNKNOWN' })));
      expect(result.verdict).toBe('HOLD');
    });

    it('returns HOLD for missing verdict fields', () => {
      const result = extractRadarVerdict(toolResult(JSON.stringify({ riskScore: 5 })));
      expect(result.verdict).toBe('HOLD');
    });
  });

  describe('tier extraction', () => {
    it('extracts tier 1 (rules engine)', () => {
      const result = extractRadarVerdict(
        toolResult(JSON.stringify({ status: 'PROCEED', tier: 1 })),
      );
      expect(result.tier).toBe(1);
    });

    it('extracts tier 2 (LLM assessment)', () => {
      const result = extractRadarVerdict(toolResult(JSON.stringify({ status: 'HOLD', tier: 2 })));
      expect(result.tier).toBe(2);
    });

    it('omits tier when not present', () => {
      const result = extractRadarVerdict(toolResult(JSON.stringify({ status: 'PROCEED' })));
      expect(result.tier).toBeUndefined();
    });

    it('omits tier when not a number', () => {
      const result = extractRadarVerdict(
        toolResult(JSON.stringify({ status: 'PROCEED', tier: 'high' })),
      );
      expect(result.tier).toBeUndefined();
    });
  });

  describe('extra fields', () => {
    it('extracts riskScore, triggerReason, recommended', () => {
      const result = extractRadarVerdict(
        toolResult(
          JSON.stringify({
            status: 'HOLD',
            tier: 2,
            riskScore: 12,
            triggerReason: 'email_bulk base risk',
            recommended: 'mitigate',
          }),
        ),
      );
      expect(result.verdict).toBe('HOLD');
      expect(result.riskScore).toBe(12);
      expect(result.triggerReason).toBe('email_bulk base risk');
      expect(result.recommended).toBe('mitigate');
    });

    it('omits extra fields when not present', () => {
      const result = extractRadarVerdict(toolResult(JSON.stringify({ status: 'PROCEED' })));
      expect(result.riskScore).toBeUndefined();
      expect(result.triggerReason).toBeUndefined();
      expect(result.recommended).toBeUndefined();
    });

    it('omits extra fields when wrong type', () => {
      const result = extractRadarVerdict(
        toolResult(JSON.stringify({ status: 'PROCEED', riskScore: 'high', triggerReason: 42 })),
      );
      expect(result.riskScore).toBeUndefined();
      expect(result.triggerReason).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('returns HOLD for invalid JSON', () => {
      const result = extractRadarVerdict(toolResult('not json'));
      expect(result.verdict).toBe('HOLD');
    });

    it('returns HOLD for empty text', () => {
      const result = extractRadarVerdict(toolResult(''));
      expect(result.verdict).toBe('HOLD');
    });

    it('returns HOLD for missing content', () => {
      const result = extractRadarVerdict({});
      expect(result.verdict).toBe('HOLD');
    });

    it('returns HOLD for null content', () => {
      const result = extractRadarVerdict({ content: null });
      expect(result.verdict).toBe('HOLD');
    });

    it('handles string content (non-array)', () => {
      const result = extractRadarVerdict({
        content: JSON.stringify({ status: 'DENY', tier: 1 }),
      });
      expect(result.verdict).toBe('DENY');
      expect(result.tier).toBe(1);
    });

    it('handles empty array content', () => {
      const result = extractRadarVerdict({ content: [] });
      expect(result.verdict).toBe('HOLD');
    });
  });
});
