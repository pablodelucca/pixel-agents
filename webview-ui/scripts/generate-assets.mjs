/**
 * Prebuild script: generates browser mock assets for standalone dev mode.
 *
 * Outputs:
 *   public/assets/furniture-catalog.json  — flat catalog array with furniturePath fields
 *   public/assets/asset-index.json        — lists of floor/wall/character/layout filenames
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, '../public/assets');
const furnitureDir = path.join(assetsDir, 'furniture');

// ── Manifest flattening (mirrors assetLoader.ts flattenManifest) ──────────────

function flattenManifest(node, inherited, folderName) {
  if (node.type === 'asset') {
    const orientation = node.orientation ?? inherited.orientation;
    const state = node.state ?? inherited.state;
    return [
      {
        id: node.id,
        name: inherited.name,
        label: inherited.name,
        category: inherited.category,
        file: node.file,
        furniturePath: `furniture/${folderName}/${node.file}`,
        width: node.width,
        height: node.height,
        footprintW: node.footprintW,
        footprintH: node.footprintH,
        isDesk: inherited.category === 'desks',
        canPlaceOnWalls: inherited.canPlaceOnWalls,
        canPlaceOnSurfaces: inherited.canPlaceOnSurfaces,
        backgroundTiles: inherited.backgroundTiles,
        groupId: inherited.groupId,
        ...(orientation ? { orientation } : {}),
        ...(state ? { state } : {}),
        ...(node.mirrorSide ? { mirrorSide: true } : {}),
        ...(inherited.rotationScheme ? { rotationScheme: inherited.rotationScheme } : {}),
        ...(inherited.animationGroup ? { animationGroup: inherited.animationGroup } : {}),
        ...(node.frame !== undefined ? { frame: node.frame } : {}),
      },
    ];
  }

  // Group node
  const results = [];
  for (const member of node.members) {
    const childProps = { ...inherited };

    if (node.groupType === 'rotation' && node.rotationScheme) {
      childProps.rotationScheme = node.rotationScheme;
    }
    if (node.groupType === 'state') {
      if (node.orientation) childProps.orientation = node.orientation;
      if (node.state) childProps.state = node.state;
    }
    if (node.groupType === 'animation') {
      const orient = node.orientation ?? inherited.orientation ?? '';
      const st = node.state ?? inherited.state ?? '';
      childProps.animationGroup = `${inherited.groupId}_${orient}_${st}`.toUpperCase();
      if (node.state) childProps.state = node.state;
    }
    if (node.orientation && !childProps.orientation) {
      childProps.orientation = node.orientation;
    }

    results.push(...flattenManifest(member, childProps, folderName));
  }
  return results;
}

function processManifest(manifest, folderName) {
  const inherited = {
    groupId: manifest.id,
    name: manifest.name,
    category: manifest.category,
    canPlaceOnWalls: manifest.canPlaceOnWalls,
    canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
    backgroundTiles: manifest.backgroundTiles,
  };

  if (manifest.type === 'asset') {
    return [
      {
        id: manifest.id,
        name: manifest.name,
        label: manifest.name,
        category: manifest.category,
        file: manifest.file ?? `${manifest.id}.png`,
        furniturePath: `furniture/${folderName}/${manifest.file ?? `${manifest.id}.png`}`,
        width: manifest.width,
        height: manifest.height,
        footprintW: manifest.footprintW,
        footprintH: manifest.footprintH,
        isDesk: manifest.category === 'desks',
        canPlaceOnWalls: manifest.canPlaceOnWalls,
        canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
        backgroundTiles: manifest.backgroundTiles,
        groupId: manifest.id,
      },
    ];
  }

  if (manifest.rotationScheme) inherited.rotationScheme = manifest.rotationScheme;

  const rootGroup = {
    type: 'group',
    groupType: manifest.groupType,
    rotationScheme: manifest.rotationScheme,
    members: manifest.members,
  };
  return flattenManifest(rootGroup, inherited, folderName);
}

// ── Generate furniture-catalog.json ──────────────────────────────────────────

const catalog = [];

if (fs.existsSync(furnitureDir)) {
  const entries = fs.readdirSync(furnitureDir, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const folderName of dirs) {
    const manifestPath = path.join(furnitureDir, folderName, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      catalog.push(...processManifest(manifest, folderName));
    } catch (err) {
      console.warn(`  ⚠️  Error processing ${folderName}: ${err.message}`);
    }
  }
}

fs.writeFileSync(path.join(assetsDir, 'furniture-catalog.json'), JSON.stringify(catalog, null, 2));
console.log(`✓ furniture-catalog.json (${catalog.length} entries)`);

// ── Generate asset-index.json ─────────────────────────────────────────────────

function listFiles(subdir, pattern) {
  const dir = path.join(assetsDir, subdir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => pattern.test(f))
    .sort((a, b) => {
      const na = parseInt(/(\d+)/.exec(a)?.[1] ?? '0', 10);
      const nb = parseInt(/(\d+)/.exec(b)?.[1] ?? '0', 10);
      return na - nb;
    });
}

// Find the highest-revision default layout file
function findDefaultLayout() {
  const files = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
  let bestRev = 0;
  let bestFile = null;
  for (const f of files) {
    const m = /^default-layout-(\d+)\.json$/.exec(f);
    if (m) {
      const rev = parseInt(m[1], 10);
      if (rev > bestRev) {
        bestRev = rev;
        bestFile = f;
      }
    }
  }
  return (
    bestFile ??
    (fs.existsSync(path.join(assetsDir, 'default-layout.json')) ? 'default-layout.json' : null)
  );
}

const assetIndex = {
  floors: listFiles('floors', /^floor_\d+\.png$/i),
  walls: listFiles('walls', /^wall_\d+\.png$/i),
  characters: listFiles('characters', /^char_\d+\.png$/i),
  defaultLayout: findDefaultLayout(),
};

fs.writeFileSync(path.join(assetsDir, 'asset-index.json'), JSON.stringify(assetIndex, null, 2));
console.log(
  `✓ asset-index.json (floors:${assetIndex.floors.length} walls:${assetIndex.walls.length} chars:${assetIndex.characters.length} layout:${assetIndex.defaultLayout})`,
);
