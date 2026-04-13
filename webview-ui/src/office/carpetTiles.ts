/**
 * Carpet tile dual-grid (marching squares) autotiling: sprite storage and junction rendering.
 *
 * Stores carpet tile sets loaded from individual PNGs in assets/carpets/.
 * Each set contains 16 sprites indexed by a 4-bit marching squares case.
 * At render time, each junction (corner between 4 tiles) checks which adjacent
 * tiles have carpet to build the case, then the corresponding sprite is drawn.
 * No changes to the layout tile model — carpets are a separate overlay layer.
 *
 * Marching squares case: NW=bit0 | NE=bit1 | SE=bit2 | SW=bit3
 * Junction (jx, jy) sits at the corner between tiles; the 4 tiles meeting there:
 *   NW: (jx-1, jy-1)  NE: (jx, jy-1)
 *   SW: (jx-1, jy  )  SE: (jx, jy  )
 *
 */

import type { ColorValue } from '../components/ui/types.js';
import { CARPET_DEFAULT_ACCENT_COLOR, CARPET_DEFAULT_COLOR } from '../constants.js';
import { flatColorizeSprite } from './colorize.js';
import type { CarpetTile, SpriteData } from './types.js';

/** Carpet sprite sets: indexed [variant][msCase] */
let carpetSets: SpriteData[][] = [];
let carpetVariantPalettes: Array<{ mainRgb: string | null; accentRgb: string | null }> = [];
const carpetCache = new Map<string, SpriteData>();

function getCarpetEffectiveColor(tile: CarpetTile | null | undefined): ColorValue {
  return tile?.color ?? CARPET_DEFAULT_COLOR;
}

function getCarpetEffectiveAccentColor(tile: CarpetTile | null | undefined): ColorValue {
  return tile?.accentColor ?? CARPET_DEFAULT_ACCENT_COLOR;
}

export function getCarpetColorKey(color: ColorValue): string {
  return `${color.h}-${color.s}-${color.b}-${color.c}-${color.colorize ? 1 : 0}`;
}

export function getCarpetPaletteKey(color: ColorValue, accentColor: ColorValue): string {
  return `${getCarpetColorKey(color)}|${getCarpetColorKey(accentColor)}`;
}

/** Set carpet sprite sets (called once when extension sends carpetTilesLoaded) */
export function setCarpetSprites(sprites: SpriteData[][]): void {
  carpetSets = sprites;
  carpetVariantPalettes = sprites.map(classifyCarpetPalette);
  carpetCache.clear();
}

/** Check if carpet sprites have been loaded */
export function hasCarpetSprites(): boolean {
  return carpetSets.length > 0;
}

/** Get number of available carpet variants */
export function getCarpetSetCount(): number {
  return carpetSets.length;
}

/**
 * Get a colorized carpet junction sprite for a given junction position and variant.
 *
 * Junction (jx, jy) is indexed over the grid corners, from (0,0) to (cols, rows).
 * The 4 tiles that meet at junction (jx, jy):
 *   NW: (jx-1, jy-1)  NE: (jx, jy-1)
 *   SW: (jx-1, jy  )  SE: (jx, jy  )
 *
 * Returns null if case === 0 (no carpet adjacent to this junction) or sprites not loaded.
 */
export function getCarpetJunctionSprite(
  jx: number,
  jy: number,
  variant: number,
  carpetTiles: (CarpetTile | null)[],
  cols: number,
  rows: number,
  color?: ColorValue,
  accentColor?: ColorValue,
  paletteKey?: string,
): SpriteData | null {
  if (carpetSets.length === 0) return null;
  const sprites = carpetSets[variant] ?? carpetSets[0];
  const palette = carpetVariantPalettes[variant] ?? carpetVariantPalettes[0];
  if (!sprites) return null;

  // Build 4-bit marching squares case
  const nw = tileHasVariant(jx - 1, jy - 1, variant, carpetTiles, cols, rows, paletteKey);
  const ne = tileHasVariant(jx, jy - 1, variant, carpetTiles, cols, rows, paletteKey);
  const se = tileHasVariant(jx, jy, variant, carpetTiles, cols, rows, paletteKey);
  const sw = tileHasVariant(jx - 1, jy, variant, carpetTiles, cols, rows, paletteKey);

  const msCase = (nw ? 1 : 0) | (ne ? 2 : 0) | (se ? 4 : 0) | (sw ? 8 : 0);
  if (msCase === 0) return null;

  const sprite = sprites[msCase];
  if (!sprite) return null;

  const effectiveColor: ColorValue = color ?? CARPET_DEFAULT_COLOR;
  const effectiveAccentColor: ColorValue = accentColor ?? CARPET_DEFAULT_ACCENT_COLOR;
  const cacheKey = `carpet-${variant}-${msCase}-${getCarpetPaletteKey(effectiveColor, effectiveAccentColor)}`;
  return getDualColorizedCarpetSprite(
    cacheKey,
    sprite,
    palette,
    effectiveColor,
    effectiveAccentColor,
  );
}

/** Check if a tile at (col, row) has carpet of the given variant. Out-of-bounds = false. */
function tileHasVariant(
  col: number,
  row: number,
  variant: number,
  carpetTiles: (CarpetTile | null)[],
  cols: number,
  rows: number,
  paletteKey?: string,
): boolean {
  if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
  const tile = carpetTiles[row * cols + col];
  return (
    tile !== null &&
    tile !== undefined &&
    tile.variant === variant &&
    (paletteKey === undefined ||
      getCarpetPaletteKey(getCarpetEffectiveColor(tile), getCarpetEffectiveAccentColor(tile)) ===
        paletteKey)
  );
}

function classifyCarpetPalette(sprites: SpriteData[]): {
  mainRgb: string | null;
  accentRgb: string | null;
} {
  const uniqueColors = new Map<string, number>();

  for (const sprite of sprites) {
    for (const row of sprite) {
      for (const pixel of row) {
        if (pixel === '') continue;
        const rgb = pixel.slice(1, 7).toUpperCase();
        if (!uniqueColors.has(rgb)) {
          uniqueColors.set(rgb, luminanceFromRgb(rgb));
        }
      }
    }
  }

  const ordered = [...uniqueColors.entries()].sort((a, b) => a[1] - b[1]);
  if (ordered.length === 0) {
    return { mainRgb: null, accentRgb: null };
  }
  if (ordered.length === 1) {
    return { mainRgb: ordered[0][0], accentRgb: ordered[0][0] };
  }
  return { mainRgb: ordered[0][0], accentRgb: ordered[ordered.length - 1][0] };
}

function luminanceFromRgb(rgb: string): number {
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function getDualColorizedCarpetSprite(
  cacheKey: string,
  sprite: SpriteData,
  palette: { mainRgb: string | null; accentRgb: string | null } | undefined,
  color: ColorValue,
  accentColor: ColorValue,
): SpriteData {
  const cached = carpetCache.get(cacheKey);
  if (cached) return cached;

  if (!palette?.mainRgb || palette.mainRgb === palette.accentRgb) {
    const single = flatColorizeSprite(sprite, color);
    carpetCache.set(cacheKey, single);
    return single;
  }

  const accentRgb = palette.accentRgb ?? palette.mainRgb;
  const mainMask = maskCarpetSprite(sprite, palette.mainRgb);
  const accentMask = maskCarpetSprite(sprite, accentRgb);
  const mainSprite = flatColorizeSprite(mainMask, color);
  const accentSprite = flatColorizeSprite(accentMask, accentColor);
  const merged = mergeCarpetLayers(mainSprite, accentSprite);
  carpetCache.set(cacheKey, merged);
  return merged;
}

function maskCarpetSprite(sprite: SpriteData, rgb: string): SpriteData {
  return sprite.map((row) =>
    row.map((pixel) => (pixel !== '' && pixel.slice(1, 7).toUpperCase() === rgb ? pixel : '')),
  );
}

function mergeCarpetLayers(base: SpriteData, accent: SpriteData): SpriteData {
  return base.map((row, rowIndex) =>
    row.map((pixel, colIndex) => accent[rowIndex]?.[colIndex] || pixel),
  );
}
