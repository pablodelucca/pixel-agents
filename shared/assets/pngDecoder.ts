/**
 * Pure PNG decoding utilities — shared between the extension host, Vite build
 * scripts, and future standalone backend.
 *
 * No VS Code dependency. Only uses pngjs and shared constants.
 */

import { PNG } from 'pngjs';

import { rgbaToHex } from './colorUtils.js';
import {
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHAR_FRAMES_PER_ROW,
  CHARACTER_DIRECTIONS,
  FLOOR_TILE_SIZE,
  PET_FRAME_H,
  PET_FRAME_W_LARGE,
  PET_FRAME_W_SMALL,
  PET_IDLE_FRAMES_VERT,
  PET_IMAGE_HEIGHT,
  PET_IMAGE_WIDTH,
  PET_WALK_FRAMES_HORIZ,
  PET_WALK_FRAMES_VERT,
  WALL_BITMASK_COUNT,
  WALL_GRID_COLS,
  WALL_PIECE_HEIGHT,
  WALL_PIECE_WIDTH,
} from './constants.js';
import type { CharacterDirectionSprites, PetSpriteFrames } from './types.js';

// ── PNG sanitization ────────────────────────────────────────

/**
 * Strip any bytes after the IEND chunk so pngjs doesn't reject the file.
 * Many image editors (e.g. Aseprite, Piskel) append trailing null bytes.
 */
function sanitizePngBuffer(buf: Buffer): Buffer {
  // IEND chunk type bytes: 0x49 0x45 0x4E 0x44
  // A chunk is: 4-byte length + 4-byte type + data + 4-byte CRC
  // IEND has 0 data bytes, so it's: [00 00 00 00] [49 45 4E 44] [CRC 4 bytes] = 12 bytes total
  for (let i = buf.length - 8; i >= 8; i--) {
    if (buf[i] === 0x49 && buf[i + 1] === 0x45 && buf[i + 2] === 0x4e && buf[i + 3] === 0x44) {
      const endPos = i + 4 + 4; // past type + CRC
      if (buf.length > endPos) {
        return buf.subarray(0, endPos);
      }
      break;
    }
  }
  return buf;
}

// ── Sprite decoding ──────────────────────────────────────────

/**
 * Convert a PNG buffer to SpriteData (2D array of hex color strings).
 * '' = transparent, '#RRGGBB' = opaque, '#RRGGBBAA' = semi-transparent.
 */
export function pngToSpriteData(pngBuffer: Buffer, width: number, height: number): string[][] {
  try {
    const png = PNG.sync.read(sanitizePngBuffer(pngBuffer));

    if (png.width !== width || png.height !== height) {
      console.warn(
        `PNG dimensions mismatch: expected ${width}×${height}, got ${png.width}×${png.height}`,
      );
    }

    const sprite: string[][] = [];
    const data = png.data;

    for (let y = 0; y < height; y++) {
      const row: string[] = [];
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * png.width + x) * 4;
        const r = data[pixelIndex];
        const g = data[pixelIndex + 1];
        const b = data[pixelIndex + 2];
        const a = data[pixelIndex + 3];
        row.push(rgbaToHex(r, g, b, a));
      }
      sprite.push(row);
    }

    return sprite;
  } catch (err) {
    console.warn(`Failed to parse PNG: ${err instanceof Error ? err.message : err}`);
    const sprite: string[][] = [];
    for (let y = 0; y < height; y++) {
      sprite.push(new Array(width).fill(''));
    }
    return sprite;
  }
}

/**
 * Parse a single wall PNG (64×128, 4×4 grid of 16×32 pieces) into 16 bitmask sprites.
 * Piece at bitmask M: col = M % 4, row = floor(M / 4).
 */
export function parseWallPng(pngBuffer: Buffer): string[][][] {
  const png = PNG.sync.read(sanitizePngBuffer(pngBuffer));
  const sprites: string[][][] = [];
  for (let mask = 0; mask < WALL_BITMASK_COUNT; mask++) {
    const ox = (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH;
    const oy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT;
    const sprite: string[][] = [];
    for (let r = 0; r < WALL_PIECE_HEIGHT; r++) {
      const row: string[] = [];
      for (let c = 0; c < WALL_PIECE_WIDTH; c++) {
        const idx = ((oy + r) * png.width + (ox + c)) * 4;
        const rv = png.data[idx];
        const gv = png.data[idx + 1];
        const bv = png.data[idx + 2];
        const av = png.data[idx + 3];
        row.push(rgbaToHex(rv, gv, bv, av));
      }
      sprite.push(row);
    }
    sprites.push(sprite);
  }
  return sprites;
}

/**
 * Decode a single character PNG (112×96) into direction-keyed frame arrays.
 * Each PNG has 3 direction rows (down, up, right) × 7 frames (16×32 each).
 */
export function decodeCharacterPng(pngBuffer: Buffer): CharacterDirectionSprites {
  const png = PNG.sync.read(sanitizePngBuffer(pngBuffer));
  const charData: CharacterDirectionSprites = { down: [], up: [], right: [] };

  for (let dirIdx = 0; dirIdx < CHARACTER_DIRECTIONS.length; dirIdx++) {
    const dir = CHARACTER_DIRECTIONS[dirIdx];
    const rowOffsetY = dirIdx * CHAR_FRAME_H;
    const frames: string[][][] = [];

    for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) {
      const sprite: string[][] = [];
      const frameOffsetX = f * CHAR_FRAME_W;
      for (let y = 0; y < CHAR_FRAME_H; y++) {
        const row: string[] = [];
        for (let x = 0; x < CHAR_FRAME_W; x++) {
          const idx = ((rowOffsetY + y) * png.width + (frameOffsetX + x)) * 4;
          const r = png.data[idx];
          const g = png.data[idx + 1];
          const b = png.data[idx + 2];
          const a = png.data[idx + 3];
          row.push(rgbaToHex(r, g, b, a));
        }
        sprite.push(row);
      }
      frames.push(sprite);
    }
    charData[dir] = frames;
  }

  return charData;
}

/**
 * Decode a single pet PNG (96×96) into direction-keyed frame arrays.
 * Line 1 (y=0):  6 frames of 16×32 — walkDown[0..2] + idleDown[0..2]
 * Line 2 (y=32): 6 frames of 16×32 — walkUp[0..2] + idleUp[0..2]
 * Line 3 (y=64): 3 frames of 32×32 — walkRight[0..2]
 */
export function decodePetPng(pngBuffer: Buffer): PetSpriteFrames {
  try {
    const png = PNG.sync.read(sanitizePngBuffer(pngBuffer));

    if (png.width !== PET_IMAGE_WIDTH || png.height !== PET_IMAGE_HEIGHT) {
      console.warn(
        `[PngDecoder] Pet sprite has unexpected dimensions: ${png.width}×${png.height} (expected ${PET_IMAGE_WIDTH}×${PET_IMAGE_HEIGHT})`,
      );
      throw new Error('Invalid pet sprite dimensions');
    }

    function extractFrame(ox: number, oy: number, w: number, h: number): string[][] {
      const sprite: string[][] = [];
      for (let y = 0; y < h; y++) {
        const row: string[] = [];
        for (let x = 0; x < w; x++) {
          const idx = ((oy + y) * png.width + (ox + x)) * 4;
          row.push(
            rgbaToHex(png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]),
          );
        }
        sprite.push(row);
      }
      return sprite;
    }

    // Line 1 (y=0): 6 frames of 16×32 — walkDown[0..2] + idleDown[0..2]
    const walkDown: string[][][] = [];
    for (let f = 0; f < PET_WALK_FRAMES_VERT; f++) {
      walkDown.push(extractFrame(f * PET_FRAME_W_SMALL, 0, PET_FRAME_W_SMALL, PET_FRAME_H));
    }
    const idleDown: string[][][] = [];
    for (let f = 0; f < PET_IDLE_FRAMES_VERT; f++) {
      idleDown.push(
        extractFrame(
          (PET_WALK_FRAMES_VERT + f) * PET_FRAME_W_SMALL,
          0,
          PET_FRAME_W_SMALL,
          PET_FRAME_H,
        ),
      );
    }

    // Line 2 (y=32): 6 frames of 16×32 — walkUp[0..2] + idleUp[0..2]
    const walkUp: string[][][] = [];
    for (let f = 0; f < PET_WALK_FRAMES_VERT; f++) {
      walkUp.push(extractFrame(f * PET_FRAME_W_SMALL, PET_FRAME_H, PET_FRAME_W_SMALL, PET_FRAME_H));
    }
    const idleUp: string[][][] = [];
    for (let f = 0; f < PET_IDLE_FRAMES_VERT; f++) {
      idleUp.push(
        extractFrame(
          (PET_WALK_FRAMES_VERT + f) * PET_FRAME_W_SMALL,
          PET_FRAME_H,
          PET_FRAME_W_SMALL,
          PET_FRAME_H,
        ),
      );
    }

    // Line 3 (y=64): 3 frames of 32×32 — walkRight[0..2]
    const walkRight: string[][][] = [];
    for (let f = 0; f < PET_WALK_FRAMES_HORIZ; f++) {
      walkRight.push(
        extractFrame(f * PET_FRAME_W_LARGE, PET_FRAME_H * 2, PET_FRAME_W_LARGE, PET_FRAME_H),
      );
    }

    return { walkDown, idleDown, walkUp, idleUp, walkRight };
  } catch (err) {
    console.warn(
      `[PngDecoder] Failed to parse pet PNG: ${err instanceof Error ? err.message : err}`,
    );
    const emptySmall = (): string[][] =>
      Array.from({ length: PET_FRAME_H }, () => new Array(PET_FRAME_W_SMALL).fill(''));
    const emptyLarge = (): string[][] =>
      Array.from({ length: PET_FRAME_H }, () => new Array(PET_FRAME_W_LARGE).fill(''));
    return {
      walkDown: [emptySmall(), emptySmall(), emptySmall()],
      idleDown: [emptySmall(), emptySmall(), emptySmall()],
      walkUp: [emptySmall(), emptySmall(), emptySmall()],
      idleUp: [emptySmall(), emptySmall(), emptySmall()],
      walkRight: [emptyLarge(), emptyLarge(), emptyLarge()],
    };
  }
}

/**
 * Decode a single floor tile PNG (16×16 grayscale pattern).
 */
export function decodeFloorPng(pngBuffer: Buffer): string[][] {
  return pngToSpriteData(pngBuffer, FLOOR_TILE_SIZE, FLOOR_TILE_SIZE);
}
