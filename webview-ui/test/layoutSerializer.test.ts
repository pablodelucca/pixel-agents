/**
 * Unit tests for layout serializer: pets migration in migrateLayout().
 *
 * Run with: npm run test:webview
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deserializeLayout, migrateLayoutColors } from '../src/office/layout/layoutSerializer.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

// ── Helpers ─────────────────────────────────────────────────

/** Build a minimal valid OfficeLayout for testing */
function makeLayout(overrides?: Partial<OfficeLayout>): OfficeLayout {
  return {
    version: 1,
    cols: 2,
    rows: 2,
    tiles: [TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1],
    furniture: [],
    ...overrides,
  };
}

/** Serialize a layout to JSON (for deserializeLayout tests) */
function toJson(layout: OfficeLayout): string {
  return JSON.stringify(layout);
}

// ── migrateLayoutColors: pets initialization ────────────────

describe('migrateLayoutColors — pets migration', () => {
  it('initializes pets to [] when field is absent', () => {
    const layout = makeLayout();
    delete (layout as unknown as Record<string, unknown>).pets;
    const migrated = migrateLayoutColors(layout);
    assert.ok(Array.isArray(migrated.pets));
    assert.equal(migrated.pets!.length, 0);
  });

  it('preserves existing pets array', () => {
    const layout = makeLayout({
      pets: [{ id: 'pet-1', petType: 0 }],
    });
    const migrated = migrateLayoutColors(layout);
    assert.equal(migrated.pets!.length, 1);
    assert.equal(migrated.pets![0].id, 'pet-1');
    assert.equal(migrated.pets![0].petType, 0);
  });

  it('initializes pets even when tileColors already exist (early-return path)', () => {
    const layout = makeLayout({
      tileColors: [null, null, null, null],
    });
    delete (layout as unknown as Record<string, unknown>).pets;
    const migrated = migrateLayoutColors(layout);
    assert.ok(Array.isArray(migrated.pets));
    assert.equal(migrated.pets!.length, 0);
  });

  it('preserves pets on early-return path (tileColors present + pets present)', () => {
    const layout = makeLayout({
      tileColors: [null, null, null, null],
      pets: [{ id: 'pet-2', petType: 1 }],
    });
    const migrated = migrateLayoutColors(layout);
    assert.equal(migrated.pets!.length, 1);
    assert.equal(migrated.pets![0].petType, 1);
  });
});

// ── deserializeLayout: pets handling ────────────────────────

describe('deserializeLayout — pets handling', () => {
  it('returns pets: [] for JSON without pets field', () => {
    const layout = makeLayout();
    delete (layout as unknown as Record<string, unknown>).pets;
    const result = deserializeLayout(toJson(layout));
    assert.ok(result !== null);
    assert.ok(Array.isArray(result!.pets));
    assert.equal(result!.pets!.length, 0);
  });

  it('preserves pets from JSON with valid pets', () => {
    const layout = makeLayout({
      pets: [{ id: 'pet-a', petType: 2 }],
    });
    const result = deserializeLayout(toJson(layout));
    assert.ok(result !== null);
    assert.equal(result!.pets!.length, 1);
    assert.equal(result!.pets![0].id, 'pet-a');
    assert.equal(result!.pets![0].petType, 2);
  });

  it('returns null for invalid JSON', () => {
    assert.equal(deserializeLayout('not json'), null);
  });

  it('returns null for JSON missing required fields', () => {
    assert.equal(deserializeLayout('{"version": 1}'), null);
  });
});
