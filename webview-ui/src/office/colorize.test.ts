import { afterEach, describe, expect, it } from 'vitest';

import {
  adjustSprite,
  clearColorizeCache,
  colorizeSprite,
  getColorizedSprite,
} from './colorize.js';
import type { FloorColor, SpriteData } from './types.js';

afterEach(() => {
  clearColorizeCache();
});

describe('colorizeSprite', () => {
  it('preserves transparent pixels', () => {
    const sprite: SpriteData = [['', '#808080', '']];
    const color: FloorColor = { h: 120, s: 50, b: 0, c: 0, colorize: true };
    const result = colorizeSprite(sprite, color);
    expect(result[0][0]).toBe('');
    expect(result[0][2]).toBe('');
    expect(result[0][1]).not.toBe('');
  });

  it('converts grayscale to colored output', () => {
    const sprite: SpriteData = [['#808080']]; // mid-gray
    const color: FloorColor = { h: 0, s: 100, b: 0, c: 0, colorize: true }; // red, full sat
    const result = colorizeSprite(sprite, color);
    const hex = result[0][0];
    // Result should be a reddish color
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it('pure black stays dark', () => {
    const sprite: SpriteData = [['#000000']];
    const color: FloorColor = { h: 180, s: 50, b: 0, c: 0, colorize: true };
    const result = colorizeSprite(sprite, color);
    const hex = result[0][0];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const bv = parseInt(hex.slice(5, 7), 16);
    // Should remain very dark
    expect(r + g + bv).toBeLessThan(30);
  });

  it('pure white stays bright', () => {
    const sprite: SpriteData = [['#FFFFFF']];
    const color: FloorColor = { h: 180, s: 50, b: 0, c: 0, colorize: true };
    const result = colorizeSprite(sprite, color);
    const hex = result[0][0];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const bv = parseInt(hex.slice(5, 7), 16);
    // Should remain bright
    expect(r + g + bv).toBeGreaterThan(600);
  });

  it('brightness shifts lightness', () => {
    const sprite: SpriteData = [['#808080']];
    const dark: FloorColor = { h: 0, s: 0, b: -50, c: 0, colorize: true };
    const bright: FloorColor = { h: 0, s: 0, b: 50, c: 0, colorize: true };
    const darkResult = colorizeSprite(sprite, dark);
    const brightResult = colorizeSprite(sprite, bright);
    const darkSum =
      parseInt(darkResult[0][0].slice(1, 3), 16) +
      parseInt(darkResult[0][0].slice(3, 5), 16) +
      parseInt(darkResult[0][0].slice(5, 7), 16);
    const brightSum =
      parseInt(brightResult[0][0].slice(1, 3), 16) +
      parseInt(brightResult[0][0].slice(3, 5), 16) +
      parseInt(brightResult[0][0].slice(5, 7), 16);
    expect(brightSum).toBeGreaterThan(darkSum);
  });

  it('handles empty sprite', () => {
    const result = colorizeSprite([], { h: 0, s: 0, b: 0, c: 0, colorize: true });
    expect(result).toEqual([]);
  });
});

describe('adjustSprite', () => {
  it('preserves transparent pixels', () => {
    const sprite: SpriteData = [['', '#FF0000']];
    const color: FloorColor = { h: 60, s: 0, b: 0, c: 0 };
    const result = adjustSprite(sprite, color);
    expect(result[0][0]).toBe('');
    expect(result[0][1]).not.toBe('');
  });

  it('shifts hue', () => {
    const sprite: SpriteData = [['#FF0000']]; // pure red
    const color: FloorColor = { h: 120, s: 0, b: 0, c: 0 }; // shift hue by 120°
    const result = adjustSprite(sprite, color);
    const hex = result[0][0];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    // Red shifted 120° → should be greenish
    expect(g).toBeGreaterThan(r);
  });

  it('hue wraps around 360°', () => {
    const sprite: SpriteData = [['#FF0000']]; // red (hue ~0)
    const shift350: FloorColor = { h: -10, s: 0, b: 0, c: 0 };
    const result = adjustSprite(sprite, shift350);
    // Hue wraps to ~350 — should still be reddish (near magenta)
    const hex = result[0][0];
    const r = parseInt(hex.slice(1, 3), 16);
    expect(r).toBeGreaterThan(200);
  });

  it('clamps saturation', () => {
    const sprite: SpriteData = [['#FF0000']]; // fully saturated red
    const color: FloorColor = { h: 0, s: 100, b: 0, c: 0 }; // push sat beyond max
    const result = adjustSprite(sprite, color);
    // Should not crash and should produce valid hex
    expect(result[0][0]).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('handles empty sprite', () => {
    const result = adjustSprite([], { h: 0, s: 0, b: 0, c: 0 });
    expect(result).toEqual([]);
  });
});

describe('getColorizedSprite', () => {
  it('caches results by key', () => {
    const sprite: SpriteData = [['#808080']];
    const color: FloorColor = { h: 60, s: 50, b: 0, c: 0, colorize: true };
    const result1 = getColorizedSprite('test-key', sprite, color);
    const result2 = getColorizedSprite('test-key', sprite, color);
    expect(result1).toBe(result2); // same reference
  });

  it('dispatches to colorize mode when colorize flag set', () => {
    // Use a colored pixel so adjust mode (HSL shift) differs from colorize mode (grayscale→HSL)
    const sprite: SpriteData = [['#4080C0']];
    const colorize: FloorColor = { h: 120, s: 80, b: 0, c: 0, colorize: true };
    const adjust: FloorColor = { h: 120, s: 80, b: 0, c: 0 };
    const colorized = getColorizedSprite('c-key', sprite, colorize);
    const adjusted = getColorizedSprite('a-key', sprite, adjust);
    // Different modes should produce different results for colored input
    expect(colorized[0][0]).not.toBe(adjusted[0][0]);
  });

  it('different keys produce independent cache entries', () => {
    const sprite: SpriteData = [['#808080']];
    const color1: FloorColor = { h: 0, s: 50, b: 0, c: 0, colorize: true };
    const color2: FloorColor = { h: 180, s: 50, b: 0, c: 0, colorize: true };
    const r1 = getColorizedSprite('key-1', sprite, color1);
    const r2 = getColorizedSprite('key-2', sprite, color2);
    expect(r1[0][0]).not.toBe(r2[0][0]);
  });
});
