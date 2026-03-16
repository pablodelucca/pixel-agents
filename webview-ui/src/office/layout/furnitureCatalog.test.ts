import { afterEach, describe, expect, it } from 'vitest';

import type { LoadedAssetData } from './furnitureCatalog.js';
import {
  buildDynamicCatalog,
  getCatalogEntry,
  getOffStateType,
  getOnStateType,
  getRotatedType,
  getToggledType,
  isRotatable,
} from './furnitureCatalog.js';

// Minimal 1x1 sprite for test assets
const TINY_SPRITE = [['#FF0000']];

/** Build test asset data with rotation and state groups */
function makeTestAssets(): LoadedAssetData {
  return {
    catalog: [
      {
        id: 'MONITOR_FRONT_OFF',
        label: 'Monitor - Front - Off',
        category: 'electronics',
        width: 16,
        height: 32,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        groupId: 'MONITOR',
        orientation: 'front',
        state: 'off',
      },
      {
        id: 'MONITOR_FRONT_ON',
        label: 'Monitor - Front - On',
        category: 'electronics',
        width: 16,
        height: 32,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        groupId: 'MONITOR',
        orientation: 'front',
        state: 'on',
      },
      {
        id: 'MONITOR_BACK',
        label: 'Monitor - Back',
        category: 'electronics',
        width: 16,
        height: 32,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        groupId: 'MONITOR',
        orientation: 'back',
      },
      {
        id: 'SIMPLE_PLANT',
        label: 'Simple Plant',
        category: 'decor',
        width: 16,
        height: 16,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
      },
    ],
    sprites: {
      MONITOR_FRONT_OFF: TINY_SPRITE,
      MONITOR_FRONT_ON: TINY_SPRITE,
      MONITOR_BACK: TINY_SPRITE,
      SIMPLE_PLANT: TINY_SPRITE,
    },
  };
}

// Reset catalog state between tests by rebuilding with empty or test data
afterEach(() => {
  // Build with empty data to clear state — buildDynamicCatalog handles this gracefully
  buildDynamicCatalog({ catalog: [], sprites: {} });
});

describe('getCatalogEntry', () => {
  it('finds built-in furniture types', () => {
    const entry = getCatalogEntry('desk');
    expect(entry).toBeDefined();
    expect(entry!.label).toBe('Desk');
    expect(entry!.footprintW).toBe(2);
    expect(entry!.footprintH).toBe(2);
    expect(entry!.isDesk).toBe(true);
  });

  it('returns undefined for unknown type', () => {
    expect(getCatalogEntry('nonexistent_thing')).toBeUndefined();
  });

  it('finds dynamic catalog entries after build', () => {
    buildDynamicCatalog(makeTestAssets());
    const entry = getCatalogEntry('MONITOR_FRONT_OFF');
    expect(entry).toBeDefined();
    expect(entry!.label).toContain('Monitor');
  });
});

describe('buildDynamicCatalog', () => {
  it('returns true on success', () => {
    expect(buildDynamicCatalog(makeTestAssets())).toBe(true);
  });

  it('returns false for empty catalog', () => {
    expect(buildDynamicCatalog({ catalog: [], sprites: {} })).toBe(false);
  });

  it('returns false for missing sprites', () => {
    const assets = makeTestAssets();
    assets.sprites = {}; // no sprites
    expect(buildDynamicCatalog(assets)).toBe(false);
  });

  it('builds rotation groups', () => {
    buildDynamicCatalog(makeTestAssets());
    // MONITOR has front and back orientations
    expect(isRotatable('MONITOR_FRONT_OFF')).toBe(true);
    expect(isRotatable('MONITOR_BACK')).toBe(true);
    expect(isRotatable('SIMPLE_PLANT')).toBe(false);
  });

  it('builds state groups', () => {
    buildDynamicCatalog(makeTestAssets());
    expect(getToggledType('MONITOR_FRONT_OFF')).toBe('MONITOR_FRONT_ON');
    expect(getToggledType('MONITOR_FRONT_ON')).toBe('MONITOR_FRONT_OFF');
    expect(getToggledType('SIMPLE_PLANT')).toBeNull();
  });
});

describe('getRotatedType', () => {
  it('cycles through orientations clockwise', () => {
    buildDynamicCatalog(makeTestAssets());
    // front → back (only 2 orientations)
    expect(getRotatedType('MONITOR_FRONT_OFF', 'cw')).toBe('MONITOR_BACK');
    // back → front
    expect(getRotatedType('MONITOR_BACK', 'cw')).toBe('MONITOR_FRONT_OFF');
  });

  it('cycles counter-clockwise', () => {
    buildDynamicCatalog(makeTestAssets());
    expect(getRotatedType('MONITOR_FRONT_OFF', 'ccw')).toBe('MONITOR_BACK');
  });

  it('returns null for non-rotatable', () => {
    buildDynamicCatalog(makeTestAssets());
    expect(getRotatedType('SIMPLE_PLANT', 'cw')).toBeNull();
  });

  it('returns null for unknown type', () => {
    expect(getRotatedType('unknown', 'cw')).toBeNull();
  });
});

describe('getOnStateType / getOffStateType', () => {
  it('returns on-state variant', () => {
    buildDynamicCatalog(makeTestAssets());
    expect(getOnStateType('MONITOR_FRONT_OFF')).toBe('MONITOR_FRONT_ON');
  });

  it('returns off-state variant', () => {
    buildDynamicCatalog(makeTestAssets());
    expect(getOffStateType('MONITOR_FRONT_ON')).toBe('MONITOR_FRONT_OFF');
  });

  it('returns same type when no state variant exists', () => {
    buildDynamicCatalog(makeTestAssets());
    expect(getOnStateType('SIMPLE_PLANT')).toBe('SIMPLE_PLANT');
    expect(getOffStateType('SIMPLE_PLANT')).toBe('SIMPLE_PLANT');
  });
});

describe('isRotatable', () => {
  it('returns true for grouped items', () => {
    buildDynamicCatalog(makeTestAssets());
    expect(isRotatable('MONITOR_FRONT_OFF')).toBe(true);
  });

  it('returns false for non-grouped items', () => {
    buildDynamicCatalog(makeTestAssets());
    expect(isRotatable('SIMPLE_PLANT')).toBe(false);
  });
});
