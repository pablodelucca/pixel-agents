/**
 * Generate walls.png — a complete auto-tile wall set with all 16 bitmask configs.
 *
 * Layout: 4×4 grid, each cell is 16×32 pixels.
 * Piece at mask M: col = M % 4, row = floor(M / 4)
 * Image size: 64×128
 *
 * Bitmask: N=1, E=2, S=4, W=8
 *
 * Each piece shows:
 *   - Tile area (bottom 16 rows): wall plan/cap view (top surface)
 *   - Above tile (top 16 rows): 3D face extending upward
 *
 * Run: node scripts/generate-walls.js
 */

const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const TILE = 16;
const SPRITE_H = 32;
const GRID_COLS = 4;
const GRID_ROWS = 4;
const IMG_W = GRID_COLS * TILE;
const IMG_H = GRID_ROWS * SPRITE_H;

const TRANSPARENT = [0, 0, 0, 0];
const BORDER    = [0x30, 0x2A, 0x28, 255]; // #302A28
const CAP       = [0xFF, 0xFF, 0xFF, 255]; // #FFFFFF
const FACE      = [0xEB, 0xE8, 0xE0, 255]; // #EBE8E0

const WALL_BAND = 8;                       // wall thickness in pixels
const BAND_START = (TILE - WALL_BAND) / 2; // = 4
const BAND_END = BAND_START + WALL_BAND;   // = 12
const FACE_HEIGHT = 10;                    // face extends this many px above plan
const CAP_THICKNESS = 2;                   // cap highlight at top of wall

/**
 * Get the plan-view wall footprint (16×16 boolean grid) for a given mask.
 *
 * Center block always present. Arms extend in connected directions.
 * Wall band is 8px wide, centered at positions 4-11.
 */
function getPlanFootprint(mask) {
  const plan = Array.from({ length: 16 }, () => Array(16).fill(false));

  // Center block (always)
  for (let r = BAND_START; r < BAND_END; r++)
    for (let c = BAND_START; c < BAND_END; c++)
      plan[r][c] = true;

  // N arm (bit 0)
  if (mask & 1)
    for (let r = 0; r < BAND_START; r++)
      for (let c = BAND_START; c < BAND_END; c++)
        plan[r][c] = true;

  // E arm (bit 1)
  if (mask & 2)
    for (let r = BAND_START; r < BAND_END; r++)
      for (let c = BAND_END; c < TILE; c++)
        plan[r][c] = true;

  // S arm (bit 2)
  if (mask & 4)
    for (let r = BAND_END; r < TILE; r++)
      for (let c = BAND_START; c < BAND_END; c++)
        plan[r][c] = true;

  // W arm (bit 3)
  if (mask & 8)
    for (let r = BAND_START; r < BAND_END; r++)
      for (let c = 0; c < BAND_START; c++)
        plan[r][c] = true;

  return plan;
}

/**
 * Generate a single wall piece (16×32 RGBA pixel grid).
 */
function generatePiece(mask) {
  // 1. Build the full wall shape in 16×32 sprite space
  const shape = Array.from({ length: SPRITE_H }, () => Array(TILE).fill(false));

  const plan = getPlanFootprint(mask);

  // Copy plan to tile area (sprite rows 16-31 = tile rows 0-15)
  for (let r = 0; r < 16; r++)
    for (let c = 0; c < 16; c++)
      if (plan[r][c]) shape[16 + r][c] = true;

  // Extend face upward from the northernmost plan pixel per column.
  // When N is set and the column is in the vertical band, extend face all the
  // way to sprite row 0 so it seamlessly fills the overlap region with the
  // northern neighbor's plan area (sprites are bottom-anchored, so the southern
  // tile's rows 0-15 overlap with the northern tile's rows 16-31 in screen space).
  for (let c = 0; c < 16; c++) {
    let topRow = -1;
    for (let r = 0; r < 16; r++) {
      if (plan[r][c]) { topRow = r; break; }
    }
    if (topRow < 0) continue;

    const spriteNorth = 16 + topRow;
    const needsFullExtension = (mask & 1) && c >= BAND_START && c < BAND_END && topRow === 0;
    const faceTop = needsFullExtension ? 0 : Math.max(0, spriteNorth - FACE_HEIGHT);
    for (let sr = faceTop; sr < spriteNorth; sr++) {
      shape[sr][c] = true;
    }
  }

  // 2. Connection-aware neighbor check.
  //    When a pixel is at the sprite edge, check if the wall continues in that
  //    direction (via mask). If it does, treat the out-of-bounds neighbor as
  //    "shape" so no border is drawn at connecting edges.
  function hasNeighbor(r, c) {
    // In-bounds: just check shape
    if (r >= 0 && r < SPRITE_H && c >= 0 && c < TILE) return shape[r][c];

    // Out-of-bounds: check if wall continues via mask
    if (r < 0) {
      // Above sprite top — N connection (bit 0)
      return !!(mask & 1) && c >= BAND_START && c < BAND_END;
    }
    if (r >= SPRITE_H) {
      // Below sprite bottom — S connection (bit 2)
      return !!(mask & 4) && c >= BAND_START && c < BAND_END;
    }
    if (c < 0) {
      // Left of sprite — W connection (bit 3)
      if (!(mask & 8)) return false;
      const planRow = r - 16;
      if (planRow >= BAND_START && planRow < BAND_END) return true;
      const faceTop = 16 + BAND_START - FACE_HEIGHT;
      if (r >= faceTop && r < 16 + BAND_START) return true;
      return false;
    }
    if (c >= TILE) {
      // Right of sprite — E connection (bit 1)
      if (!(mask & 2)) return false;
      const planRow = r - 16;
      if (planRow >= BAND_START && planRow < BAND_END) return true;
      const faceTop = 16 + BAND_START - FACE_HEIGHT;
      if (r >= faceTop && r < 16 + BAND_START) return true;
      return false;
    }
    return false;
  }

  // Find outline pixels (shape pixel with at least one non-shape neighbor)
  const isOutline = Array.from({ length: SPRITE_H }, () => Array(TILE).fill(false));
  for (let r = 0; r < SPRITE_H; r++) {
    for (let c = 0; c < TILE; c++) {
      if (!shape[r][c]) continue;
      if (!hasNeighbor(r - 1, c) ||
          !hasNeighbor(r + 1, c) ||
          !hasNeighbor(r, c - 1) ||
          !hasNeighbor(r, c + 1)) {
        isOutline[r][c] = true;
      }
    }
  }

  // 3. Find cap pixels (topmost CAP_THICKNESS non-outline rows per column).
  //    Suppress caps for columns in the wall band when N is set — the wall
  //    continues above so there's no visible "top" edge.
  const isCap = Array.from({ length: SPRITE_H }, () => Array(TILE).fill(false));
  for (let c = 0; c < TILE; c++) {
    // If N connected and this column is in the vertical band, skip cap
    if ((mask & 1) && c >= BAND_START && c < BAND_END) continue;
    let count = 0;
    for (let r = 0; r < SPRITE_H; r++) {
      if (shape[r][c] && !isOutline[r][c]) {
        isCap[r][c] = true;
        count++;
        if (count >= CAP_THICKNESS) break;
      }
    }
  }

  // 4. Assemble pixel colors
  const pixels = Array.from({ length: SPRITE_H }, () =>
    Array.from({ length: TILE }, () => [...TRANSPARENT])
  );

  for (let r = 0; r < SPRITE_H; r++) {
    for (let c = 0; c < TILE; c++) {
      if (!shape[r][c]) continue;
      if (isOutline[r][c]) {
        pixels[r][c] = [...BORDER];
      } else if (isCap[r][c]) {
        pixels[r][c] = [...CAP];
      } else {
        pixels[r][c] = [...FACE];
      }
    }
  }

  return pixels;
}

const png = new PNG({ width: IMG_W, height: IMG_H });

// Fill with transparent
for (let i = 0; i < png.data.length; i += 4) {
  png.data[i] = 0;
  png.data[i + 1] = 0;
  png.data[i + 2] = 0;
  png.data[i + 3] = 0;
}

// Generate and place each piece
for (let mask = 0; mask < 16; mask++) {
  const piece = generatePiece(mask);
  const col = mask % GRID_COLS;
  const row = Math.floor(mask / GRID_COLS);
  const ox = col * TILE;
  const oy = row * SPRITE_H;

  for (let r = 0; r < SPRITE_H; r++) {
    for (let c = 0; c < TILE; c++) {
      const idx = ((oy + r) * IMG_W + (ox + c)) * 4;
      png.data[idx]     = piece[r][c][0];
      png.data[idx + 1] = piece[r][c][1];
      png.data[idx + 2] = piece[r][c][2];
      png.data[idx + 3] = piece[r][c][3];
    }
  }
}

// Save
const outPath = path.join(__dirname, '..', 'webview-ui', 'public', 'assets', 'walls.png');
const buffer = PNG.sync.write(png);
fs.writeFileSync(outPath, buffer);

console.log(`✅ Generated walls.png (${IMG_W}×${IMG_H}) at ${outPath}`);
console.log('Layout: 4×4 grid, piece at mask M → col=M%4, row=floor(M/4)');
console.log('Bitmask: N=1, E=2, S=4, W=8');
console.log('');
for (let m = 0; m < 16; m++) {
  const dirs = [];
  if (m & 1) dirs.push('N');
  if (m & 2) dirs.push('E');
  if (m & 4) dirs.push('S');
  if (m & 8) dirs.push('W');
  console.log(`  mask ${m.toString().padStart(2)}: ${dirs.join('+') || '(isolated)'}`);
}
