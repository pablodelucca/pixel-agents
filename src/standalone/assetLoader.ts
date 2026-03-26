/**
 * Standalone asset loader for web development mode.
 * Loads PNG sprites and JSON data directly from /assets folder.
 */

import type { SpriteData } from '../office/types.js';

// ── Types ─────────────────────────────────────────────────────

export interface FurnitureAsset {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  groupId?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
  frameCount?: number;
  frameRate?: number;
}

interface ManifestAsset {
  type: 'asset';
  id: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  frame?: number;
}

interface ManifestGroup {
  type: 'group';
  groupType: 'rotation' | 'state' | 'animation';
  rotationScheme?: string;
  orientation?: string;
  state?: string;
  members: (ManifestAsset | ManifestGroup)[];
}

interface ManifestRoot {
  id: string;
  name: string;
  category: string;
  type: 'group';
  groupType: 'rotation';
  rotationScheme?: string;
  canPlaceOnWalls: boolean;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  members: (ManifestAsset | ManifestGroup)[];
}

export interface LoadedAssets {
  characters: Array<{
    down: SpriteData[];
    up: SpriteData[];
    right: SpriteData[];
  }>;
  floors: SpriteData[];
  walls: SpriteData[][];
  furniture: {
    catalog: FurnitureAsset[];
    sprites: Record<string, SpriteData>;
  };
  layout: unknown;
}

// ── PNG to SpriteData conversion ───────────────────────────────

const ALPHA_THRESHOLD = 2;

async function loadImage(src: string): Promise<ImageData> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Failed to load image: ${src}`);
  }
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

function imageDataToSpriteData(img: ImageData): SpriteData {
  const { width, height, data } = img;
  const sprite: SpriteData = [];

  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < ALPHA_THRESHOLD) {
        row.push(''); // transparent
      } else if (a === 255) {
        row.push(
          `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
        );
      } else {
        // Semi-transparent: include alpha
        row.push(
          `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}${a.toString(16).padStart(2, '0')}`,
        );
      }
    }
    sprite.push(row);
  }

  return sprite;
}

// ── Character Sprites ──────────────────────────────────────────

const CHARACTER_FRAMES = 7; // walk1, walk2, walk3, type1, type2, read1, read2
const FRAME_WIDTH = 16;
const FRAME_HEIGHT = 32; // 24px sprite + 8px padding
const DIRECTIONS = ['down', 'up', 'right'] as const;

async function loadCharacterSprites(): Promise<LoadedAssets['characters']> {
  const characters: LoadedAssets['characters'] = [];

  for (let i = 0; i < 6; i++) {
    try {
      const img = await loadImage(`/assets/characters/char_${i}.png`);
      const fullSprite = imageDataToSpriteData(img);

      const charData: LoadedAssets['characters'][0] = {
        down: [],
        up: [],
        right: [],
      };

      // Each row is a direction: row 0 = down, row 1 = up, row 2 = right
      for (let dirIdx = 0; dirIdx < 3; dirIdx++) {
        const dir = DIRECTIONS[dirIdx];
        // Extract 7 frames from this row
        for (let frame = 0; frame < CHARACTER_FRAMES; frame++) {
          const frameSprite: SpriteData = [];
          for (let y = 0; y < FRAME_HEIGHT; y++) {
            const row: string[] = [];
            for (let x = 0; x < FRAME_WIDTH; x++) {
              const srcY = dirIdx * FRAME_HEIGHT + y;
              const srcX = frame * FRAME_WIDTH + x;
              row.push(fullSprite[srcY]?.[srcX] ?? '');
            }
            frameSprite.push(row);
          }
          charData[dir].push(frameSprite);
        }
      }

      characters.push(charData);
    } catch (e) {
      console.warn(`[Standalone] Could not load char_${i}.png`, e);
    }
  }

  console.log(`[Standalone] Loaded ${characters.length} character sprites`);
  return characters;
}

// ── Floor Tiles ────────────────────────────────────────────────

async function loadFloorTiles(): Promise<SpriteData[]> {
  const floors: SpriteData[] = [];

  // Load individual floor tile images
  for (let i = 0; i <= 8; i++) {
    try {
      const img = await loadImage(`/assets/floors/floor_${i}.png`);
      floors.push(imageDataToSpriteData(img));
    } catch (e) {
      // Floor might not exist, skip silently
    }
  }

  console.log(`[Standalone] Loaded ${floors.length} floor tile patterns`);
  return floors;
}

// ── Wall Tiles ──────────────────────────────────────────────────

async function loadWallTiles(): Promise<SpriteData[][]> {
  // Load wall_0.png which contains 4x4 grid of 16x32 auto-tile pieces
  try {
    const img = await loadImage(`/assets/walls/wall_0.png`);
    const fullSprite = imageDataToSpriteData(img);

    // 4x4 grid of 16x32 pieces = 16 sprites indexed by bitmask
    const sprites: SpriteData[] = [];

    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const piece: SpriteData = [];
        for (let y = 0; y < 32; y++) {
          const pieceRow: string[] = [];
          for (let x = 0; x < 16; x++) {
            const srcY = row * 32 + y;
            const srcX = col * 16 + x;
            pieceRow.push(fullSprite[srcY]?.[srcX] ?? '');
          }
          piece.push(pieceRow);
        }
        sprites.push(piece);
      }
    }

    console.log(`[Standalone] Loaded ${sprites.length} wall tile sprites`);
    return [sprites]; // Single set of 16 sprites
  } catch (e) {
    console.warn(`[Standalone] Could not load wall tiles`, e);
    return [[]];
  }
}

// ── Furniture Catalog & Sprites ─────────────────────────────────

// Known furniture folders
const FURNITURE_FOLDERS = [
  'BIN',
  'BOOKSHELF',
  'CACTUS',
  'CLOCK',
  'COFFEE',
  'COFFEE_TABLE',
  'CUSHIONED_BENCH',
  'CUSHIONED_CHAIR',
  'DESK',
  'DOUBLE_BOOKSHELF',
  'HANGING_PLANT',
  'LARGE_PAINTING',
  'LARGE_PLANT',
  'PC',
  'PLANT',
  'PLANT_2',
  'POT',
  'SMALL_PAINTING',
  'SMALL_PAINTING_2',
  'SMALL_TABLE',
  'SOFA',
  'TABLE_FRONT',
  'WHITEBOARD',
  'WOODEN_BENCH',
  'WOODEN_CHAIR',
];

function flattenManifest(
  manifest: ManifestRoot,
  folderName: string,
): { assets: FurnitureAsset[]; sprites: [string, string][] } {
  const assets: FurnitureAsset[] = [];
  const spriteFiles: [string, string][] = [];

  function processMembers(
    members: (ManifestAsset | ManifestGroup)[],
    inherited: Partial<FurnitureAsset>,
  ) {
    for (const member of members) {
      if (member.type === 'asset') {
        const asset: FurnitureAsset = {
          id: member.id,
          name: member.id,
          label: member.id.replace(/_/g, ' '),
          category: manifest.category,
          file: `${folderName}/${member.file}`,
          width: member.width,
          height: member.height,
          footprintW: member.footprintW,
          footprintH: member.footprintH,
          isDesk: manifest.category === 'desks',
          canPlaceOnWalls: manifest.canPlaceOnWalls ?? false,
          groupId: manifest.id,
          canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
          backgroundTiles: manifest.backgroundTiles,
          orientation: member.orientation ?? inherited.orientation,
          state: member.state ?? inherited.state,
          mirrorSide: member.mirrorSide,
          frame: member.frame,
        };
        assets.push(asset);
        spriteFiles.push([member.id, `${folderName}/${member.file}`]);
      } else if (member.type === 'group') {
        processMembers(member.members, {
          ...inherited,
          orientation: member.orientation,
          state: member.state ?? inherited.state,
        });
      }
    }
  }

  processMembers(manifest.members, {});

  return { assets, sprites: spriteFiles };
}

async function loadFurniture(): Promise<LoadedAssets['furniture']> {
  const catalog: FurnitureAsset[] = [];
  const sprites: Record<string, SpriteData> = {};

  for (const folder of FURNITURE_FOLDERS) {
    try {
      const response = await fetch(`/assets/furniture/${folder}/manifest.json`);
      if (!response.ok) continue;

      const manifest = await response.json();

      // Handle simple assets (type: "asset" at root level)
      if (manifest.type === 'asset' && !manifest.members) {
        const asset: FurnitureAsset = {
          id: manifest.id,
          name: manifest.name || manifest.id,
          label: (manifest.name || manifest.id).replace(/_/g, ' '),
          category: manifest.category,
          file: `${folder}/${manifest.id}.png`,
          width: manifest.width,
          height: manifest.height,
          footprintW: manifest.footprintW,
          footprintH: manifest.footprintH,
          isDesk: manifest.category === 'desks',
          canPlaceOnWalls: manifest.canPlaceOnWalls ?? false,
          backgroundTiles: manifest.backgroundTiles,
        };
        catalog.push(asset);

        try {
          const img = await loadImage(`/assets/furniture/${folder}/${manifest.id}.png`);
          sprites[manifest.id] = imageDataToSpriteData(img);
        } catch (e) {
          console.warn(`[Standalone] Could not load sprite: ${folder}/${manifest.id}.png`);
        }
        continue;
      }

      // Handle animated assets (type: "animation")
      if (manifest.type === 'animation' && manifest.frames) {
        // Load all animation frames
        for (let i = 0; i < manifest.frames.length; i++) {
          const frame = manifest.frames[i];
          try {
            const img = await loadImage(`/assets/furniture/${folder}/${frame.file}`);
            sprites[frame.id] = imageDataToSpriteData(img);

            // Create catalog entry for each frame
            const asset: FurnitureAsset = {
              id: frame.id,
              name: `${manifest.name || manifest.id} Frame ${i}`,
              label: `${manifest.name || manifest.id} Frame ${i}`,
              category: manifest.category,
              file: `${folder}/${frame.file}`,
              width: manifest.width,
              height: manifest.height,
              footprintW: manifest.footprintW,
              footprintH: manifest.footprintH,
              isDesk: manifest.category === 'desks',
              canPlaceOnWalls: manifest.canPlaceOnWalls ?? false,
              backgroundTiles: manifest.backgroundTiles,
              animationGroup: manifest.animationGroup,
              frame: i,
            };
            catalog.push(asset);
          } catch (e) {
            console.warn(`[Standalone] Could not load sprite: ${folder}/${frame.file}`);
          }
        }
        continue;
      }

      // Handle group assets (type: "group" with members)
      const { assets, sprites: spriteFiles } = flattenManifest(manifest as ManifestRoot, folder);

      catalog.push(...assets);

      // Load sprites for each asset
      for (const [id, file] of spriteFiles) {
        try {
          const img = await loadImage(`/assets/furniture/${file}`);
          sprites[id] = imageDataToSpriteData(img);
        } catch (e) {
          console.warn(`[Standalone] Could not load sprite: ${file}`);
        }
      }
    } catch (e) {
      console.warn(`[Standalone] Could not load manifest for ${folder}`);
    }
  }

  console.log(
    `[Standalone] Loaded ${catalog.length} furniture catalog entries, ${Object.keys(sprites).length} sprites`,
  );
  return { catalog, sprites };
}

// ── Layout ─────────────────────────────────────────────────────

async function loadLayout(): Promise<unknown> {
  try {
    const response = await fetch('/assets/default-layout-1.json');
    if (response.ok) {
      const layout = await response.json();
      console.log(`[Standalone] Loaded default layout (${layout.cols}x${layout.rows})`);
      return layout;
    }
  } catch (e) {
    console.warn('[Standalone] Could not load default layout');
  }
  return null;
}

// ── Main Loader ─────────────────────────────────────────────────

export async function loadAllAssets(): Promise<LoadedAssets> {
  console.log('[Standalone] Loading assets...');

  const [characters, floors, walls, furniture, layout] = await Promise.all([
    loadCharacterSprites(),
    loadFloorTiles(),
    loadWallTiles(),
    loadFurniture(),
    loadLayout(),
  ]);

  console.log('[Standalone] All assets loaded!');

  return {
    characters,
    floors,
    walls,
    furniture,
    layout,
  };
}
