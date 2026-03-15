/**
 * Browser dev mode mock — loads assets directly from the Vite dev server
 * and injects the same postMessage events the VS Code extension would send.
 *
 * Only imported when import.meta.env.DEV === true; tree-shaken in production.
 */

// ── Constants (mirrors src/constants.ts, not imported to avoid Node.js deps) ──
const PNG_ALPHA_THRESHOLD = 2;
const WALL_PIECE_WIDTH = 16;
const WALL_PIECE_HEIGHT = 32;
const WALL_GRID_COLS = 4;
const WALL_BITMASK_COUNT = 16;
const FLOOR_TILE_SIZE = 16;
const CHAR_FRAME_W = 16;
const CHAR_FRAME_H = 32;
const CHAR_FRAMES_PER_ROW = 7;
const CHARACTER_DIRECTIONS = ['down', 'up', 'right'] as const;

// ── Types ──────────────────────────────────────────────────────────────────────

interface AssetIndex {
  floors: string[];
  walls: string[];
  characters: string[];
  defaultLayout: string | null;
}

interface CatalogEntry {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  furniturePath: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  groupId?: string;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
}

interface CharacterDirectionSprites {
  down: string[][][];
  up: string[][][];
  right: string[][][];
}

interface MockPayload {
  characters: CharacterDirectionSprites[];
  floorSprites: string[][][];
  wallSets: string[][][][];
  furnitureCatalog: CatalogEntry[];
  furnitureSprites: Record<string, string[][]>;
  layout: unknown;
}

// ── PNG decoding helpers ───────────────────────────────────────────────────────

function rgbaToHex(r: number, g: number, b: number, a: number): string {
  if (a < PNG_ALPHA_THRESHOLD) return '';
  const hex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  const rgb = `#${hex(r)}${hex(g)}${hex(b)}`;
  return a >= 255 ? rgb : `${rgb}${hex(a)}`;
}

async function fetchImageData(url: string, w: number, h: number): Promise<ImageData> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${url}: ${resp.status}`);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

async function decodeSprite(url: string, w: number, h: number): Promise<string[][]> {
  const { data } = await fetchImageData(url, w, h);
  const sprite: string[][] = [];
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      row.push(rgbaToHex(data[i], data[i + 1], data[i + 2], data[i + 3]));
    }
    sprite.push(row);
  }
  return sprite;
}

// ── Asset loaders ──────────────────────────────────────────────────────────────

async function loadCharacters(filenames: string[]): Promise<CharacterDirectionSprites[]> {
  const totalW = CHAR_FRAME_W * CHAR_FRAMES_PER_ROW;
  const totalH = CHAR_FRAME_H * CHARACTER_DIRECTIONS.length;
  return Promise.all(
    filenames.map(async (filename) => {
      const { data } = await fetchImageData(`/assets/characters/${filename}`, totalW, totalH);
      const charData: CharacterDirectionSprites = { down: [], up: [], right: [] };
      for (let dirIdx = 0; dirIdx < CHARACTER_DIRECTIONS.length; dirIdx++) {
        const dir = CHARACTER_DIRECTIONS[dirIdx];
        const rowOffsetY = dirIdx * CHAR_FRAME_H;
        const frames: string[][][] = [];
        for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) {
          const frameOffsetX = f * CHAR_FRAME_W;
          const sprite: string[][] = [];
          for (let y = 0; y < CHAR_FRAME_H; y++) {
            const row: string[] = [];
            for (let x = 0; x < CHAR_FRAME_W; x++) {
              const i = ((rowOffsetY + y) * totalW + (frameOffsetX + x)) * 4;
              row.push(rgbaToHex(data[i], data[i + 1], data[i + 2], data[i + 3]));
            }
            sprite.push(row);
          }
          frames.push(sprite);
        }
        charData[dir] = frames;
      }
      return charData;
    }),
  );
}

async function loadFloors(filenames: string[]): Promise<string[][][]> {
  return Promise.all(
    filenames.map((f) => decodeSprite(`/assets/floors/${f}`, FLOOR_TILE_SIZE, FLOOR_TILE_SIZE)),
  );
}

async function loadWalls(filenames: string[]): Promise<string[][][][]> {
  const totalW = WALL_GRID_COLS * WALL_PIECE_WIDTH;
  const totalH = (WALL_BITMASK_COUNT / WALL_GRID_COLS) * WALL_PIECE_HEIGHT;
  return Promise.all(
    filenames.map(async (filename) => {
      const { data } = await fetchImageData(`/assets/walls/${filename}`, totalW, totalH);
      const sprites: string[][][] = [];
      for (let mask = 0; mask < WALL_BITMASK_COUNT; mask++) {
        const ox = (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH;
        const oy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT;
        const sprite: string[][] = [];
        for (let r = 0; r < WALL_PIECE_HEIGHT; r++) {
          const row: string[] = [];
          for (let c = 0; c < WALL_PIECE_WIDTH; c++) {
            const i = ((oy + r) * totalW + (ox + c)) * 4;
            row.push(rgbaToHex(data[i], data[i + 1], data[i + 2], data[i + 3]));
          }
          sprite.push(row);
        }
        sprites.push(sprite);
      }
      return sprites;
    }),
  );
}

async function loadFurniture(catalog: CatalogEntry[]): Promise<Record<string, string[][]>> {
  const sprites: Record<string, string[][]> = {};
  await Promise.all(
    catalog.map(async (entry) => {
      try {
        sprites[entry.id] = await decodeSprite(
          `/assets/${entry.furniturePath}`,
          entry.width,
          entry.height,
        );
      } catch (err) {
        console.warn(`[BrowserMock] Failed to load ${entry.id}:`, err);
      }
    }),
  );
  return sprites;
}

// ── Module-level state ─────────────────────────────────────────────────────────

let mockPayload: MockPayload | null = null;
let dispatched = false;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Call before createRoot() in main.tsx.
 * Fetches all assets from the Vite dev server and stores them for dispatchMockMessages().
 */
export async function initBrowserMock(): Promise<void> {
  console.log('[BrowserMock] Loading assets...');

  const [assetIndex, catalogRaw] = await Promise.all([
    fetch('/assets/asset-index.json').then((r) => r.json()) as Promise<AssetIndex>,
    fetch('/assets/furniture-catalog.json').then((r) => r.json()) as Promise<CatalogEntry[]>,
  ]);

  const [characters, floorSprites, wallSets, furnitureSprites, layout] = await Promise.all([
    loadCharacters(assetIndex.characters),
    loadFloors(assetIndex.floors),
    loadWalls(assetIndex.walls),
    loadFurniture(catalogRaw),
    assetIndex.defaultLayout
      ? fetch(`/assets/${assetIndex.defaultLayout}`).then((r) => r.json())
      : Promise.resolve(null),
  ]);

  mockPayload = {
    characters,
    floorSprites,
    wallSets,
    furnitureCatalog: catalogRaw,
    furnitureSprites,
    layout,
  };

  console.log(
    `[BrowserMock] Ready — ${characters.length} chars, ${floorSprites.length} floors, ${wallSets.length} wall sets, ${catalogRaw.length} furniture items`,
  );
}

/**
 * Call inside a useEffect in App.tsx — after the window message listener
 * in useExtensionMessages has been registered.
 */
export function dispatchMockMessages(): void {
  if (!mockPayload || dispatched) return;
  dispatched = true;

  const { characters, floorSprites, wallSets, furnitureCatalog, furnitureSprites, layout } =
    mockPayload;

  function dispatch(data: unknown): void {
    window.dispatchEvent(new MessageEvent('message', { data }));
  }

  // Must match the load order defined in CLAUDE.md:
  // characterSpritesLoaded → floorTilesLoaded → wallTilesLoaded → furnitureAssetsLoaded → layoutLoaded
  dispatch({ type: 'characterSpritesLoaded', characters });
  dispatch({ type: 'floorTilesLoaded', sprites: floorSprites });
  dispatch({ type: 'wallTilesLoaded', sets: wallSets });
  dispatch({ type: 'furnitureAssetsLoaded', catalog: furnitureCatalog, sprites: furnitureSprites });
  dispatch({ type: 'layoutLoaded', layout });
  dispatch({ type: 'settingsLoaded', soundEnabled: false });

  console.log('[BrowserMock] Messages dispatched');
}
