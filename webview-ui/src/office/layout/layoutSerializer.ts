import type { ColorValue } from '../../components/ui/types.js';
import {
  GAME_QUEUE_MARKER_RANGE,
  GAME_QUEUE_MAX,
  GAME_QUEUE_SPOT_GROUP_ID,
  GAME_TABLE_GROUP_IDS,
} from '../../constants.js';
import { getColorizedSprite } from '../colorize.js';
import type {
  FurnitureInstance,
  GameSlot,
  OfficeLayout,
  PlacedFurniture,
  Seat,
  TileType as TileTypeVal,
  WaitSpot,
} from '../types.js';
import { DEFAULT_COLS, DEFAULT_ROWS, Direction, TILE_SIZE, TileType } from '../types.js';
import { getCatalogEntry, getOrientationInGroup } from './furnitureCatalog.js';
import { isWalkable } from './tileMap.js';

/** Convert flat tile array from layout into 2D grid */
export function layoutToTileMap(layout: OfficeLayout): TileTypeVal[][] {
  const map: TileTypeVal[][] = [];
  for (let r = 0; r < layout.rows; r++) {
    const row: TileTypeVal[] = [];
    for (let c = 0; c < layout.cols; c++) {
      row.push(layout.tiles[r * layout.cols + c]);
    }
    map.push(row);
  }
  return map;
}

/** Convert placed furniture into renderable FurnitureInstance[] */
export function layoutToFurnitureInstances(furniture: PlacedFurniture[]): FurnitureInstance[] {
  // Pre-compute desk zY per tile so surface items can sort in front of desks
  const deskZByTile = new Map<string, number>();
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type);
    if (!entry || !entry.isDesk) continue;
    const deskZY = item.row * TILE_SIZE + entry.sprite.length;
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        const key = `${item.col + dc},${item.row + dr}`;
        const prev = deskZByTile.get(key);
        if (prev === undefined || deskZY > prev) deskZByTile.set(key, deskZY);
      }
    }
  }

  const instances: FurnitureInstance[] = [];
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type);
    if (!entry) continue;
    const x = item.col * TILE_SIZE;
    const y = item.row * TILE_SIZE;
    const spriteH = entry.sprite.length;
    let zY = y + spriteH;

    // Chair z-sorting: ensure characters sitting on chairs render correctly
    if (entry.category === 'chairs') {
      if (entry.orientation === 'back') {
        // Back-facing chairs render IN FRONT of the seated character
        // (the chair back visually occludes the character behind it).
        // Use the bottom footprint row so it sorts after the character
        // even when the chair has background tiles that push seats down.
        zY = (item.row + entry.footprintH) * TILE_SIZE + 1;
      } else {
        // All other chairs: cap zY to first row bottom so characters
        // at any seat tile render in front of the chair
        zY = (item.row + 1) * TILE_SIZE;
      }
    }

    // Surface items render in front of the desk they sit on
    if (entry.canPlaceOnSurfaces) {
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          const deskZ = deskZByTile.get(`${item.col + dc},${item.row + dr}`);
          if (deskZ !== undefined && deskZ + 0.5 > zY) zY = deskZ + 0.5;
        }
      }
    }

    // Colorize sprite if this furniture has a color override
    let sprite = entry.sprite;
    if (item.color) {
      const { h, s, b: bv, c: cv } = item.color;
      sprite = getColorizedSprite(
        `furn-${item.type}-${h}-${s}-${bv}-${cv}-${item.color.colorize ? 1 : 0}`,
        entry.sprite,
        item.color,
      );
    }

    // Determine if this instance should be mirrored (side asset used in "left" orientation)
    let mirrored = false;
    if (entry.mirrorSide) {
      const orientInGroup = getOrientationInGroup(item.type);
      if (orientInGroup === 'left') {
        mirrored = true;
      }
    }

    instances.push({ sprite, x, y, zY, ...(mirrored ? { mirrored: true } : {}) });
  }
  return instances;
}

/** Get all tiles blocked by furniture footprints, optionally excluding a set of tiles.
 *  Skips top backgroundTiles rows so characters can walk through them. */
export function getBlockedTiles(
  furniture: PlacedFurniture[],
  excludeTiles?: Set<string>,
): Set<string> {
  const tiles = new Set<string>();
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type);
    if (!entry) continue;
    const bgRows = entry.backgroundTiles || 0;
    for (let dr = 0; dr < entry.footprintH; dr++) {
      if (dr < bgRows) continue; // skip background rows — characters can walk through
      for (let dc = 0; dc < entry.footprintW; dc++) {
        const key = `${item.col + dc},${item.row + dr}`;
        if (excludeTiles && excludeTiles.has(key)) continue;
        tiles.add(key);
      }
    }
  }
  return tiles;
}

/** Whether a placed item is a two-player game table (ping pong, air hockey, ...). */
export function isGameTable(type: string): boolean {
  const entry = getCatalogEntry(type);
  return !!entry?.groupId && (GAME_TABLE_GROUP_IDS as readonly string[]).includes(entry.groupId);
}

/** Standing slots beside every game table: one tile left and one tile right of the
 *  table's bottom row, facing inward. Slots on non-walkable tiles are dropped. */
export function layoutToGameSlots(
  furniture: PlacedFurniture[],
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): GameSlot[] {
  const slots: GameSlot[] = [];
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type);
    if (!entry?.groupId || !isGameTable(item.type)) continue;
    const row = item.row + entry.footprintH - 1;
    const ends: Array<[number, Direction, 0 | 1]> = [
      [item.col - 1, Direction.RIGHT, 0],
      [item.col + entry.footprintW, Direction.LEFT, 1],
    ];
    for (const [col, dir, side] of ends) {
      if (isWalkable(col, row, tileMap, blockedTiles)) {
        slots.push({ uid: item.uid, game: entry.groupId, side, col, row, dir });
      }
    }
  }
  return slots;
}

/** Tile distance from a point to a rectangle (0 when inside). */
function rectDistance(
  col: number,
  row: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const dx = col < x0 ? x0 - col : col > x1 ? col - x1 : 0;
  const dy = row < y0 ? y0 - row : row > y1 ? row - y1 : 0;
  return Math.max(dx, dy);
}

/** Face a tile toward the centre of a rectangle (horizontal wins ties). */
function faceToward(col: number, row: number, cx: number, cy: number): Direction {
  const dx = cx - col;
  const dy = cy - row;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? Direction.RIGHT : Direction.LEFT;
  return dy > 0 ? Direction.DOWN : Direction.UP;
}

/** Spectator spots for every game table.
 *
 *  Default: a row one tile below the table (a gap so nobody stands in front of
 *  the ball), spanning the table plus one tile each side, all facing up — at most
 *  GAME_QUEUE_MAX. Users override this by placing GAME_QUEUE_SPOT floor markers:
 *  each marker within GAME_QUEUE_MARKER_RANGE of a table becomes a spot for its
 *  nearest table, facing it, and that table then uses only its markers. */
export function layoutToWaitSpots(
  furniture: PlacedFurniture[],
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): WaitSpot[] {
  const tables = furniture
    .map((item) => ({ item, entry: getCatalogEntry(item.type) }))
    .filter(({ item, entry }) => entry?.groupId && isGameTable(item.type))
    .map(({ item, entry }) => ({
      item,
      x0: item.col,
      y0: item.row,
      x1: item.col + entry!.footprintW - 1,
      y1: item.row + entry!.footprintH - 1,
    }));
  if (tables.length === 0) return [];

  // Markers → nearest table in range
  const markersByTable = new Map<string, Array<{ col: number; row: number; d: number }>>();
  for (const m of furniture) {
    if (getCatalogEntry(m.type)?.groupId !== GAME_QUEUE_SPOT_GROUP_ID) continue;
    let best: (typeof tables)[number] | null = null;
    let bestD = Infinity;
    for (const t of tables) {
      const d = rectDistance(m.col, m.row, t.x0, t.y0, t.x1, t.y1);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (!best || bestD === 0 || bestD > GAME_QUEUE_MARKER_RANGE) continue;
    if (!isWalkable(m.col, m.row, tileMap, blockedTiles)) continue;
    const list = markersByTable.get(best.item.uid) ?? [];
    list.push({ col: m.col, row: m.row, d: bestD });
    markersByTable.set(best.item.uid, list);
  }

  const seats = layoutToSeats(furniture);
  const endTiles = new Set(
    layoutToGameSlots(furniture, tileMap, blockedTiles).map((e) => `${e.col},${e.row}`),
  );
  const spots: WaitSpot[] = [];
  for (const t of tables) {
    const cx = (t.x0 + t.x1) / 2;
    const cy = (t.y0 + t.y1) / 2;
    const markers = markersByTable.get(t.item.uid);
    if (markers && markers.length > 0) {
      for (const m of markers.sort((a, b) => a.d - b.d)) {
        spots.push({
          uid: t.item.uid,
          col: m.col,
          row: m.row,
          dir: faceToward(m.col, m.row, cx, cy),
        });
      }
      continue;
    }
    let kept = 0;
    // Nearby unclaimed-by-layout seats (sofas, chairs) first: spectators sit there
    const nearSeats = [...seats.entries()]
      .map(([seatId, seat]) => ({
        seatId,
        seat,
        d: rectDistance(seat.seatCol, seat.seatRow, t.x0, t.y0, t.x1, t.y1),
      }))
      .filter(
        ({ seat, d }) =>
          d > 0 && d <= GAME_QUEUE_MARKER_RANGE && !endTiles.has(`${seat.seatCol},${seat.seatRow}`),
      )
      .sort((a, b) => a.d - b.d);
    for (const { seatId, seat } of nearSeats) {
      if (kept >= GAME_QUEUE_MAX) break;
      spots.push({
        uid: t.item.uid,
        col: seat.seatCol,
        row: seat.seatRow,
        dir: seat.facingDir,
        seatId,
      });
      kept++;
    }
    // Then a row one tile of air below the table, centred, spilling one tile past each end
    const row = t.y1 + 2;
    const order = [0, 1, -1, 2, -2, 3, -3].map((k) => Math.round(cx) + k);
    for (const col of order) {
      if (kept >= GAME_QUEUE_MAX) break;
      if (col < t.x0 - 1 || col > t.x1 + 1) continue;
      if (!isWalkable(col, row, tileMap, blockedTiles)) continue;
      spots.push({ uid: t.item.uid, col, row, dir: Direction.UP });
      kept++;
    }
  }
  return spots;
}

/** Get tiles blocked for placement purposes — skips top backgroundTiles rows per item */
export function getPlacementBlockedTiles(
  furniture: PlacedFurniture[],
  excludeUid?: string,
): Set<string> {
  const tiles = new Set<string>();
  for (const item of furniture) {
    if (item.uid === excludeUid) continue;
    const entry = getCatalogEntry(item.type);
    if (!entry) continue;
    const bgRows = entry.backgroundTiles || 0;
    for (let dr = 0; dr < entry.footprintH; dr++) {
      if (dr < bgRows) continue; // skip background rows
      for (let dc = 0; dc < entry.footprintW; dc++) {
        tiles.add(`${item.col + dc},${item.row + dr}`);
      }
    }
  }
  return tiles;
}

/** Map chair orientation to character facing direction */
function orientationToFacing(orientation: string): Direction {
  switch (orientation) {
    case 'front':
      return Direction.DOWN;
    case 'back':
      return Direction.UP;
    case 'left':
      return Direction.LEFT;
    case 'right':
    case 'side':
      return Direction.RIGHT;
    default:
      return Direction.DOWN;
  }
}

/** Generate seats from chair furniture.
 *  Facing priority: 1) chair orientation, 2) adjacent desk, 3) forward (DOWN). */
export function layoutToSeats(furniture: PlacedFurniture[]): Map<string, Seat> {
  const seats = new Map<string, Seat>();

  // Build set of all desk tiles
  const deskTiles = new Set<string>();
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type);
    if (!entry || !entry.isDesk) continue;
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        deskTiles.add(`${item.col + dc},${item.row + dr}`);
      }
    }
  }

  const dirs: Array<{ dc: number; dr: number; facing: Direction }> = [
    { dc: 0, dr: -1, facing: Direction.UP }, // desk is above chair → face UP
    { dc: 0, dr: 1, facing: Direction.DOWN }, // desk is below chair → face DOWN
    { dc: -1, dr: 0, facing: Direction.LEFT }, // desk is left of chair → face LEFT
    { dc: 1, dr: 0, facing: Direction.RIGHT }, // desk is right of chair → face RIGHT
  ];

  // For each chair, every footprint tile becomes a seat.
  // Multi-tile chairs (e.g. 2-tile couches) produce multiple seats.
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type);
    if (!entry || entry.category !== 'chairs') continue;

    let seatCount = 0;
    const bgRows = entry.backgroundTiles ?? 0;
    for (let dr = bgRows; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        const tileCol = item.col + dc;
        const tileRow = item.row + dr;

        // Determine facing direction:
        // 1) Chair orientation takes priority
        // 2) Adjacent desk direction
        // 3) Default forward (DOWN)
        let facingDir: Direction = Direction.DOWN;
        if (entry.orientation) {
          facingDir = orientationToFacing(entry.orientation);
        } else {
          for (const d of dirs) {
            if (deskTiles.has(`${tileCol + d.dc},${tileRow + d.dr}`)) {
              facingDir = d.facing;
              break;
            }
          }
        }

        // First seat uses chair uid (backward compat), subsequent use uid:N
        const seatUid = seatCount === 0 ? item.uid : `${item.uid}:${seatCount}`;
        seats.set(seatUid, {
          uid: seatUid,
          seatCol: tileCol,
          seatRow: tileRow,
          facingDir,
          assigned: false,
        });
        seatCount++;
      }
    }
  }

  return seats;
}

/** Get the set of tiles occupied by seats (so they can be excluded from blocked tiles)
 * @internal */
export function getSeatTiles(seats: Map<string, Seat>): Set<string> {
  const tiles = new Set<string>();
  for (const seat of seats.values()) {
    tiles.add(`${seat.seatCol},${seat.seatRow}`);
  }
  return tiles;
}

/** Default floor colors for the two rooms */
const DEFAULT_LEFT_ROOM_COLOR: ColorValue = { h: 35, s: 30, b: 15, c: 0 }; // warm beige
const DEFAULT_RIGHT_ROOM_COLOR: ColorValue = { h: 25, s: 45, b: 5, c: 10 }; // warm brown

/** Create a minimal fallback layout (used only when no default-layout.json exists) */
export function createDefaultLayout(): OfficeLayout {
  const W = TileType.WALL;
  const F1 = TileType.FLOOR_1;
  const F2 = TileType.FLOOR_2;

  const tiles: TileTypeVal[] = [];
  const tileColors: Array<ColorValue | null> = [];

  for (let r = 0; r < DEFAULT_ROWS; r++) {
    for (let c = 0; c < DEFAULT_COLS; c++) {
      if (r === 0 || r === DEFAULT_ROWS - 1 || c === 0 || c === DEFAULT_COLS - 1) {
        tiles.push(W);
        tileColors.push(null);
      } else if (c < 10) {
        tiles.push(F1);
        tileColors.push(DEFAULT_LEFT_ROOM_COLOR);
      } else {
        tiles.push(F2);
        tileColors.push(DEFAULT_RIGHT_ROOM_COLOR);
      }
    }
  }

  // Minimal fallback with no furniture — the default-layout.json provides the real default
  return { version: 1, cols: DEFAULT_COLS, rows: DEFAULT_ROWS, tiles, tileColors, furniture: [] };
}

/** Serialize layout to JSON string
 * @internal */
export function serializeLayout(layout: OfficeLayout): string {
  return JSON.stringify(layout);
}

// ── Furniture type migration ────────────────────────────────────

/** Map old hardcoded FurnitureType values to new manifest-based IDs */
const LEGACY_TYPE_MAP: Record<string, string | null> = {
  desk: 'DESK_FRONT',
  chair: 'WOODEN_CHAIR_FRONT',
  bookshelf: 'BOOKSHELF',
  plant: 'PLANT',
  cooler: null, // no equivalent in new assets — remove
  whiteboard: 'WHITEBOARD',
  pc: 'PC_FRONT_OFF',
  lamp: null, // no equivalent in new assets — remove
};

/** Migrate old furniture type strings to new manifest IDs */
function migrateFurnitureTypes(furniture: PlacedFurniture[]): PlacedFurniture[] {
  const migrated: PlacedFurniture[] = [];
  for (const item of furniture) {
    const newType = LEGACY_TYPE_MAP[item.type];
    if (newType === undefined) {
      // Not a legacy type — keep as-is
      migrated.push(item);
    } else if (newType !== null) {
      // Migrate to new type
      migrated.push({ ...item, type: newType });
    }
    // newType === null → remove the item (no equivalent)
  }
  return migrated;
}

/** Deserialize layout from JSON string, migrating old tile types if needed
 * @internal */
export function deserializeLayout(json: string): OfficeLayout | null {
  try {
    const obj = JSON.parse(json);
    if (obj && obj.version === 1 && Array.isArray(obj.tiles) && Array.isArray(obj.furniture)) {
      return migrateLayout(obj as OfficeLayout);
    }
  } catch {
    /* ignore parse errors */
  }
  return null;
}

/**
 * Ensure layout has tileColors. If missing, generate defaults based on tile types.
 * Exported for use by message handlers that receive layouts over the wire.
 */
export function migrateLayoutColors(layout: OfficeLayout): OfficeLayout {
  return migrateLayout(layout);
}

/**
 * Migrate old layouts that use legacy tile types (TILE_FLOOR=1, WOOD_FLOOR=2, CARPET=3, DOORWAY=4)
 * to the new pattern-based system. Also migrates old furniture type strings and old VOID value.
 */
function migrateLayout(layout: OfficeLayout): OfficeLayout {
  // Migrate furniture types
  layout = { ...layout, furniture: migrateFurnitureTypes(layout.furniture) };

  // Migrate old VOID value (was 8, now 255) — only for legacy layouts since FLOOR_8 reuses value 8
  const OLD_VOID = 8;
  if (!layout.layoutRevision && layout.tiles.includes(OLD_VOID as TileTypeVal)) {
    layout = {
      ...layout,
      tiles: layout.tiles.map((t) => (t === OLD_VOID ? (TileType.VOID as TileTypeVal) : t)),
    };
  }

  // Default pets to empty array if absent (backward-compat for legacy layouts).
  if (!layout.pets) {
    layout = { ...layout, pets: [] };
  }

  if (layout.tileColors && layout.tileColors.length === layout.tiles.length) {
    return layout; // Already migrated tile colors
  }

  // Check if any tiles use old values (1-4) — these map directly to FLOOR_1-4
  // but need color assignments
  const tileColors: Array<ColorValue | null> = [];
  for (const tile of layout.tiles) {
    switch (tile) {
      case 0: // WALL
        tileColors.push(null);
        break;
      case 1: // was TILE_FLOOR → FLOOR_1 beige
        tileColors.push(DEFAULT_LEFT_ROOM_COLOR);
        break;
      case 2: // was WOOD_FLOOR → FLOOR_2 brown
        tileColors.push(DEFAULT_RIGHT_ROOM_COLOR);
        break;
      case 3: // was CARPET → FLOOR_3 purple
        tileColors.push({ h: 280, s: 40, b: -5, c: 0 });
        break;
      case 4: // was DOORWAY → FLOOR_4 tan
        tileColors.push({ h: 35, s: 25, b: 10, c: 0 });
        break;
      default:
        // Floor tile types without colors — use neutral gray
        tileColors.push(tile > 0 && tile !== TileType.VOID ? { h: 0, s: 0, b: 0, c: 0 } : null);
    }
  }

  return { ...layout, tileColors };
}
