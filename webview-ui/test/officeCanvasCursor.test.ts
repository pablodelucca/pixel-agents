/**
 * Unit tests for the normal-mode cursor decision in OfficeCanvas.
 *
 * The helper `computeNormalModeCursor` encapsulates the cursor logic used by
 * `handleMouseMove` when NOT in edit mode. It cascades: character hit →
 * pointer, pet hit → pointer, clickable seat → pointer, otherwise default.
 *
 * Run with: npm run test:webview
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OfficeCursorState } from '../src/office/components/officeCanvasCursor.js';
import { computeNormalModeCursor } from '../src/office/components/officeCanvasCursor.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeState(partial: Partial<OfficeCursorState> = {}): OfficeCursorState {
  return {
    hitId: null,
    petId: null,
    selectedAgentId: null,
    tile: null,
    getSeatAtTile: () => null,
    getSeat: () => undefined,
    getCharacter: () => undefined,
    ...partial,
  };
}

// ── computeNormalModeCursor ────────────────────────────────────────────────

describe('computeNormalModeCursor — character hit', () => {
  it('returns pointer when a character is under the cursor', () => {
    const cursor = computeNormalModeCursor(makeState({ hitId: 7 }));
    assert.equal(cursor, 'pointer');
  });

  it('character hit wins over pet hit', () => {
    const cursor = computeNormalModeCursor(makeState({ hitId: 7, petId: 'pet-1' }));
    assert.equal(cursor, 'pointer');
  });
});

describe('computeNormalModeCursor — pet hit', () => {
  it('returns pointer when getPetAt returns a pet id and no character is hit', () => {
    const cursor = computeNormalModeCursor(makeState({ hitId: null, petId: 'pet-1' }));
    assert.equal(cursor, 'pointer');
  });

  it('returns default when no pet and no character is under the cursor', () => {
    const cursor = computeNormalModeCursor(makeState({ hitId: null, petId: null }));
    assert.equal(cursor, 'default');
  });

  it('treats empty-string pet id as a hit (petId !== null check)', () => {
    // getPetAt signature is string | null; null = no pet. The branch must check
    // !== null, not truthy, so an empty string would still be treated as a hit.
    // This test documents the contract that the helper relies on `petId !== null`.
    const cursor = computeNormalModeCursor(makeState({ hitId: null, petId: '' }));
    assert.equal(cursor, 'pointer');
  });
});

describe('computeNormalModeCursor — seat hit preserved', () => {
  it('returns pointer over an available seat when an agent is selected', () => {
    const cursor = computeNormalModeCursor(
      makeState({
        hitId: null,
        petId: null,
        selectedAgentId: 3,
        tile: { col: 5, row: 5 },
        getSeatAtTile: (col, row) => (col === 5 && row === 5 ? 'seat-a' : null),
        getSeat: (id) => (id === 'seat-a' ? { assigned: null } : undefined),
        getCharacter: (id) => (id === 3 ? { seatId: null } : undefined),
      }),
    );
    assert.equal(cursor, 'pointer');
  });

  it('returns default when seat is assigned to another agent', () => {
    const cursor = computeNormalModeCursor(
      makeState({
        hitId: null,
        petId: null,
        selectedAgentId: 3,
        tile: { col: 5, row: 5 },
        getSeatAtTile: () => 'seat-a',
        getSeat: () => ({ assigned: 99 }),
        getCharacter: () => ({ seatId: null }),
      }),
    );
    assert.equal(cursor, 'default');
  });

  it('pet hit wins over seat hit', () => {
    const cursor = computeNormalModeCursor(
      makeState({
        hitId: null,
        petId: 'pet-2',
        selectedAgentId: 3,
        tile: { col: 5, row: 5 },
        getSeatAtTile: () => 'seat-a',
        getSeat: () => ({ assigned: null }),
        getCharacter: () => ({ seatId: null }),
      }),
    );
    assert.equal(cursor, 'pointer');
  });
});
