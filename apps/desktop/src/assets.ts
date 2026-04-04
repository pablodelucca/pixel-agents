import * as fs from 'fs';
import * as path from 'path';

import { buildFurnitureCatalog } from '../../../shared/assets/build.js';
import {
  decodeAllCharacters,
  decodeAllFloors,
  decodeAllFurniture,
  decodeAllWalls,
} from '../../../shared/assets/loader.js';
import type { CatalogEntry, CharacterDirectionSprites } from '../../../shared/assets/types.js';

export interface LoadedDesktopAssets {
  characters: CharacterDirectionSprites[];
  floors: string[][][];
  walls: string[][][][];
  furnitureCatalog: CatalogEntry[];
  furnitureSprites: Record<string, string[][]>;
}

function resolveAssetsDir(rootPath: string): string {
  const nestedAssets = path.join(rootPath, 'assets');
  if (fs.existsSync(nestedAssets)) return nestedAssets;
  return rootPath;
}

function loadFurnitureFromAssetsDir(assetsDir: string): {
  catalog: CatalogEntry[];
  sprites: Record<string, string[][]>;
} {
  const catalog = buildFurnitureCatalog(assetsDir);
  const sprites = decodeAllFurniture(assetsDir, catalog);
  return { catalog, sprites };
}

export function loadAllDesktopAssets(
  bundledAssetsRoot: string,
  externalAssetRoots: string[],
): LoadedDesktopAssets {
  const bundledAssetsDir = resolveAssetsDir(bundledAssetsRoot);
  const characters = decodeAllCharacters(bundledAssetsDir);
  const floors = decodeAllFloors(bundledAssetsDir);
  const walls = decodeAllWalls(bundledAssetsDir);

  const primaryFurniture = loadFurnitureFromAssetsDir(bundledAssetsDir);
  const spriteMap = new Map<string, string[][]>();
  const catalogById = new Map<string, CatalogEntry>();

  for (const entry of primaryFurniture.catalog) {
    catalogById.set(entry.id, entry);
    const sprite = primaryFurniture.sprites[entry.id];
    if (sprite) {
      spriteMap.set(entry.id, sprite);
    }
  }

  for (const externalRoot of externalAssetRoots) {
    try {
      const assetsDir = resolveAssetsDir(externalRoot);
      const externalFurniture = loadFurnitureFromAssetsDir(assetsDir);
      for (const entry of externalFurniture.catalog) {
        catalogById.set(entry.id, entry);
        const sprite = externalFurniture.sprites[entry.id];
        if (sprite) {
          spriteMap.set(entry.id, sprite);
        }
      }
    } catch {
      // Ignore malformed external packs.
    }
  }

  const furnitureCatalog = [...catalogById.values()];
  const furnitureSprites = Object.fromEntries(spriteMap.entries());

  return {
    characters,
    floors,
    walls,
    furnitureCatalog,
    furnitureSprites,
  };
}
