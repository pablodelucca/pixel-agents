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
import { CARPET_DEFAULT_COLOR } from '../constants.js';
import { getColorizedSprite } from './colorize.js';
import type { CarpetTile, SpriteData } from './types.js';

/** Carpet sprite sets: indexed [variant][msCase] */
let carpetSets: SpriteData[][] = [];

function getCarpetEffectiveColor(tile: CarpetTile | null | undefined): ColorValue {
  return tile?.color ?? CARPET_DEFAULT_COLOR;
}

export function getCarpetColorKey(color: ColorValue): string {
  return `${color.h}-${color.s}-${color.b}-${color.c}-${color.colorize ? 1 : 0}`;
}

/** Set carpet sprite sets (called once when extension sends carpetTilesLoaded) */
export function setCarpetSprites(sprites: SpriteData[][]): void {
  carpetSets = sprites;
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
  colorKey?: string,
): SpriteData | null {
  if (carpetSets.length === 0) return null;
  const sprites = carpetSets[variant] ?? carpetSets[0];
  if (!sprites) return null;

  // Build 4-bit marching squares case
  const nw = tileHasVariant(jx - 1, jy - 1, variant, carpetTiles, cols, rows, colorKey);
  const ne = tileHasVariant(jx, jy - 1, variant, carpetTiles, cols, rows, colorKey);
  const se = tileHasVariant(jx, jy, variant, carpetTiles, cols, rows, colorKey);
  const sw = tileHasVariant(jx - 1, jy, variant, carpetTiles, cols, rows, colorKey);

  const msCase = (nw ? 1 : 0) | (ne ? 2 : 0) | (se ? 4 : 0) | (sw ? 8 : 0);
  if (msCase === 0) return null;

  const sprite = sprites[msCase];
  if (!sprite) return null;

  const effectiveColor: ColorValue = color ?? CARPET_DEFAULT_COLOR;
  const cacheKey = `carpet-${variant}-${msCase}-${getCarpetColorKey(effectiveColor)}`;
  return getColorizedSprite(cacheKey, sprite, effectiveColor);
}

/** Check if a tile at (col, row) has carpet of the given variant. Out-of-bounds = false. */
function tileHasVariant(
  col: number,
  row: number,
  variant: number,
  carpetTiles: (CarpetTile | null)[],
  cols: number,
  rows: number,
  colorKey?: string,
): boolean {
  if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
  const tile = carpetTiles[row * cols + col];
  return (
    tile !== null &&
    tile !== undefined &&
    tile.variant === variant &&
    (colorKey === undefined || getCarpetColorKey(getCarpetEffectiveColor(tile)) === colorKey)
  );
}
