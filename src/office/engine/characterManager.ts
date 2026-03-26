import {
  CHARACTER_HIT_HALF_WIDTH,
  CHARACTER_HIT_HEIGHT,
  CHARACTER_SITTING_OFFSET_PX,
  DISMISS_BUBBLE_FAST_FADE_SEC,
  HUE_SHIFT_MIN_DEG,
  HUE_SHIFT_RANGE_DEG,
  INACTIVE_SEAT_TIMER_MIN_SEC,
  INACTIVE_SEAT_TIMER_RANGE_SEC,
  PALETTE_COUNT,
  PLAYER_DEFAULT_DISPLAY_NAME,
  PLAYER_PROXIMITY_THRESHOLD_TILES,
  PLAYER_WALK_SPEED_PX_PER_SEC,
  WAITING_BUBBLE_DURATION_SEC,
  WALK_FRAME_DURATION_SEC,
} from '../../constants.js';
import type { Player, ProximityEvent, Seat, TileType as TileTypeVal } from '../types.js';
import { CharacterState, Direction, MATRIX_EFFECT_DURATION, TILE_SIZE } from '../types.js';
import { createCharacter, updateCharacter } from './characters.js';
import { matrixEffectSeeds } from './matrixEffect.js';

import type { Character } from '../types.js';

/** Callback type for finding a free seat */
type FindFreeSeatFn = () => string | null;

/** Callback type for pathfinding */
type FindPathFn = (
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
) => Array<{ col: number; row: number }>;

/** Callback type for checking walkability */
type IsWalkableFn = (
  col: number,
  row: number,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
) => boolean;

export class CharacterManager {
  characters: Map<number, Character> = new Map();
  selectedAgentId: number | null = null;
  cameraFollowId: number | null = null;
  hoveredAgentId: number | null = null;
  /** Maps "parentId:toolId" → sub-agent character ID (negative) */
  subagentIdMap: Map<string, number> = new Map();
  /** Reverse lookup: sub-agent character ID → parent info */
  subagentMeta: Map<number, { parentAgentId: number; parentToolId: string }> = new Map();
  private nextSubagentId = -1;

  /** External dependencies (provided by OfficeState) */
  private getSeats: () => Map<string, Seat>;
  private getTileMap: () => TileTypeVal[][];
  private getBlockedTiles: () => Set<string>;
  private getWalkableTiles: () => Array<{ col: number; row: number }>;
  private findPathFn: FindPathFn;
  private isWalkableFn: IsWalkableFn;
  private findFreeSeatFn: FindFreeSeatFn;

  constructor(deps: {
    getSeats: () => Map<string, Seat>;
    getTileMap: () => TileTypeVal[][];
    getBlockedTiles: () => Set<string>;
    getWalkableTiles: () => Array<{ col: number; row: number }>;
    findPath: FindPathFn;
    isWalkable: IsWalkableFn;
    findFreeSeat: FindFreeSeatFn;
  }) {
    this.getSeats = deps.getSeats;
    this.getTileMap = deps.getTileMap;
    this.getBlockedTiles = deps.getBlockedTiles;
    this.getWalkableTiles = deps.getWalkableTiles;
    this.findPathFn = deps.findPath;
    this.isWalkableFn = deps.isWalkable;
    this.findFreeSeatFn = deps.findFreeSeat;
  }

  /** Get the blocked-tile key for a character's own seat, or null */
  private ownSeatKey(ch: Character): string | null {
    if (!ch.seatId) return null;
    const seats = this.getSeats();
    const seat = seats.get(ch.seatId);
    if (!seat) return null;
    return `${seat.seatCol},${seat.seatRow}`;
  }

  /** Temporarily unblock a character's own seat, run fn, then re-block */
  private withOwnSeatUnblocked<T>(ch: Character, fn: () => T): T {
    const key = this.ownSeatKey(ch);
    const blockedTiles = this.getBlockedTiles();
    if (key) blockedTiles.delete(key);
    const result = fn();
    if (key) blockedTiles.add(key);
    return result;
  }

  /**
   * Pick a diverse palette for a new agent based on currently active agents.
   * First 6 agents each get a unique skin (random order). Beyond 6, skins
   * repeat in balanced rounds with a random hue shift (≥45°).
   */
  private pickDiversePalette(): { palette: number; hueShift: number } {
    const counts = new Array(PALETTE_COUNT).fill(0) as number[];
    for (const ch of this.characters.values()) {
      if (ch.isSubagent) continue;
      counts[ch.palette]++;
    }
    const minCount = Math.min(...counts);
    const available: number[] = [];
    for (let i = 0; i < PALETTE_COUNT; i++) {
      if (counts[i] === minCount) available.push(i);
    }
    const palette = available[Math.floor(Math.random() * available.length)];
    let hueShift = 0;
    if (minCount > 0) {
      hueShift = HUE_SHIFT_MIN_DEG + Math.floor(Math.random() * HUE_SHIFT_RANGE_DEG);
    }
    return { palette, hueShift };
  }

  addAgent(
    id: number,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string,
    skipSpawnEffect?: boolean,
    displayName?: string,
    agentId?: string,
  ): void {
    if (this.characters.has(id)) return;

    let palette: number;
    let hueShift: number;
    if (preferredPalette !== undefined) {
      palette = preferredPalette;
      hueShift = preferredHueShift ?? 0;
    } else {
      const pick = this.pickDiversePalette();
      palette = pick.palette;
      hueShift = pick.hueShift;
    }

    const seats = this.getSeats();
    const walkableTiles = this.getWalkableTiles();

    // Try preferred seat first, then any free seat
    let seatId: string | null = null;
    if (preferredSeatId && seats.has(preferredSeatId)) {
      const seat = seats.get(preferredSeatId)!;
      if (!seat.assigned) {
        seatId = preferredSeatId;
      }
    }
    if (!seatId) {
      seatId = this.findFreeSeatFn();
    }

    let ch: Character;
    if (seatId) {
      const seat = seats.get(seatId)!;
      seat.assigned = true;
      ch = createCharacter(id, palette, seatId, seat, hueShift);
    } else {
      // No seats — spawn at random walkable tile
      const spawn =
        walkableTiles.length > 0
          ? walkableTiles[Math.floor(Math.random() * walkableTiles.length)]
          : { col: 1, row: 1 };
      ch = createCharacter(id, palette, null, null, hueShift);
      ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
      ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
      ch.tileCol = spawn.col;
      ch.tileRow = spawn.row;
    }

    if (displayName) {
      ch.displayName = displayName;
    }
    if (agentId) {
      ch.agentId = agentId;
    }
    if (!skipSpawnEffect) {
      ch.matrixEffect = 'spawn';
      ch.matrixEffectTimer = 0;
      ch.matrixEffectSeeds = matrixEffectSeeds();
    }
    this.characters.set(id, ch);
  }

  removeAgent(id: number, immediate: boolean = false): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    if (ch.matrixEffect === 'despawn') return;

    const seats = this.getSeats();

    // Free seat and clear selection immediately
    if (ch.seatId) {
      const seat = seats.get(ch.seatId);
      if (seat) seat.assigned = false;
    }
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;

    if (immediate) {
      this.characters.delete(id);
    } else {
      // Start despawn animation
      ch.matrixEffect = 'despawn';
      ch.matrixEffectTimer = 0;
      ch.matrixEffectSeeds = matrixEffectSeeds();
      ch.bubbleType = null;
    }
  }

  /** Find seat uid at a given tile position, or null */
  getSeatAtTile(col: number, row: number): string | null {
    const seats = this.getSeats();
    for (const [uid, seat] of seats) {
      if (seat.seatCol === col && seat.seatRow === row) return uid;
    }
    return null;
  }

  /** Reassign an agent from their current seat to a new seat */
  reassignSeat(agentId: number, seatId: string): void {
    const ch = this.characters.get(agentId);
    if (!ch) return;

    const seats = this.getSeats();
    const tileMap = this.getTileMap();
    const blockedTiles = this.getBlockedTiles();

    // Unassign old seat
    if (ch.seatId) {
      const old = seats.get(ch.seatId);
      if (old) old.assigned = false;
    }
    // Assign new seat
    const seat = seats.get(seatId);
    if (!seat || seat.assigned) return;
    seat.assigned = true;
    ch.seatId = seatId;

    // Pathfind to new seat
    const path = this.withOwnSeatUnblocked(ch, () =>
      this.findPathFn(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, tileMap, blockedTiles),
    );
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
    } else {
      // Already at seat or no path — sit down
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
      }
    }
  }

  /** Send an agent back to their currently assigned seat */
  sendToSeat(agentId: number): void {
    const ch = this.characters.get(agentId);
    if (!ch || !ch.seatId) return;

    const seats = this.getSeats();
    const seat = seats.get(ch.seatId);
    if (!seat) return;

    const tileMap = this.getTileMap();
    const blockedTiles = this.getBlockedTiles();

    const path = this.withOwnSeatUnblocked(ch, () =>
      this.findPathFn(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, tileMap, blockedTiles),
    );
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
    } else {
      // Already at seat — sit down
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
      }
    }
  }

  /** Walk an agent to an arbitrary walkable tile (right-click command) */
  walkToTile(agentId: number, col: number, row: number): boolean {
    const ch = this.characters.get(agentId);
    if (!ch || ch.isSubagent) return false;

    const tileMap = this.getTileMap();
    const blockedTiles = this.getBlockedTiles();

    if (!this.isWalkableFn(col, row, tileMap, blockedTiles)) {
      // Also allow walking to own seat tile
      const key = this.ownSeatKey(ch);
      if (!key || key !== `${col},${row}`) return false;
    }
    const path = this.withOwnSeatUnblocked(ch, () =>
      this.findPathFn(ch.tileCol, ch.tileRow, col, row, tileMap, blockedTiles),
    );
    if (path.length === 0) return false;
    ch.path = path;
    ch.moveProgress = 0;
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
    return true;
  }

  /** Create a sub-agent character with the parent's palette. Returns the sub-agent ID. */
  addSubagent(parentAgentId: number, parentToolId: string): number {
    const key = `${parentAgentId}:${parentToolId}`;
    if (this.subagentIdMap.has(key)) return this.subagentIdMap.get(key)!;

    const id = this.nextSubagentId--;
    const parentCh = this.characters.get(parentAgentId);
    const palette = parentCh ? parentCh.palette : 0;
    const hueShift = parentCh ? parentCh.hueShift : 0;

    const seats = this.getSeats();
    const walkableTiles = this.getWalkableTiles();

    // Find the free seat closest to the parent agent
    const parentCol = parentCh ? parentCh.tileCol : 0;
    const parentRow = parentCh ? parentCh.tileRow : 0;
    const dist = (c: number, r: number) => Math.abs(c - parentCol) + Math.abs(r - parentRow);

    let bestSeatId: string | null = null;
    let bestDist = Infinity;
    for (const [uid, seat] of seats) {
      if (!seat.assigned) {
        const d = dist(seat.seatCol, seat.seatRow);
        if (d < bestDist) {
          bestDist = d;
          bestSeatId = uid;
        }
      }
    }

    let ch: Character;
    if (bestSeatId) {
      const seat = seats.get(bestSeatId)!;
      seat.assigned = true;
      ch = createCharacter(id, palette, bestSeatId, seat, hueShift);
    } else {
      // No seats — spawn at closest walkable tile to parent
      let spawn = { col: 1, row: 1 };
      if (walkableTiles.length > 0) {
        let closest = walkableTiles[0];
        let closestDist = dist(closest.col, closest.row);
        for (let i = 1; i < walkableTiles.length; i++) {
          const d = dist(walkableTiles[i].col, walkableTiles[i].row);
          if (d < closestDist) {
            closest = walkableTiles[i];
            closestDist = d;
          }
        }
        spawn = closest;
      }
      ch = createCharacter(id, palette, null, null, hueShift);
      ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
      ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
      ch.tileCol = spawn.col;
      ch.tileRow = spawn.row;
    }
    ch.isSubagent = true;
    ch.parentAgentId = parentAgentId;
    ch.matrixEffect = 'spawn';
    ch.matrixEffectTimer = 0;
    ch.matrixEffectSeeds = matrixEffectSeeds();
    this.characters.set(id, ch);

    this.subagentIdMap.set(key, id);
    this.subagentMeta.set(id, { parentAgentId, parentToolId });
    return id;
  }

  /** Remove a specific sub-agent character and free its seat */
  removeSubagent(parentAgentId: number, parentToolId: string): void {
    const key = `${parentAgentId}:${parentToolId}`;
    const id = this.subagentIdMap.get(key);
    if (id === undefined) return;

    const ch = this.characters.get(id);
    if (ch) {
      if (ch.matrixEffect === 'despawn') {
        this.subagentIdMap.delete(key);
        this.subagentMeta.delete(id);
        return;
      }
      const seats = this.getSeats();
      if (ch.seatId) {
        const seat = seats.get(ch.seatId);
        if (seat) seat.assigned = false;
      }
      ch.matrixEffect = 'despawn';
      ch.matrixEffectTimer = 0;
      ch.matrixEffectSeeds = matrixEffectSeeds();
      ch.bubbleType = null;
    }
    this.subagentIdMap.delete(key);
    this.subagentMeta.delete(id);
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;
  }

  /** Remove all sub-agents belonging to a parent agent */
  removeAllSubagents(parentAgentId: number): void {
    const seats = this.getSeats();
    const toRemove: string[] = [];
    for (const [key, id] of this.subagentIdMap) {
      const meta = this.subagentMeta.get(id);
      if (meta && meta.parentAgentId === parentAgentId) {
        const ch = this.characters.get(id);
        if (ch) {
          if (ch.matrixEffect === 'despawn') {
            this.subagentMeta.delete(id);
            toRemove.push(key);
            continue;
          }
          if (ch.seatId) {
            const seat = seats.get(ch.seatId);
            if (seat) seat.assigned = false;
          }
          ch.matrixEffect = 'despawn';
          ch.matrixEffectTimer = 0;
          ch.matrixEffectSeeds = matrixEffectSeeds();
          ch.bubbleType = null;
        }
        this.subagentMeta.delete(id);
        if (this.selectedAgentId === id) this.selectedAgentId = null;
        if (this.cameraFollowId === id) this.cameraFollowId = null;
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      this.subagentIdMap.delete(key);
    }
  }

  /** Look up the sub-agent character ID for a given parent+toolId, or null */
  getSubagentId(parentAgentId: number, parentToolId: string): number | null {
    return this.subagentIdMap.get(`${parentAgentId}:${parentToolId}`) ?? null;
  }

  setAgentActive(id: number, active: boolean, rebuildFurnitureCallback: () => void): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.isActive = active;
      if (!active) {
        ch.seatTimer = -1;
        ch.path = [];
        ch.moveProgress = 0;
      }
      rebuildFurnitureCallback();
    }
  }

  setAgentTool(id: number, tool: string | null): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.currentTool = tool;
    }
  }

  showPermissionBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.bubbleType = 'permission';
      ch.bubbleTimer = 0;
    }
  }

  clearPermissionBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch && ch.bubbleType === 'permission') {
      ch.bubbleType = null;
      ch.bubbleTimer = 0;
    }
  }

  showWaitingBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.bubbleType = 'waiting';
      ch.bubbleTimer = WAITING_BUBBLE_DURATION_SEC;
    }
  }

  /** Dismiss bubble on click */
  dismissBubble(id: number): void {
    const ch = this.characters.get(id);
    if (!ch || !ch.bubbleType) return;
    if (ch.bubbleType === 'permission') {
      ch.bubbleType = null;
      ch.bubbleTimer = 0;
    } else if (ch.bubbleType === 'waiting') {
      ch.bubbleTimer = Math.min(ch.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC);
    }
  }

  /** Relocate a character to a random walkable tile */
  relocateCharacterToWalkable(ch: Character): void {
    const walkableTiles = this.getWalkableTiles();
    if (walkableTiles.length === 0) return;
    const spawn = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
    ch.tileCol = spawn.col;
    ch.tileRow = spawn.row;
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    ch.path = [];
    ch.moveProgress = 0;
  }

  update(dt: number): void {
    const seats = this.getSeats();
    const tileMap = this.getTileMap();
    const blockedTiles = this.getBlockedTiles();
    const walkableTiles = this.getWalkableTiles();

    const toDelete: number[] = [];
    for (const ch of this.characters.values()) {
      // Handle matrix effect animation
      if (ch.matrixEffect) {
        ch.matrixEffectTimer += dt;
        if (ch.matrixEffectTimer >= MATRIX_EFFECT_DURATION) {
          if (ch.matrixEffect === 'spawn') {
            ch.matrixEffect = null;
            ch.matrixEffectTimer = 0;
            ch.matrixEffectSeeds = [];
          } else {
            toDelete.push(ch.id);
          }
        }
        continue;
      }

      this.withOwnSeatUnblocked(ch, () =>
        updateCharacter(ch, dt, walkableTiles, seats, tileMap, blockedTiles),
      );

      // Tick bubble timer for waiting bubbles
      if (ch.bubbleType === 'waiting') {
        ch.bubbleTimer -= dt;
        if (ch.bubbleTimer <= 0) {
          ch.bubbleType = null;
          ch.bubbleTimer = 0;
        }
      }
    }
    // Remove characters that finished despawn
    for (const id of toDelete) {
      this.characters.delete(id);
    }

    // Update player movement and proximity
    this.updatePlayer(dt);
  }

  getCharacters(): Character[] {
    return Array.from(this.characters.values());
  }

  /** Get character at pixel position (for hit testing). Returns id or null. */
  getCharacterAt(worldX: number, worldY: number): number | null {
    const chars = this.getCharacters().sort((a, b) => b.y - a.y);
    for (const ch of chars) {
      if (ch.matrixEffect === 'despawn') continue;
      const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
      const anchorY = ch.y + sittingOffset;
      const left = ch.x - CHARACTER_HIT_HALF_WIDTH;
      const right = ch.x + CHARACTER_HIT_HALF_WIDTH;
      const top = anchorY - CHARACTER_HIT_HEIGHT;
      const bottom = anchorY;
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        return ch.id;
      }
    }
    return null;
  }

  /** Select a character and optionally follow with camera */
  selectCharacter(id: number | null, follow: boolean = true): void {
    this.selectedAgentId = id;
    this.cameraFollowId = follow ? id : null;
  }

  /** Deselect current character and stop camera follow */
  deselectCharacter(): void {
    this.selectedAgentId = null;
    this.cameraFollowId = null;
  }

  /** Get currently selected character, or null */
  getSelectedCharacter(): Character | null {
    if (this.selectedAgentId === null) return null;
    return this.characters.get(this.selectedAgentId) ?? null;
  }

  /** Get character by ID */
  getCharacter(id: number): Character | undefined {
    return this.characters.get(id);
  }

  /** Check if character exists */
  hasCharacter(id: number): boolean {
    return this.characters.has(id);
  }

  /** Reassign seats after layout rebuild - call from OfficeState */
  reassignSeatsAfterLayoutRebuild(
    shift?: { col: number; row: number },
    layoutCols?: number,
    layoutRows?: number,
  ): void {
    const seats = this.getSeats();

    // Shift character positions when grid expands left/up
    if (shift && (shift.col !== 0 || shift.row !== 0)) {
      for (const ch of this.characters.values()) {
        ch.tileCol += shift.col;
        ch.tileRow += shift.row;
        ch.x += shift.col * TILE_SIZE;
        ch.y += shift.row * TILE_SIZE;
        ch.path = [];
        ch.moveProgress = 0;
      }
      // Also shift player
      if (this.player) {
        this.player.tileCol += shift.col;
        this.player.tileRow += shift.row;
        this.player.x += shift.col * TILE_SIZE;
        this.player.y += shift.row * TILE_SIZE;
        this.player.path = [];
        this.player.moveProgress = 0;
      }
    }

    // Reassign characters to new seats
    for (const seat of seats.values()) {
      seat.assigned = false;
    }

    // First pass: try to keep characters at their existing seats
    for (const ch of this.characters.values()) {
      if (ch.seatId && seats.has(ch.seatId)) {
        const seat = seats.get(ch.seatId)!;
        if (!seat.assigned) {
          seat.assigned = true;
          ch.tileCol = seat.seatCol;
          ch.tileRow = seat.seatRow;
          ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
          ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
          ch.dir = seat.facingDir;
          continue;
        }
      }
      ch.seatId = null;
    }

    // Second pass: assign remaining characters to free seats
    for (const ch of this.characters.values()) {
      if (ch.seatId) continue;
      const freeSeatId = this.findFreeSeatFn();
      if (freeSeatId) {
        const seat = seats.get(freeSeatId)!;
        seat.assigned = true;
        ch.seatId = freeSeatId;
        ch.tileCol = seat.seatCol;
        ch.tileRow = seat.seatRow;
        ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
        ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
        ch.dir = seat.facingDir;
      }
    }

    // Relocate characters outside bounds
    if (layoutCols !== undefined && layoutRows !== undefined) {
      for (const ch of this.characters.values()) {
        if (ch.seatId) continue;
        if (
          ch.tileCol < 0 ||
          ch.tileCol >= layoutCols ||
          ch.tileRow < 0 ||
          ch.tileRow >= layoutRows
        ) {
          this.relocateCharacterToWalkable(ch);
        }
      }
      // Also relocate player if outside bounds
      if (this.player) {
        if (
          this.player.tileCol < 0 ||
          this.player.tileCol >= layoutCols ||
          this.player.tileRow < 0 ||
          this.player.tileRow >= layoutRows
        ) {
          this.relocatePlayerToWalkable();
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // PLAYER MANAGEMENT
  // ════════════════════════════════════════════════════════════════

  private player: Player | null = null;
  private onProximityChange: ((event: ProximityEvent | null) => void) | null = null;

  /** Set callback for proximity changes */
  setProximityCallback(callback: (event: ProximityEvent | null) => void): void {
    this.onProximityChange = callback;
  }

  /** Initialize player at a walkable tile */
  initPlayer(displayName?: string): void {
    const walkableTiles = this.getWalkableTiles();
    const spawn =
      walkableTiles.length > 0
        ? walkableTiles[Math.floor(Math.random() * walkableTiles.length)]
        : { col: 1, row: 1 };

    this.player = {
      state: CharacterState.IDLE,
      dir: 0, // DOWN
      x: spawn.col * TILE_SIZE + TILE_SIZE / 2,
      y: spawn.row * TILE_SIZE + TILE_SIZE / 2,
      tileCol: spawn.col,
      tileRow: spawn.row,
      path: [],
      moveProgress: 0,
      frame: 0,
      frameTimer: 0,
      displayName: displayName ?? PLAYER_DEFAULT_DISPLAY_NAME,
      nearbyAgentId: null,
      proximityThreshold: PLAYER_PROXIMITY_THRESHOLD_TILES,
    };
  }

  /** Get player state */
  getPlayer(): Player | null {
    return this.player;
  }

  /** Check if player exists */
  hasPlayer(): boolean {
    return this.player !== null;
  }

  /** Move player to a tile (click-to-move) */
  movePlayerToTile(col: number, row: number): boolean {
    if (!this.player) return false;

    const tileMap = this.getTileMap();
    const blockedTiles = this.getBlockedTiles();

    if (!this.isWalkableFn(col, row, tileMap, blockedTiles)) {
      return false;
    }

    const path = this.findPathFn(
      this.player.tileCol,
      this.player.tileRow,
      col,
      row,
      tileMap,
      blockedTiles,
    );

    if (path.length === 0) return false;

    this.player.path = path;
    this.player.moveProgress = 0;
    this.player.state = CharacterState.WALK;
    this.player.frame = 0;
    this.player.frameTimer = 0;
    return true;
  }

  /** Move player towards an agent (stop adjacent to them) */
  movePlayerToAgent(agentId: number): boolean {
    if (!this.player) return false;

    const agent = this.characters.get(agentId);
    if (!agent) return false;

    // Find the closest walkable tile adjacent to the agent
    const tileMap = this.getTileMap();
    const blockedTiles = this.getBlockedTiles();

    const adjacentOffsets = [
      { dc: 0, dr: -1 }, // up
      { dc: 0, dr: 1 }, // down
      { dc: -1, dr: 0 }, // left
      { dc: 1, dr: 0 }, // right
    ];

    let bestPath: Array<{ col: number; row: number }> = [];
    let bestDist = Infinity;

    for (const { dc, dr } of adjacentOffsets) {
      const targetCol = agent.tileCol + dc;
      const targetRow = agent.tileRow + dr;

      if (!this.isWalkableFn(targetCol, targetRow, tileMap, blockedTiles)) continue;

      const path = this.findPathFn(
        this.player.tileCol,
        this.player.tileRow,
        targetCol,
        targetRow,
        tileMap,
        blockedTiles,
      );

      if (path.length > 0 && path.length < bestDist) {
        bestPath = path;
        bestDist = path.length;
      }
    }

    if (bestPath.length === 0) return false;

    this.player.path = bestPath;
    this.player.moveProgress = 0;
    this.player.state = CharacterState.WALK;
    this.player.frame = 0;
    this.player.frameTimer = 0;
    return true;
  }

  /** Relocate player to a random walkable tile */
  relocatePlayerToWalkable(): void {
    if (!this.player) return;
    const walkableTiles = this.getWalkableTiles();
    if (walkableTiles.length === 0) return;
    const spawn = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
    this.player.tileCol = spawn.col;
    this.player.tileRow = spawn.row;
    this.player.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    this.player.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    this.player.path = [];
    this.player.moveProgress = 0;
  }

  /** Update player movement and proximity detection */
  private updatePlayer(dt: number): void {
    if (!this.player) return;

    // Animation frame update
    this.player.frameTimer += dt;

    if (this.player.state === CharacterState.WALK) {
      // Walk animation
      if (this.player.frameTimer >= WALK_FRAME_DURATION_SEC) {
        this.player.frameTimer -= WALK_FRAME_DURATION_SEC;
        this.player.frame = (this.player.frame + 1) % 4;
      }

      // No path - stop walking
      if (this.player.path.length === 0) {
        this.player.state = CharacterState.IDLE;
        this.player.frame = 0;
        this.player.frameTimer = 0;
        return;
      }

      // Move toward next tile
      const nextTile = this.player.path[0];
      this.player.dir = this.directionBetween(
        this.player.tileCol,
        this.player.tileRow,
        nextTile.col,
        nextTile.row,
      );

      this.player.moveProgress += (PLAYER_WALK_SPEED_PX_PER_SEC / TILE_SIZE) * dt;

      const fromCenter = this.tileCenter(this.player.tileCol, this.player.tileRow);
      const toCenter = this.tileCenter(nextTile.col, nextTile.row);
      const t = Math.min(this.player.moveProgress, 1);
      this.player.x = fromCenter.x + (toCenter.x - fromCenter.x) * t;
      this.player.y = fromCenter.y + (toCenter.y - fromCenter.y) * t;

      if (this.player.moveProgress >= 1) {
        this.player.tileCol = nextTile.col;
        this.player.tileRow = nextTile.row;
        this.player.x = toCenter.x;
        this.player.y = toCenter.y;
        this.player.path.shift();
        this.player.moveProgress = 0;

        // Path complete
        if (this.player.path.length === 0) {
          this.player.state = CharacterState.IDLE;
          this.player.frame = 0;
          this.player.frameTimer = 0;
        }
      }
    }

    // Proximity detection
    this.updateProximity();
  }

  /** Calculate distance between player and agent in tiles */
  private getDistanceToAgent(agent: Character): number {
    if (!this.player) return Infinity;
    const dx = this.player.tileCol - agent.tileCol;
    const dy = this.player.tileRow - agent.tileRow;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Update proximity state and fire callback */
  private updateProximity(): void {
    if (!this.player || !this.onProximityChange) return;

    let closestAgent: Character | null = null;
    let closestDistance = Infinity;

    for (const agent of this.characters.values()) {
      if (agent.matrixEffect === 'despawn') continue;
      const dist = this.getDistanceToAgent(agent);
      if (dist < this.player.proximityThreshold && dist < closestDistance) {
        closestDistance = dist;
        closestAgent = agent;
      }
    }

    const newNearbyId = closestAgent ? closestAgent.id : null;

    // Only fire callback if proximity changed
    if (newNearbyId !== this.player.nearbyAgentId) {
      this.player.nearbyAgentId = newNearbyId;

      if (closestAgent) {
        this.onProximityChange({
          agentId: closestAgent.id,
          distance: closestDistance,
          agentCharacter: closestAgent,
        });
      } else {
        this.onProximityChange(null);
      }
    }
  }

  /** Helper: get tile center */
  private tileCenter(col: number, row: number): { x: number; y: number } {
    return {
      x: col * TILE_SIZE + TILE_SIZE / 2,
      y: row * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  /** Helper: direction between tiles */
  private directionBetween(
    fromCol: number,
    fromRow: number,
    toCol: number,
    toRow: number,
  ): Direction {
    const dc = toCol - fromCol;
    const dr = toRow - fromRow;
    if (dc > 0) return Direction.RIGHT;
    if (dc < 0) return Direction.LEFT;
    if (dr > 0) return Direction.DOWN;
    return Direction.UP;
  }

  /** Get all nearby agents within proximity threshold */
  getNearbyAgents(): ProximityEvent[] {
    if (!this.player) return [];

    const nearby: ProximityEvent[] = [];
    for (const agent of this.characters.values()) {
      if (agent.matrixEffect === 'despawn') continue;
      const dist = this.getDistanceToAgent(agent);
      if (dist < this.player.proximityThreshold) {
        nearby.push({
          agentId: agent.id,
          distance: dist,
          agentCharacter: agent,
        });
      }
    }
    return nearby.sort((a, b) => a.distance - b.distance);
  }
}
