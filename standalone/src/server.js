/**
 * server.js — Standalone Pixel Agents server (ESM, pure JavaScript)
 *
 * Express HTTP server + WebSocket server that:
 * - Serves the built webview (index.html with injected ws-adapter)
 * - Serves office assets (furniture, characters, floors, walls)
 * - Bridges WebSocket messages between the React webview and the JSONL scanner
 * - Loads and sends assets on webviewReady (same messages the VS Code extension sends)
 */

import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

import { Scanner } from './scanner.js';

// ── Paths ────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');
const LAYOUT_DIR = path.join(os.homedir(), '.pixel-agents');
const LAYOUT_FILE = path.join(LAYOUT_DIR, 'layout.json');
const PORT = 3333;

// ── PNG Decoding (ported from shared/assets/pngDecoder.ts) ───
const PNG_ALPHA_THRESHOLD = 2;
const WALL_PIECE_WIDTH = 16;
const WALL_PIECE_HEIGHT = 32;
const WALL_GRID_COLS = 4;
const WALL_BITMASK_COUNT = 16;
const FLOOR_TILE_SIZE = 16;
const CHAR_FRAME_W = 16;
const CHAR_FRAME_H = 32;
const CHAR_FRAMES_PER_ROW = 7;
const CHAR_COUNT = 6;
const CHARACTER_DIRECTIONS = ['down', 'up', 'right'];

function rgbaToHex(r, g, b, a) {
  if (a < PNG_ALPHA_THRESHOLD) return '';
  const rgb =
    `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
  if (a >= 255) return rgb;
  return `${rgb}${a.toString(16).padStart(2, '0').toUpperCase()}`;
}

function pngToSpriteData(pngBuffer, width, height) {
  try {
    const png = PNG.sync.read(pngBuffer);
    const sprite = [];
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const idx = (y * png.width + x) * 4;
        row.push(rgbaToHex(png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]));
      }
      sprite.push(row);
    }
    return sprite;
  } catch {
    const sprite = [];
    for (let y = 0; y < height; y++) sprite.push(new Array(width).fill(''));
    return sprite;
  }
}

function parseWallPng(pngBuffer) {
  const png = PNG.sync.read(pngBuffer);
  const sprites = [];
  for (let mask = 0; mask < WALL_BITMASK_COUNT; mask++) {
    const ox = (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH;
    const oy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT;
    const sprite = [];
    for (let r = 0; r < WALL_PIECE_HEIGHT; r++) {
      const row = [];
      for (let c = 0; c < WALL_PIECE_WIDTH; c++) {
        const idx = ((oy + r) * png.width + (ox + c)) * 4;
        row.push(rgbaToHex(png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]));
      }
      sprite.push(row);
    }
    sprites.push(sprite);
  }
  return sprites;
}

function decodeCharacterPng(pngBuffer) {
  const png = PNG.sync.read(pngBuffer);
  const charData = { down: [], up: [], right: [] };
  for (let dirIdx = 0; dirIdx < CHARACTER_DIRECTIONS.length; dirIdx++) {
    const dir = CHARACTER_DIRECTIONS[dirIdx];
    const rowOffsetY = dirIdx * CHAR_FRAME_H;
    const frames = [];
    for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) {
      const sprite = [];
      const frameOffsetX = f * CHAR_FRAME_W;
      for (let y = 0; y < CHAR_FRAME_H; y++) {
        const row = [];
        for (let x = 0; x < CHAR_FRAME_W; x++) {
          const idx = ((rowOffsetY + y) * png.width + (frameOffsetX + x)) * 4;
          row.push(rgbaToHex(png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]));
        }
        sprite.push(row);
      }
      frames.push(sprite);
    }
    charData[dir] = frames;
  }
  return charData;
}

function decodeFloorPng(pngBuffer) {
  return pngToSpriteData(pngBuffer, FLOOR_TILE_SIZE, FLOOR_TILE_SIZE);
}

// ── Manifest flattening (ported from shared/assets/manifestUtils.ts) ──

function flattenManifest(node, inherited) {
  if (node.type === 'asset') {
    const orientation = node.orientation ?? inherited.orientation;
    const state = node.state ?? inherited.state;
    return [{
      id: node.id,
      name: inherited.name,
      label: inherited.name,
      category: inherited.category,
      file: node.file,
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
    }];
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
    results.push(...flattenManifest(member, childProps));
  }
  return results;
}

// ── Asset Loading ────────────────────────────────────────────

function listSortedFiles(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir)) {
    const match = pattern.exec(entry);
    if (match) {
      files.push({ index: parseInt(match[1], 10), filename: entry });
    }
  }
  return files.sort((a, b) => a.index - b.index);
}

function loadCharacterSprites(assetsDir) {
  const charDir = path.join(assetsDir, 'characters');
  const characters = [];
  for (let ci = 0; ci < CHAR_COUNT; ci++) {
    const filePath = path.join(charDir, `char_${ci}.png`);
    if (!fs.existsSync(filePath)) return null;
    characters.push(decodeCharacterPng(fs.readFileSync(filePath)));
  }
  console.log(`[Assets] Loaded ${characters.length} character sprites`);
  return { characters };
}

function loadFloorTiles(assetsDir) {
  const floorsDir = path.join(assetsDir, 'floors');
  const files = listSortedFiles(floorsDir, /^floor_(\d+)\.png$/i);
  if (files.length === 0) return null;
  const sprites = files.map(({ filename }) =>
    decodeFloorPng(fs.readFileSync(path.join(floorsDir, filename)))
  );
  console.log(`[Assets] Loaded ${sprites.length} floor tiles`);
  return { sprites };
}

function loadWallTiles(assetsDir) {
  const wallsDir = path.join(assetsDir, 'walls');
  const files = listSortedFiles(wallsDir, /^wall_(\d+)\.png$/i);
  if (files.length === 0) return null;
  const sets = files.map(({ filename }) =>
    parseWallPng(fs.readFileSync(path.join(wallsDir, filename)))
  );
  console.log(`[Assets] Loaded ${sets.length} wall tile set(s)`);
  return { sets };
}

function loadFurnitureAssets(assetsDir) {
  const furnitureDir = path.join(assetsDir, 'furniture');
  if (!fs.existsSync(furnitureDir)) return null;

  const entries = fs.readdirSync(furnitureDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length === 0) return null;

  const catalog = [];
  const sprites = {};

  for (const dir of dirs) {
    const itemDir = path.join(furnitureDir, dir.name);
    const manifestPath = path.join(itemDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const inherited = {
        groupId: manifest.id,
        name: manifest.name,
        category: manifest.category,
        canPlaceOnWalls: manifest.canPlaceOnWalls,
        canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
        backgroundTiles: manifest.backgroundTiles,
      };

      let assets;
      if (manifest.type === 'asset') {
        assets = [{
          id: manifest.id,
          name: manifest.name,
          label: manifest.name,
          category: manifest.category,
          file: manifest.file ?? `${manifest.id}.png`,
          width: manifest.width,
          height: manifest.height,
          footprintW: manifest.footprintW,
          footprintH: manifest.footprintH,
          isDesk: manifest.category === 'desks',
          canPlaceOnWalls: manifest.canPlaceOnWalls,
          canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
          backgroundTiles: manifest.backgroundTiles,
          groupId: manifest.id,
        }];
      } else {
        if (manifest.rotationScheme) inherited.rotationScheme = manifest.rotationScheme;
        const rootGroup = {
          type: 'group',
          groupType: manifest.groupType,
          rotationScheme: manifest.rotationScheme,
          members: manifest.members,
        };
        assets = flattenManifest(rootGroup, inherited);
      }

      for (const asset of assets) {
        try {
          const assetPath = path.join(itemDir, asset.file);
          if (!fs.existsSync(assetPath)) continue;
          sprites[asset.id] = pngToSpriteData(fs.readFileSync(assetPath), asset.width, asset.height);
        } catch (err) {
          console.warn(`  Warning: Error loading ${asset.id}:`, err?.message || err);
        }
      }
      catalog.push(...assets);
    } catch (err) {
      console.warn(`  Warning: Error processing ${dir.name}:`, err?.message || err);
    }
  }

  console.log(`[Assets] Loaded ${Object.keys(sprites).length}/${catalog.length} furniture assets`);
  return { catalog, sprites };
}

function loadDefaultLayout(assetsDir) {
  let bestRevision = 0;
  let bestPath = null;

  if (fs.existsSync(assetsDir)) {
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
  }

  if (!bestPath) {
    const fallback = path.join(assetsDir, 'default-layout.json');
    if (fs.existsSync(fallback)) bestPath = fallback;
  }

  if (!bestPath) return null;

  try {
    const layout = JSON.parse(fs.readFileSync(bestPath, 'utf-8'));
    if (bestRevision > 0 && !layout.layoutRevision) {
      layout.layoutRevision = bestRevision;
    }
    console.log(`[Assets] Loaded default layout from ${path.basename(bestPath)}`);
    return layout;
  } catch {
    return null;
  }
}

// ── Layout Persistence ───────────────────────────────────────

function readLayoutFromFile() {
  try {
    if (!fs.existsSync(LAYOUT_FILE)) return null;
    return JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function writeLayoutToFile(layout) {
  try {
    if (!fs.existsSync(LAYOUT_DIR)) fs.mkdirSync(LAYOUT_DIR, { recursive: true });
    const json = JSON.stringify(layout, null, 2);
    const tmpPath = LAYOUT_FILE + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, LAYOUT_FILE);
  } catch (err) {
    console.error('[Layout] Failed to write layout file:', err);
  }
}

/**
 * Load saved layout, applying default if none exists or if the bundled
 * default has a newer revision.
 */
function loadSavedLayout(defaultLayout) {
  const fromFile = readLayoutFromFile();
  if (fromFile) {
    const fileRevision = fromFile.layoutRevision ?? 0;
    const defaultRevision = defaultLayout?.layoutRevision ?? 0;
    if (defaultRevision > fileRevision && defaultLayout) {
      console.log(`[Layout] Revision outdated (${fileRevision} < ${defaultRevision}), resetting to default`);
      writeLayoutToFile(defaultLayout);
      return { layout: defaultLayout, wasReset: true };
    }
    return { layout: fromFile, wasReset: false };
  }
  if (defaultLayout) {
    writeLayoutToFile(defaultLayout);
    return { layout: defaultLayout, wasReset: false };
  }
  return null;
}

// ── In-memory state ──────────────────────────────────────────
let agentSeats = {};
let soundEnabled = true;

// ── Pre-load all assets at startup ───────────────────────────
console.log('[Server] Loading assets from', ASSETS_DIR);
const defaultLayout = loadDefaultLayout(ASSETS_DIR);
const characterSprites = loadCharacterSprites(ASSETS_DIR);
const floorTiles = loadFloorTiles(ASSETS_DIR);
const wallTiles = loadWallTiles(ASSETS_DIR);
const furnitureAssets = loadFurnitureAssets(ASSETS_DIR);
console.log('[Server] Asset loading complete');

// ── Express ──────────────────────────────────────────────────
const app = express();
const server = createServer(app);

// Serve static assets
app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets')));
app.use(express.static(PUBLIC_DIR));

// Fallback: serve index.html for SPA routing
app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── WebSocket ────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(data);
    }
  }
}

// ── Scanner ──────────────────────────────────────────────────
const scanner = new Scanner((message) => {
  broadcast(message);
});
scanner.start();

function sendInitialData(ws) {
  // 1. Existing agents from scanner
  const agents = [];
  const folderNames = {};
  for (const [id, agent] of scanner.getAgents()) {
    agents.push(id);
    if (agent.folderName) folderNames[id] = agent.folderName;
  }
  ws.send(JSON.stringify({
    type: 'existingAgents',
    agents,
    agentMeta: agentSeats,
    folderNames,
  }));

  // 2. Settings
  ws.send(JSON.stringify({ type: 'settingsLoaded', soundEnabled }));

  // 3. Character sprites
  if (characterSprites) {
    ws.send(JSON.stringify({
      type: 'characterSpritesLoaded',
      characters: characterSprites.characters,
    }));
  }

  // 4. Floor tiles
  if (floorTiles) {
    ws.send(JSON.stringify({
      type: 'floorTilesLoaded',
      sprites: floorTiles.sprites,
    }));
  }

  // 5. Wall tiles
  if (wallTiles) {
    ws.send(JSON.stringify({
      type: 'wallTilesLoaded',
      sets: wallTiles.sets,
    }));
  }

  // 6. Furniture assets
  if (furnitureAssets) {
    ws.send(JSON.stringify({
      type: 'furnitureAssetsLoaded',
      catalog: furnitureAssets.catalog,
      sprites: furnitureAssets.sprites,
    }));
  }

  // 7. Layout (always sent last — webview expects assets before layout)
  const layoutResult = loadSavedLayout(defaultLayout);
  ws.send(JSON.stringify({
    type: 'layoutLoaded',
    layout: layoutResult?.layout ?? null,
    wasReset: layoutResult?.wasReset ?? false,
  }));
}

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (message.type) {
      case 'webviewReady':
        sendInitialData(ws);
        break;

      case 'saveLayout':
        writeLayoutToFile(message.layout);
        break;

      case 'saveAgentSeats':
        agentSeats = message.seats ?? {};
        break;

      case 'setSoundEnabled':
        soundEnabled = !!message.enabled;
        break;

      case 'openClaude':
        // In standalone mode, we don't open terminals — scanner picks up new sessions
        console.log('[WS] openClaude received (no-op in standalone)');
        break;

      case 'focusAgent':
        console.log(`[WS] focusAgent ${message.id} (no-op in standalone)`);
        break;

      case 'closeAgent':
        console.log(`[WS] closeAgent ${message.id} (no-op in standalone)`);
        break;

      default:
        // Forward any other messages as-is to all clients (for future extensibility)
        break;
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
  });
});

// ── Start ────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[Server] Pixel Agents standalone running at http://localhost:${PORT}`);
});
