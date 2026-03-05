"use strict";
/**
 * Asset Loader - Loads furniture assets from disk at startup
 *
 * Reads assets/furniture/furniture-catalog.json and loads all PNG files
 * into SpriteData format for use in the webview.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadFurnitureAssets = loadFurnitureAssets;
exports.loadDefaultLayout = loadDefaultLayout;
exports.loadWallTiles = loadWallTiles;
exports.sendWallTilesToWebview = sendWallTilesToWebview;
exports.loadFloorTiles = loadFloorTiles;
exports.sendFloorTilesToWebview = sendFloorTilesToWebview;
exports.loadCharacterSprites = loadCharacterSprites;
exports.sendCharacterSpritesToWebview = sendCharacterSpritesToWebview;
exports.sendAssetsToWebview = sendAssetsToWebview;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const pngjs_1 = require("pngjs");
const constants_js_1 = require("./constants.js");
/**
 * Load furniture assets from disk
 */
async function loadFurnitureAssets(workspaceRoot) {
    try {
        console.log(`[AssetLoader] workspaceRoot received: "${workspaceRoot}"`);
        const catalogPath = path.join(workspaceRoot, 'assets', 'furniture', 'furniture-catalog.json');
        console.log(`[AssetLoader] Attempting to load from: ${catalogPath}`);
        if (!fs.existsSync(catalogPath)) {
            console.log('ℹ️  No furniture catalog found at:', catalogPath);
            return null;
        }
        console.log('📦 Loading furniture assets from:', catalogPath);
        const catalogContent = fs.readFileSync(catalogPath, 'utf-8');
        const catalogData = JSON.parse(catalogContent);
        const catalog = catalogData.assets || [];
        const sprites = new Map();
        for (const asset of catalog) {
            try {
                // Ensure file path includes 'assets/' prefix if not already present
                let filePath = asset.file;
                if (!filePath.startsWith('assets/')) {
                    filePath = `assets/${filePath}`;
                }
                const assetPath = path.join(workspaceRoot, filePath);
                if (!fs.existsSync(assetPath)) {
                    console.warn(`  ⚠️  Asset file not found: ${asset.file}`);
                    continue;
                }
                // Read PNG and convert to SpriteData
                const pngBuffer = fs.readFileSync(assetPath);
                const spriteData = pngToSpriteData(pngBuffer, asset.width, asset.height);
                sprites.set(asset.id, spriteData);
            }
            catch (err) {
                console.warn(`  ⚠️  Error loading ${asset.id}: ${err instanceof Error ? err.message : err}`);
            }
        }
        console.log(`  ✓ Loaded ${sprites.size} / ${catalog.length} assets`);
        console.log(`[AssetLoader] ✅ Successfully loaded ${sprites.size} furniture sprites`);
        return { catalog, sprites };
    }
    catch (err) {
        console.error(`[AssetLoader] ❌ Error loading furniture assets: ${err instanceof Error ? err.message : err}`);
        return null;
    }
}
/**
 * Convert PNG buffer to SpriteData (2D array of hex color strings)
 *
 * PNG format: RGBA
 * SpriteData format: string[][] where '' = transparent, '#RRGGBB' = opaque color
 */
function pngToSpriteData(pngBuffer, width, height) {
    try {
        // Parse PNG using pngjs
        const png = pngjs_1.PNG.sync.read(pngBuffer);
        if (png.width !== width || png.height !== height) {
            console.warn(`PNG dimensions mismatch: expected ${width}×${height}, got ${png.width}×${png.height}`);
        }
        const sprite = [];
        const data = png.data; // Uint8Array with RGBA values
        for (let y = 0; y < height; y++) {
            const row = [];
            for (let x = 0; x < width; x++) {
                const pixelIndex = (y * png.width + x) * 4;
                const r = data[pixelIndex];
                const g = data[pixelIndex + 1];
                const b = data[pixelIndex + 2];
                const a = data[pixelIndex + 3];
                // If alpha is near zero, treat as transparent
                if (a < constants_js_1.PNG_ALPHA_THRESHOLD) {
                    row.push('');
                }
                else {
                    // Convert RGB to hex color string
                    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
                    row.push(hex);
                }
            }
            sprite.push(row);
        }
        return sprite;
    }
    catch (err) {
        console.warn(`Failed to parse PNG: ${err instanceof Error ? err.message : err}`);
        // Return transparent placeholder
        const sprite = [];
        for (let y = 0; y < height; y++) {
            sprite.push(new Array(width).fill(''));
        }
        return sprite;
    }
}
// ── Default layout loading ───────────────────────────────────
/**
 * Load the bundled default layout from assets/default-layout.json.
 * Returns the parsed layout object or null if not found.
 */
function loadDefaultLayout(assetsRoot) {
    try {
        const layoutPath = path.join(assetsRoot, 'assets', 'default-layout.json');
        if (!fs.existsSync(layoutPath)) {
            console.log('[AssetLoader] No default-layout.json found at:', layoutPath);
            return null;
        }
        const content = fs.readFileSync(layoutPath, 'utf-8');
        const layout = JSON.parse(content);
        console.log(`[AssetLoader] ✅ Loaded default layout (${layout.cols}×${layout.rows})`);
        return layout;
    }
    catch (err) {
        console.error(`[AssetLoader] ❌ Error loading default layout: ${err instanceof Error ? err.message : err}`);
        return null;
    }
}
/**
 * Load wall tiles from walls.png (64×128, 4×4 grid of 16×32 pieces).
 * Piece at bitmask M: col = M % 4, row = floor(M / 4).
 */
async function loadWallTiles(assetsRoot) {
    try {
        const wallPath = path.join(assetsRoot, 'assets', 'walls.png');
        if (!fs.existsSync(wallPath)) {
            console.log('[AssetLoader] No walls.png found at:', wallPath);
            return null;
        }
        console.log('[AssetLoader] Loading wall tiles from:', wallPath);
        const pngBuffer = fs.readFileSync(wallPath);
        const png = pngjs_1.PNG.sync.read(pngBuffer);
        const sprites = [];
        for (let mask = 0; mask < constants_js_1.WALL_BITMASK_COUNT; mask++) {
            const ox = (mask % constants_js_1.WALL_GRID_COLS) * constants_js_1.WALL_PIECE_WIDTH;
            const oy = Math.floor(mask / constants_js_1.WALL_GRID_COLS) * constants_js_1.WALL_PIECE_HEIGHT;
            const sprite = [];
            for (let r = 0; r < constants_js_1.WALL_PIECE_HEIGHT; r++) {
                const row = [];
                for (let c = 0; c < constants_js_1.WALL_PIECE_WIDTH; c++) {
                    const idx = ((oy + r) * png.width + (ox + c)) * 4;
                    const rv = png.data[idx];
                    const gv = png.data[idx + 1];
                    const bv = png.data[idx + 2];
                    const av = png.data[idx + 3];
                    if (av < constants_js_1.PNG_ALPHA_THRESHOLD) {
                        row.push('');
                    }
                    else {
                        row.push(`#${rv.toString(16).padStart(2, '0')}${gv.toString(16).padStart(2, '0')}${bv.toString(16).padStart(2, '0')}`.toUpperCase());
                    }
                }
                sprite.push(row);
            }
            sprites.push(sprite);
        }
        console.log(`[AssetLoader] ✅ Loaded ${sprites.length} wall tile pieces`);
        return { sprites };
    }
    catch (err) {
        console.error(`[AssetLoader] ❌ Error loading wall tiles: ${err instanceof Error ? err.message : err}`);
        return null;
    }
}
/**
 * Send wall tiles to webview
 */
function sendWallTilesToWebview(webview, wallTiles) {
    webview.postMessage({
        type: 'wallTilesLoaded',
        sprites: wallTiles.sprites,
    });
    console.log(`📤 Sent ${wallTiles.sprites.length} wall tile pieces to webview`);
}
/**
 * Load floor tile patterns from floors.png (7 tiles, 16px each, horizontal strip)
 */
async function loadFloorTiles(assetsRoot) {
    try {
        const floorPath = path.join(assetsRoot, 'assets', 'floors.png');
        if (!fs.existsSync(floorPath)) {
            console.log('[AssetLoader] No floors.png found at:', floorPath);
            return null;
        }
        console.log('[AssetLoader] Loading floor tiles from:', floorPath);
        const pngBuffer = fs.readFileSync(floorPath);
        const png = pngjs_1.PNG.sync.read(pngBuffer);
        const sprites = [];
        for (let t = 0; t < constants_js_1.FLOOR_PATTERN_COUNT; t++) {
            const sprite = [];
            for (let y = 0; y < constants_js_1.FLOOR_TILE_SIZE; y++) {
                const row = [];
                for (let x = 0; x < constants_js_1.FLOOR_TILE_SIZE; x++) {
                    const px = t * constants_js_1.FLOOR_TILE_SIZE + x;
                    const idx = (y * png.width + px) * 4;
                    const r = png.data[idx];
                    const g = png.data[idx + 1];
                    const b = png.data[idx + 2];
                    const a = png.data[idx + 3];
                    if (a < constants_js_1.PNG_ALPHA_THRESHOLD) {
                        row.push('');
                    }
                    else {
                        row.push(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase());
                    }
                }
                sprite.push(row);
            }
            sprites.push(sprite);
        }
        console.log(`[AssetLoader] ✅ Loaded ${sprites.length} floor tile patterns`);
        return { sprites };
    }
    catch (err) {
        console.error(`[AssetLoader] ❌ Error loading floor tiles: ${err instanceof Error ? err.message : err}`);
        return null;
    }
}
/**
 * Send floor tiles to webview
 */
function sendFloorTilesToWebview(webview, floorTiles) {
    webview.postMessage({
        type: 'floorTilesLoaded',
        sprites: floorTiles.sprites,
    });
    console.log(`📤 Sent ${floorTiles.sprites.length} floor tile patterns to webview`);
}
/**
 * Load pre-colored character sprites from assets/characters/ (6 PNGs, each 112×96).
 * Each PNG has 3 direction rows (down, up, right) × 7 frames (16×32 each).
 */
async function loadCharacterSprites(assetsRoot) {
    try {
        const charDir = path.join(assetsRoot, 'assets', 'characters');
        const characters = [];
        for (let ci = 0; ci < constants_js_1.CHAR_COUNT; ci++) {
            const filePath = path.join(charDir, `char_${ci}.png`);
            if (!fs.existsSync(filePath)) {
                console.log(`[AssetLoader] No character sprite found at: ${filePath}`);
                return null;
            }
            const pngBuffer = fs.readFileSync(filePath);
            const png = pngjs_1.PNG.sync.read(pngBuffer);
            const directions = constants_js_1.CHARACTER_DIRECTIONS;
            const charData = { down: [], up: [], right: [] };
            for (let dirIdx = 0; dirIdx < directions.length; dirIdx++) {
                const dir = directions[dirIdx];
                const rowOffsetY = dirIdx * constants_js_1.CHAR_FRAME_H;
                const frames = [];
                for (let f = 0; f < constants_js_1.CHAR_FRAMES_PER_ROW; f++) {
                    const sprite = [];
                    const frameOffsetX = f * constants_js_1.CHAR_FRAME_W;
                    for (let y = 0; y < constants_js_1.CHAR_FRAME_H; y++) {
                        const row = [];
                        for (let x = 0; x < constants_js_1.CHAR_FRAME_W; x++) {
                            const idx = (((rowOffsetY + y) * png.width) + (frameOffsetX + x)) * 4;
                            const r = png.data[idx];
                            const g = png.data[idx + 1];
                            const b = png.data[idx + 2];
                            const a = png.data[idx + 3];
                            if (a < constants_js_1.PNG_ALPHA_THRESHOLD) {
                                row.push('');
                            }
                            else {
                                row.push(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase());
                            }
                        }
                        sprite.push(row);
                    }
                    frames.push(sprite);
                }
                charData[dir] = frames;
            }
            characters.push(charData);
        }
        console.log(`[AssetLoader] ✅ Loaded ${characters.length} character sprites (${constants_js_1.CHAR_FRAMES_PER_ROW} frames × 3 directions each)`);
        return { characters };
    }
    catch (err) {
        console.error(`[AssetLoader] ❌ Error loading character sprites: ${err instanceof Error ? err.message : err}`);
        return null;
    }
}
/**
 * Send character sprites to webview
 */
function sendCharacterSpritesToWebview(webview, charSprites) {
    webview.postMessage({
        type: 'characterSpritesLoaded',
        characters: charSprites.characters,
    });
    console.log(`📤 Sent ${charSprites.characters.length} character sprites to webview`);
}
/**
 * Send loaded assets to webview
 */
function sendAssetsToWebview(webview, assets) {
    if (!assets) {
        console.log('[AssetLoader] ⚠️  No assets to send');
        return;
    }
    console.log('[AssetLoader] Converting sprites Map to object...');
    // Convert sprites Map to plain object for JSON serialization
    const spritesObj = {};
    for (const [id, spriteData] of assets.sprites) {
        spritesObj[id] = spriteData;
    }
    console.log(`[AssetLoader] Posting furnitureAssetsLoaded message with ${assets.catalog.length} assets`);
    webview.postMessage({
        type: 'furnitureAssetsLoaded',
        catalog: assets.catalog,
        sprites: spritesObj,
    });
    console.log(`📤 Sent ${assets.catalog.length} furniture assets to webview`);
}
//# sourceMappingURL=assetLoader.js.map