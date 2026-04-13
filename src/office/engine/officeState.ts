import {
  AUTO_ON_FACING_DEPTH,
  AUTO_ON_SIDE_DEPTH,
  FURNITURE_ANIM_INTERVAL_SEC,
} from '../../constants.js';
import { getAnimationFrames, getCatalogEntry, getOnStateType } from '../layout/furnitureCatalog.js';
import {
  createDefaultLayout,
  getBlockedTiles,
  layoutToFurnitureInstances,
  layoutToSeats,
  layoutToTileMap,
} from '../layout/layoutSerializer.js';
import { findPath, getWalkableTiles, isWalkable } from '../layout/tileMap.js';
import type {
  Character,
  FurnitureInstance,
  OfficeLayout,
  Player,
  PlacedFurniture,
  ProximityEvent,
  Seat,
  TileType as TileTypeVal,
} from '../types.js';
import { Direction } from '../types.js';
import { CharacterManager } from './characterManager.js';

export class OfficeState {
  layout: OfficeLayout;
  tileMap: TileTypeVal[][];
  seats: Map<string, Seat>;
  blockedTiles: Set<string>;
  furniture: FurnitureInstance[];
  walkableTiles: Array<{ col: number; row: number }>;
  /** Accumulated time for furniture animation frame cycling */
  furnitureAnimTimer = 0;
  hoveredTile: { col: number; row: number } | null = null;

  /** Character manager - handles all character-related state */
  characterManager: CharacterManager;

  // Convenience getters that delegate to CharacterManager
  get characters(): Map<number, Character> {
    return this.characterManager.characters;
  }
  get selectedAgentId(): number | null {
    return this.characterManager.selectedAgentId;
  }
  set selectedAgentId(id: number | null) {
    this.characterManager.selectedAgentId = id;
  }
  get cameraFollowId(): number | null {
    return this.characterManager.cameraFollowId;
  }
  set cameraFollowId(id: number | null) {
    this.characterManager.cameraFollowId = id;
  }
  get hoveredAgentId(): number | null {
    return this.characterManager.hoveredAgentId;
  }
  set hoveredAgentId(id: number | null) {
    this.characterManager.hoveredAgentId = id;
  }
  get subagentMeta(): Map<number, { parentAgentId: number; parentToolId: string }> {
    return this.characterManager.subagentMeta;
  }

  constructor(layout?: OfficeLayout) {
    this.layout = layout || createDefaultLayout();
    this.tileMap = layoutToTileMap(this.layout);
    this.seats = layoutToSeats(this.layout.furniture);
    this.blockedTiles = getBlockedTiles(this.layout.furniture);
    this.furniture = layoutToFurnitureInstances(this.layout.furniture);
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);

    // Initialize CharacterManager with dependencies
    this.characterManager = new CharacterManager({
      getSeats: () => this.seats,
      getTileMap: () => this.tileMap,
      getBlockedTiles: () => this.blockedTiles,
      getWalkableTiles: () => this.walkableTiles,
      findPath: (fromCol, fromRow, toCol, toRow, tileMap, blockedTiles) =>
        findPath(fromCol, fromRow, toCol, toRow, tileMap, blockedTiles),
      isWalkable: (col, row, tileMap, blockedTiles) => isWalkable(col, row, tileMap, blockedTiles),
      findFreeSeat: () => this.findFreeSeat(),
    });
  }

  /** Rebuild all derived state from a new layout. Reassigns existing characters.
   *  @param shift Optional pixel shift to apply when grid expands left/up */
  rebuildFromLayout(layout: OfficeLayout, shift?: { col: number; row: number }): void {
    this.layout = layout;
    this.tileMap = layoutToTileMap(layout);
    this.seats = layoutToSeats(layout.furniture);
    this.blockedTiles = getBlockedTiles(layout.furniture);
    this.rebuildFurnitureInstances();
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);

    // Delegate seat reassignment to CharacterManager
    this.characterManager.reassignSeatsAfterLayoutRebuild(shift, layout.cols, layout.rows);
  }

  getLayout(): OfficeLayout {
    return this.layout;
  }

  /** Furniture types that should be prioritized for agent spawning */
  private static readonly PREFERRED_SEAT_TYPES = ['WOODEN_BENCH', 'CUSHIONED_BENCH'];

  private findFreeSeat(): string | null {
    // First pass: find free seats from preferred types (benches)
    for (const [uid, seat] of this.seats) {
      if (seat.assigned) continue;
      // Extract furniture uid from seat uid (handle multi-tile seats like "uid:N")
      const furnUid = uid.includes(':') ? uid.split(':')[0] : uid;
      const furniture = this.layout.furniture.find((f) => f.uid === furnUid);
      if (furniture && OfficeState.PREFERRED_SEAT_TYPES.includes(furniture.type)) {
        return uid;
      }
    }

    // Second pass: find any free seat (chairs, sofas, etc.)
    for (const [uid, seat] of this.seats) {
      if (!seat.assigned) return uid;
    }
    return null;
  }

  // ── Character Management (delegates to CharacterManager) ─────────────────

  addAgent(
    id: number,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string,
    skipSpawnEffect?: boolean,
    displayName?: string,
    agentId?: string,
  ): void {
    this.characterManager.addAgent(
      id,
      preferredPalette,
      preferredHueShift,
      preferredSeatId,
      skipSpawnEffect,
      displayName,
      agentId,
    );
  }

  removeAgent(id: number, immediate: boolean = false): void {
    this.characterManager.removeAgent(id, immediate);
  }

  getSeatAtTile(col: number, row: number): string | null {
    return this.characterManager.getSeatAtTile(col, row);
  }

  reassignSeat(agentId: number, seatId: string): void {
    this.characterManager.reassignSeat(agentId, seatId);
  }

  sendToSeat(agentId: number): void {
    this.characterManager.sendToSeat(agentId);
  }

  walkToTile(agentId: number, col: number, row: number): boolean {
    return this.characterManager.walkToTile(agentId, col, row);
  }

  addSubagent(parentAgentId: number, parentToolId: string): number {
    return this.characterManager.addSubagent(parentAgentId, parentToolId);
  }

  removeSubagent(parentAgentId: number, parentToolId: string): void {
    this.characterManager.removeSubagent(parentAgentId, parentToolId);
  }

  removeAllSubagents(parentAgentId: number): void {
    this.characterManager.removeAllSubagents(parentAgentId);
  }

  getSubagentId(parentAgentId: number, parentToolId: string): number | null {
    return this.characterManager.getSubagentId(parentAgentId, parentToolId);
  }

  setAgentActive(id: number, active: boolean): void {
    this.characterManager.setAgentActive(id, active, () => this.rebuildFurnitureInstances());
  }

  setAgentTool(id: number, tool: string | null): void {
    this.characterManager.setAgentTool(id, tool);
  }

  showPermissionBubble(id: number): void {
    this.characterManager.showPermissionBubble(id);
  }

  clearPermissionBubble(id: number): void {
    this.characterManager.clearPermissionBubble(id);
  }

  showWaitingBubble(id: number): void {
    this.characterManager.showWaitingBubble(id);
  }

  dismissBubble(id: number): void {
    this.characterManager.dismissBubble(id);
  }

  getCharacters(): Character[] {
    return this.characterManager.getCharacters();
  }

  getCharacterAt(worldX: number, worldY: number): number | null {
    return this.characterManager.getCharacterAt(worldX, worldY);
  }

  getCharacter(id: number): Character | undefined {
    return this.characterManager.getCharacter(id);
  }

  hasCharacter(id: number): boolean {
    return this.characterManager.hasCharacter(id);
  }

  // ── Furniture & Animation ─────────────────────────────────────────────────

  /** Rebuild furniture instances with auto-state applied (active agents turn electronics ON) */
  rebuildFurnitureInstances(): void {
    // Collect tiles where active agents face desks
    const autoOnTiles = new Set<string>();
    for (const ch of this.characters.values()) {
      if (!ch.isActive || !ch.seatId) continue;
      const seat = this.seats.get(ch.seatId);
      if (!seat) continue;
      // Find the desk tile(s) the agent faces from their seat
      const dCol =
        seat.facingDir === Direction.RIGHT ? 1 : seat.facingDir === Direction.LEFT ? -1 : 0;
      const dRow = seat.facingDir === Direction.DOWN ? 1 : seat.facingDir === Direction.UP ? -1 : 0;
      // Check tiles in the facing direction (desk could be 1-3 tiles deep)
      for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
        const tileCol = seat.seatCol + dCol * d;
        const tileRow = seat.seatRow + dRow * d;
        autoOnTiles.add(`${tileCol},${tileRow}`);
      }
      // Also check tiles to the sides of the facing direction (desks can be wide)
      for (let d = 1; d <= AUTO_ON_SIDE_DEPTH; d++) {
        const baseCol = seat.seatCol + dCol * d;
        const baseRow = seat.seatRow + dRow * d;
        if (dCol !== 0) {
          // Facing left/right: check tiles above and below
          autoOnTiles.add(`${baseCol},${baseRow - 1}`);
          autoOnTiles.add(`${baseCol},${baseRow + 1}`);
        } else {
          // Facing up/down: check tiles left and right
          autoOnTiles.add(`${baseCol - 1},${baseRow}`);
          autoOnTiles.add(`${baseCol + 1},${baseRow}`);
        }
      }
    }

    // Build modified furniture list with auto-state and electronics animation applied
    const animFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    const modifiedFurniture: PlacedFurniture[] = this.layout.furniture.map((item) => {
      const entry = getCatalogEntry(item.type);
      if (!entry) return item;

      // Check if any tile of this furniture overlaps an auto-on tile
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          if (autoOnTiles.has(`${item.col + dc},${item.row + dr}`)) {
            let onType = getOnStateType(item.type);
            if (onType !== item.type) {
              // Check if the on-state type has animation frames
              const frames = getAnimationFrames(onType);
              if (frames && frames.length > 1) {
                const frameIdx = animFrame % frames.length;
                onType = frames[frameIdx];
              }
              return { ...item, type: onType };
            }
            return item;
          }
        }
      }
      return item;
    });

    this.furniture = layoutToFurnitureInstances(modifiedFurniture);
  }

  update(dt: number): void {
    // Furniture animation cycling
    const prevFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    this.furnitureAnimTimer += dt;
    const newFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    if (newFrame !== prevFrame) {
      this.rebuildFurnitureInstances();
    }

    // Delegate character updates to CharacterManager
    this.characterManager.update(dt);
  }

  // ── Player Management (delegates to CharacterManager) ─────────────────

  /** Initialize player character */
  initPlayer(displayName?: string): void {
    this.characterManager.initPlayer(displayName);
  }

  /** Get player state */
  getPlayer(): Player | null {
    return this.characterManager.getPlayer();
  }

  /** Check if player exists */
  hasPlayer(): boolean {
    return this.characterManager.hasPlayer();
  }

  /** Move player to a tile */
  movePlayerToTile(col: number, row: number): boolean {
    return this.characterManager.movePlayerToTile(col, row);
  }

  /** Move player towards an agent */
  movePlayerToAgent(agentId: number): boolean {
    return this.characterManager.movePlayerToAgent(agentId);
  }

  /** Set callback for proximity changes */
  setProximityCallback(callback: (event: ProximityEvent | null) => void): void {
    this.characterManager.setProximityCallback(callback);
  }

  /** Get all nearby agents */
  getNearbyAgents(): ProximityEvent[] {
    return this.characterManager.getNearbyAgents();
  }
}
