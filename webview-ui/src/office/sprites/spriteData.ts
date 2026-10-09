import type { ColorValue } from '../../components/ui/types.js';
import { PALETTE_COUNT } from '../../constants.js';
import { adjustSprite } from '../colorize.js';
import type { Direction, SpriteData } from '../types.js';
import { Direction as Dir } from '../types.js';
import bubblePermissionData from './bubble-permission.json';
import bubblePetData from './bubble-pet.json';
import bubbleWaitingData from './bubble-waiting.json';
import foosballReadyData from './foosball-ready.json';
import foosballSwingData from './foosball-swing.json';
import malletReadyData from './mallet-ready.json';
import malletSwingData from './mallet-swing.json';
import paddleReadyData from './paddle-ready.json';
import paddleSwingData from './paddle-swing.json';

// ── Speech Bubble Sprites ───────────────────────────────────────

interface BubbleSpriteJson {
  palette: Record<string, string>;
  pixels: string[][];
}

function resolveBubbleSprite(data: BubbleSpriteJson): SpriteData {
  return data.pixels.map((row) => row.map((key) => data.palette[key] ?? key));
}

/** Permission bubble: white square with "..." in amber, and a tail pointer (11x13) */
export const BUBBLE_PERMISSION_SPRITE: SpriteData = resolveBubbleSprite(bubblePermissionData);

/** Waiting bubble: white square with green checkmark, and a tail pointer (11x13) */
export const BUBBLE_WAITING_SPRITE: SpriteData = resolveBubbleSprite(bubbleWaitingData);

/** Heart bubble: pet petting feedback (11x13) */
export const BUBBLE_HEART_SPRITE: SpriteData = resolveBubbleSprite(bubblePetData);

// ════════════════════════════════════════════════════════════════
// Loaded character sprites (from PNG assets)
// ════════════════════════════════════════════════════════════════

interface LoadedCharacterData {
  down: SpriteData[];
  up: SpriteData[];
  right: SpriteData[];
}

let loadedCharacters: LoadedCharacterData[] | null = null;

/** Set pre-colored character sprites loaded from PNG assets. Call this when characterSpritesLoaded message arrives. */
export function setCharacterTemplates(data: LoadedCharacterData[]): void {
  loadedCharacters = data;
  // Clear cache so sprites are rebuilt from loaded data
  spriteCache.clear();
}

/** Return the number of loaded character palettes, or PALETTE_COUNT as fallback. */
export function getLoadedCharacterCount(): number {
  return loadedCharacters ? loadedCharacters.length : PALETTE_COUNT;
}

/** Flip a SpriteData horizontally (for generating left sprites from right) */
function flipSpriteHorizontal(sprite: SpriteData): SpriteData {
  return sprite.map((row) => [...row].reverse());
}

// ── Game play sprites (standing frame + per-game hand overlay) ──

/** Sprite-pixel where the right-facing standing frame shows the hand; its color
 *  fills the 'A' (arm) pixels of the swing overlay so the raised arm matches skin. */
const PADDLE_HAND_COL = 9;
const PADDLE_HAND_ROW = 22;
const PADDLE_ARM_KEY = 'A';

type OverlayPair = [BubbleSpriteJson, BubbleSpriteJson];
/** Hand overlay [ready, swing] per game table groupId (see GAME_TABLE_GROUP_IDS). */
const GAME_OVERLAYS: Record<string, OverlayPair> = {
  PING_PONG_TABLE: [paddleReadyData, paddleSwingData],
  AIR_HOCKEY_TABLE: [malletReadyData, malletSwingData],
  FOOSBALL_TABLE: [foosballReadyData, foosballSwingData],
};
const DEFAULT_GAME = 'PING_PONG_TABLE';
type PlaySprites = Record<Direction, [SpriteData, SpriteData]>;
const playSpriteCache = new WeakMap<CharacterSprites, Map<string, PlaySprites>>();

/** Overlay a paddle layer (right-facing) onto a standing frame. `mirror` flips the
 *  layer for left-facing frames (whose base is already flipped). */
function composePaddle(base: SpriteData, layer: BubbleSpriteJson, mirror: boolean): SpriteData {
  const skin =
    base[PADDLE_HAND_ROW]?.[
      mirror ? (base[0]?.length ?? 0) - 1 - PADDLE_HAND_COL : PADDLE_HAND_COL
    ];
  return base.map((row, y) =>
    row.map((px, x) => {
      const lx = mirror ? row.length - 1 - x : x;
      const key = layer.pixels[y]?.[lx];
      if (key === undefined || key === '_') return px;
      if (key === PADDLE_ARM_KEY) return skin || px;
      return layer.palette[key] ?? px;
    }),
  );
}

/** Standing body (walk frame 1) holding the game's gear: [ready, swing] per direction.
 *  Unknown games fall back to the ping pong paddle. */
export function getPlaySprites(sprites: CharacterSprites, game?: string): PlaySprites {
  const key = game && GAME_OVERLAYS[game] ? game : DEFAULT_GAME;
  let perGame = playSpriteCache.get(sprites);
  if (!perGame) {
    perGame = new Map();
    playSpriteCache.set(sprites, perGame);
  }
  const hit = perGame.get(key);
  if (hit) return hit;
  const layers = GAME_OVERLAYS[key];
  const pair = (dir: Direction, mirror: boolean): [SpriteData, SpriteData] => [
    composePaddle(sprites.walk[dir][1], layers[0], mirror),
    composePaddle(sprites.walk[dir][1], layers[1], mirror),
  ];
  const built: PlaySprites = {
    [Dir.DOWN]: pair(Dir.DOWN, false),
    [Dir.UP]: pair(Dir.UP, false),
    [Dir.RIGHT]: pair(Dir.RIGHT, false),
    [Dir.LEFT]: pair(Dir.LEFT, true),
  };
  perGame.set(key, built);
  return built;
}

// ════════════════════════════════════════════════════════════════
// Sprite resolution + caching
// ════════════════════════════════════════════════════════════════

export interface CharacterSprites {
  walk: Record<Direction, [SpriteData, SpriteData, SpriteData, SpriteData]>;
  typing: Record<Direction, [SpriteData, SpriteData]>;
  reading: Record<Direction, [SpriteData, SpriteData]>;
}

const spriteCache = new Map<string, CharacterSprites>();

/** Apply hue shift to every sprite in a CharacterSprites set */
function hueShiftSprites(sprites: CharacterSprites, hueShift: number): CharacterSprites {
  const color: ColorValue = { h: hueShift, s: 0, b: 0, c: 0 };
  const shift = (s: SpriteData) => adjustSprite(s, color);
  const shiftWalk = (
    arr: [SpriteData, SpriteData, SpriteData, SpriteData],
  ): [SpriteData, SpriteData, SpriteData, SpriteData] => [
    shift(arr[0]),
    shift(arr[1]),
    shift(arr[2]),
    shift(arr[3]),
  ];
  const shiftPair = (arr: [SpriteData, SpriteData]): [SpriteData, SpriteData] => [
    shift(arr[0]),
    shift(arr[1]),
  ];
  return {
    walk: {
      [Dir.DOWN]: shiftWalk(sprites.walk[Dir.DOWN]),
      [Dir.UP]: shiftWalk(sprites.walk[Dir.UP]),
      [Dir.RIGHT]: shiftWalk(sprites.walk[Dir.RIGHT]),
      [Dir.LEFT]: shiftWalk(sprites.walk[Dir.LEFT]),
    } as Record<Direction, [SpriteData, SpriteData, SpriteData, SpriteData]>,
    typing: {
      [Dir.DOWN]: shiftPair(sprites.typing[Dir.DOWN]),
      [Dir.UP]: shiftPair(sprites.typing[Dir.UP]),
      [Dir.RIGHT]: shiftPair(sprites.typing[Dir.RIGHT]),
      [Dir.LEFT]: shiftPair(sprites.typing[Dir.LEFT]),
    } as Record<Direction, [SpriteData, SpriteData]>,
    reading: {
      [Dir.DOWN]: shiftPair(sprites.reading[Dir.DOWN]),
      [Dir.UP]: shiftPair(sprites.reading[Dir.UP]),
      [Dir.RIGHT]: shiftPair(sprites.reading[Dir.RIGHT]),
      [Dir.LEFT]: shiftPair(sprites.reading[Dir.LEFT]),
    } as Record<Direction, [SpriteData, SpriteData]>,
  };
}

/** Create a transparent placeholder sprite of given dimensions */
function emptySprite(w: number, h: number): SpriteData {
  const rows: string[][] = [];
  for (let y = 0; y < h; y++) {
    rows.push(new Array(w).fill(''));
  }
  return rows;
}

export function getCharacterSprites(paletteIndex: number, hueShift = 0): CharacterSprites {
  const cacheKey = `${paletteIndex}:${hueShift}`;
  const cached = spriteCache.get(cacheKey);
  if (cached) return cached;

  let sprites: CharacterSprites;

  if (loadedCharacters) {
    // Use pre-colored character sprites directly (no palette swapping)
    const char = loadedCharacters[paletteIndex % loadedCharacters.length];
    const d = char.down;
    const u = char.up;
    const rt = char.right;
    const flip = flipSpriteHorizontal;

    sprites = {
      walk: {
        [Dir.DOWN]: [d[0], d[1], d[2], d[1]],
        [Dir.UP]: [u[0], u[1], u[2], u[1]],
        [Dir.RIGHT]: [rt[0], rt[1], rt[2], rt[1]],
        [Dir.LEFT]: [flip(rt[0]), flip(rt[1]), flip(rt[2]), flip(rt[1])],
      },
      typing: {
        [Dir.DOWN]: [d[3], d[4]],
        [Dir.UP]: [u[3], u[4]],
        [Dir.RIGHT]: [rt[3], rt[4]],
        [Dir.LEFT]: [flip(rt[3]), flip(rt[4])],
      },
      reading: {
        [Dir.DOWN]: [d[5], d[6]],
        [Dir.UP]: [u[5], u[6]],
        [Dir.RIGHT]: [rt[5], rt[6]],
        [Dir.LEFT]: [flip(rt[5]), flip(rt[6])],
      },
    };
  } else {
    // Fallback: return transparent placeholder sprites (16×32)
    const e = emptySprite(16, 32);
    const walkSet: [SpriteData, SpriteData, SpriteData, SpriteData] = [e, e, e, e];
    const pairSet: [SpriteData, SpriteData] = [e, e];
    sprites = {
      walk: {
        [Dir.DOWN]: walkSet,
        [Dir.UP]: walkSet,
        [Dir.RIGHT]: walkSet,
        [Dir.LEFT]: walkSet,
      },
      typing: {
        [Dir.DOWN]: pairSet,
        [Dir.UP]: pairSet,
        [Dir.RIGHT]: pairSet,
        [Dir.LEFT]: pairSet,
      },
      reading: {
        [Dir.DOWN]: pairSet,
        [Dir.UP]: pairSet,
        [Dir.RIGHT]: pairSet,
        [Dir.LEFT]: pairSet,
      },
    };
  }

  // Apply hue shift if non-zero
  if (hueShift !== 0) {
    sprites = hueShiftSprites(sprites, hueShift);
  }

  spriteCache.set(cacheKey, sprites);
  return sprites;
}
