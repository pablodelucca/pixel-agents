import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';

import {
  CHAR_COUNT,
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHAR_FRAMES_PER_ROW,
  CHARACTER_DIRECTIONS,
  FLOOR_TILE_SIZE,
  LAYOUT_REVISION_KEY,
  PNG_ALPHA_THRESHOLD,
  WALL_BITMASK_COUNT,
  WALL_GRID_COLS,
  WALL_PIECE_HEIGHT,
  WALL_PIECE_WIDTH,
} from './constants.js';

function rgbaToHex(r: number, g: number, b: number, a: number): string {
  if (a < PNG_ALPHA_THRESHOLD) return '';
  const rgb =
    `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
  if (a >= 255) return rgb;
  return `${rgb}${a.toString(16).padStart(2, '0').toUpperCase()}`;
}

function pngToSpriteData(pngBuffer: Buffer, width: number, height: number): string[][] {
  try {
    const png = PNG.sync.read(pngBuffer);
    const sprite: string[][] = [];
    const data = png.data;

    for (let y = 0; y < height; y++) {
      const row: string[] = [];
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * png.width + x) * 4;
        row.push(
          rgbaToHex(
            data[pixelIndex],
            data[pixelIndex + 1],
            data[pixelIndex + 2],
            data[pixelIndex + 3],
          ),
        );
      }
      sprite.push(row);
    }
    return sprite;
  } catch {
    const sprite: string[][] = [];
    for (let y = 0; y < height; y++) {
      sprite.push(new Array(width).fill(''));
    }
    return sprite;
  }
}

// -- Manifest types (same as extension) --

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
  frame?: number;
  mirrorSide?: boolean;
}

interface ManifestGroup {
  type: 'group';
  groupType: 'rotation' | 'state' | 'animation';
  rotationScheme?: string;
  orientation?: string;
  state?: string;
  members: ManifestNode[];
}

type ManifestNode = ManifestAsset | ManifestGroup;

interface FurnitureManifest {
  id: string;
  name: string;
  category: string;
  canPlaceOnWalls: boolean;
  canPlaceOnSurfaces: boolean;
  backgroundTiles: number;
  type: 'asset' | 'group';
  file?: string;
  width?: number;
  height?: number;
  footprintW?: number;
  footprintH?: number;
  groupType?: string;
  rotationScheme?: string;
  members?: ManifestNode[];
}

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

interface InheritedProps {
  groupId: string;
  name: string;
  category: string;
  canPlaceOnWalls: boolean;
  canPlaceOnSurfaces: boolean;
  backgroundTiles: number;
  orientation?: string;
  state?: string;
  rotationScheme?: string;
  animationGroup?: string;
}

function flattenManifest(node: ManifestNode, inherited: InheritedProps): FurnitureAsset[] {
  if (node.type === 'asset') {
    const asset = node as ManifestAsset;
    const orientation = asset.orientation ?? inherited.orientation;
    const state = asset.state ?? inherited.state;
    return [
      {
        id: asset.id,
        name: inherited.name,
        label: inherited.name,
        category: inherited.category,
        file: asset.file,
        width: asset.width,
        height: asset.height,
        footprintW: asset.footprintW,
        footprintH: asset.footprintH,
        isDesk: inherited.category === 'desks',
        canPlaceOnWalls: inherited.canPlaceOnWalls,
        canPlaceOnSurfaces: inherited.canPlaceOnSurfaces,
        backgroundTiles: inherited.backgroundTiles,
        groupId: inherited.groupId,
        ...(orientation ? { orientation } : {}),
        ...(state ? { state } : {}),
        ...(asset.mirrorSide ? { mirrorSide: true } : {}),
        ...(inherited.rotationScheme ? { rotationScheme: inherited.rotationScheme } : {}),
        ...(inherited.animationGroup ? { animationGroup: inherited.animationGroup } : {}),
        ...(asset.frame !== undefined ? { frame: asset.frame } : {}),
      },
    ];
  }

  const group = node as ManifestGroup;
  const results: FurnitureAsset[] = [];
  for (const member of group.members) {
    const childProps: InheritedProps = { ...inherited };
    if (group.groupType === 'rotation' && group.rotationScheme) {
      childProps.rotationScheme = group.rotationScheme;
    }
    if (group.groupType === 'state') {
      if (group.orientation) childProps.orientation = group.orientation;
      if (group.state) childProps.state = group.state;
    }
    if (group.groupType === 'animation') {
      const orient = group.orientation ?? inherited.orientation ?? '';
      const st = group.state ?? inherited.state ?? '';
      childProps.animationGroup = `${inherited.groupId}_${orient}_${st}`.toUpperCase();
      if (group.state) childProps.state = group.state;
    }
    if (group.orientation && !childProps.orientation) {
      childProps.orientation = group.orientation;
    }
    results.push(...flattenManifest(member, childProps));
  }
  return results;
}

export function loadAllAssets(assetsRoot: string): {
  catalog: FurnitureAsset[];
  sprites: Record<string, string[][]>;
  characters: Array<{ down: string[][][]; up: string[][][]; right: string[][][] }>;
  floorTiles: string[][][];
  wallSets: string[][][][];
  defaultLayout: Record<string, unknown> | null;
} {
  const assetsDir = path.join(assetsRoot, 'assets');

  // Load furniture
  const catalog: FurnitureAsset[] = [];
  const sprites: Record<string, string[][]> = {};
  const furnitureDir = path.join(assetsDir, 'furniture');
  if (fs.existsSync(furnitureDir)) {
    const entries = fs.readdirSync(furnitureDir, { withFileTypes: true });
    for (const dir of entries.filter((e) => e.isDirectory())) {
      const manifestPath = path.join(furnitureDir, dir.name, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as FurnitureManifest;
        const inherited: InheritedProps = {
          groupId: manifest.id,
          name: manifest.name,
          category: manifest.category,
          canPlaceOnWalls: manifest.canPlaceOnWalls,
          canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
          backgroundTiles: manifest.backgroundTiles,
        };

        let assets: FurnitureAsset[];
        if (manifest.type === 'asset') {
          assets = [
            {
              id: manifest.id,
              name: manifest.name,
              label: manifest.name,
              category: manifest.category,
              file: manifest.file ?? `${manifest.id}.png`,
              width: manifest.width!,
              height: manifest.height!,
              footprintW: manifest.footprintW!,
              footprintH: manifest.footprintH!,
              isDesk: manifest.category === 'desks',
              canPlaceOnWalls: manifest.canPlaceOnWalls,
              canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
              backgroundTiles: manifest.backgroundTiles,
              groupId: manifest.id,
            },
          ];
        } else {
          if (manifest.rotationScheme) inherited.rotationScheme = manifest.rotationScheme;
          const rootGroup: ManifestGroup = {
            type: 'group',
            groupType: manifest.groupType as 'rotation' | 'state' | 'animation',
            rotationScheme: manifest.rotationScheme,
            members: manifest.members!,
          };
          assets = flattenManifest(rootGroup, inherited);
        }

        for (const asset of assets) {
          const assetPath = path.join(furnitureDir, dir.name, asset.file);
          if (fs.existsSync(assetPath)) {
            sprites[asset.id] = pngToSpriteData(
              fs.readFileSync(assetPath),
              asset.width,
              asset.height,
            );
          }
        }
        catalog.push(...assets);
      } catch {
        /* skip broken manifests */
      }
    }
  }

  // Load characters
  const characters: Array<{ down: string[][][]; up: string[][][]; right: string[][][] }> = [];
  const charDir = path.join(assetsDir, 'characters');
  for (let ci = 0; ci < CHAR_COUNT; ci++) {
    const filePath = path.join(charDir, `char_${ci}.png`);
    if (!fs.existsSync(filePath)) break;
    const png = PNG.sync.read(fs.readFileSync(filePath));
    const charData: { down: string[][][]; up: string[][][]; right: string[][][] } = {
      down: [],
      up: [],
      right: [],
    };
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
            row.push(
              rgbaToHex(png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]),
            );
          }
          sprite.push(row);
        }
        frames.push(sprite);
      }
      charData[dir] = frames;
    }
    characters.push(charData);
  }

  // Load floor tiles
  const floorTiles: string[][][] = [];
  const floorsDir = path.join(assetsDir, 'floors');
  if (fs.existsSync(floorsDir)) {
    const floorFiles = fs
      .readdirSync(floorsDir)
      .filter((f) => /^floor_\d+\.png$/i.test(f))
      .sort((a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0]));
    for (const filename of floorFiles) {
      floorTiles.push(
        pngToSpriteData(
          fs.readFileSync(path.join(floorsDir, filename)),
          FLOOR_TILE_SIZE,
          FLOOR_TILE_SIZE,
        ),
      );
    }
  }

  // Load wall tiles
  const wallSets: string[][][][] = [];
  const wallsDir = path.join(assetsDir, 'walls');
  if (fs.existsSync(wallsDir)) {
    const wallFiles = fs
      .readdirSync(wallsDir)
      .filter((f) => /^wall_\d+\.png$/i.test(f))
      .sort((a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0]));
    for (const filename of wallFiles) {
      const png = PNG.sync.read(fs.readFileSync(path.join(wallsDir, filename)));
      const sprites: string[][][] = [];
      for (let mask = 0; mask < WALL_BITMASK_COUNT; mask++) {
        const ox = (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH;
        const oy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT;
        const sprite: string[][] = [];
        for (let r = 0; r < WALL_PIECE_HEIGHT; r++) {
          const row: string[] = [];
          for (let c = 0; c < WALL_PIECE_WIDTH; c++) {
            const idx = ((oy + r) * png.width + (ox + c)) * 4;
            row.push(
              rgbaToHex(png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]),
            );
          }
          sprite.push(row);
        }
        sprites.push(sprite);
      }
      wallSets.push(sprites);
    }
  }

  // Load default layout
  let defaultLayout: Record<string, unknown> | null = null;
  if (fs.existsSync(assetsDir)) {
    let bestRevision = 0;
    let bestPath: string | null = null;
    for (const file of fs.readdirSync(assetsDir)) {
      const match = /^default-layout-(\d+)\.json$/.exec(file);
      if (match) {
        const rev = parseInt(match[1], 10);
        if (rev > bestRevision) {
          bestRevision = rev;
          bestPath = path.join(assetsDir, file);
        }
      }
    }
    if (!bestPath) {
      const fallback = path.join(assetsDir, 'default-layout.json');
      if (fs.existsSync(fallback)) bestPath = fallback;
    }
    if (bestPath) {
      defaultLayout = JSON.parse(fs.readFileSync(bestPath, 'utf-8'));
      if (bestRevision > 0 && defaultLayout && !defaultLayout[LAYOUT_REVISION_KEY]) {
        defaultLayout[LAYOUT_REVISION_KEY] = bestRevision;
      }
    }
  }

  console.log(
    `[Assets] Loaded: ${catalog.length} furniture, ${characters.length} characters, ${floorTiles.length} floor tiles, ${wallSets.length} wall sets`,
  );
  return { catalog, sprites, characters, floorTiles, wallSets, defaultLayout };
}
