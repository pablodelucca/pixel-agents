import { TILE_SIZE, MATRIX_EFFECT_DURATION, CharacterState, Direction, TileType, FurnitureType, MAX_COLS, MAX_ROWS } from '../types.js'
import {
  WAITING_BUBBLE_DURATION_SEC,
  DISMISS_BUBBLE_FAST_FADE_SEC,
  INACTIVE_SEAT_TIMER_MIN_SEC,
  INACTIVE_SEAT_TIMER_RANGE_SEC,
  AUTO_ON_FACING_DEPTH,
  AUTO_ON_SIDE_DEPTH,
  CHARACTER_SITTING_OFFSET_PX,
  CHARACTER_HIT_HALF_WIDTH,
  CHARACTER_HIT_HEIGHT,
  ROOM_INTERIOR_WIDTH,
  ROOM_INTERIOR_HEIGHT,
  ROOM_GAP,
  ROOM_DEFAULT_FLOOR_PATTERN,
  DEFAULT_WALL_COLOR,
  KAMEHAMEHA_CHANCE_PER_SEC,
  KAMEHAMEHA_CHARGE_SEC,
  KAMEHAMEHA_KNOCKBACK_TILES,
  KAMEHAMEHA_MAX_RANGE_TILES,
  KAMEHAMEHA_MIN_RANGE_TILES,
  CHAT_PROXIMITY_TILES,
  CHAT_CHANCE,
  CHAT_DURATION_MIN_SEC,
  CHAT_DURATION_MAX_SEC,
  CHAT_EMOJI_INTERVAL_SEC,
  CHAT_EMOJIS,
  CHAT_MESSAGE_DURATION_SEC,
} from '../../constants.js'
import type { Character, Seat, FurnitureInstance, TileType as TileTypeVal, OfficeLayout, PlacedFurniture, FloorColor } from '../types.js'
import { createCharacter, updateCharacter } from './characters.js'
import { matrixEffectSeeds } from './matrixEffect.js'
import { isWalkable, getWalkableTiles, findPath } from '../layout/tileMap.js'
import {
  createDefaultLayout,
  layoutToTileMap,
  layoutToFurnitureInstances,
  layoutToSeats,
  getBlockedTiles,
} from '../layout/layoutSerializer.js'
import { getCatalogEntry, getOnStateType } from '../layout/furnitureCatalog.js'
import { expandLayout } from '../editor/editorActions.js'
import { AvatarIdentity } from '../../avatar/AvatarIdentity.js'

export class OfficeState {
  layout: OfficeLayout
  tileMap: TileTypeVal[][]
  seats: Map<string, Seat>
  blockedTiles: Set<string>
  furniture: FurnitureInstance[]
  walkableTiles: Array<{ col: number; row: number }>
  /** Walkable tiles adjacent to porta-potties, with direction to face the potty */
  bathroomTiles: Array<{ col: number; row: number; faceDir: Direction }> = []
  characters: Map<number, Character> = new Map()
  selectedAgentId: number | null = null
  cameraFollowId: number | null = null
  hoveredAgentId: number | null = null
  hoveredTile: { col: number; row: number } | null = null
  /** Maps "parentId:toolId" → sub-agent character ID (negative) */
  subagentIdMap: Map<string, number> = new Map()
  /** Reverse lookup: sub-agent character ID → parent info */
  subagentMeta: Map<number, { parentAgentId: number; parentToolId: string }> = new Map()
  private nextSubagentId = -1

  // ── Zone data ──────────────────────────────────────────────
  /** Per-tile zone assignment (parallel to layout.tiles). null = lobby */
  zoneMap: Array<string | null> = []
  /** projectId → walkable tiles within that zone */
  zoneWalkableTiles: Map<string, Array<{ col: number; row: number }>> = new Map()
  /** Walkable tiles in the lobby (zone === null) */
  lobbyWalkableTiles: Array<{ col: number; row: number }> = []
  /** Projects that have rooms */
  knownProjects: Set<string> = new Set()
  /** Callback to save layout when rooms are generated */
  onLayoutChanged?: (layout: OfficeLayout) => void
  onInterpolateRemote?: (dt: number) => void
  /** Callback when a kamehameha is initiated (to play sound) */
  onKamehameha?: () => void

  constructor(layout?: OfficeLayout) {
    this.layout = layout || createDefaultLayout()
    this.tileMap = layoutToTileMap(this.layout)
    this.seats = layoutToSeats(this.layout.furniture)
    this.blockedTiles = getBlockedTiles(this.layout.furniture)
    this.furniture = layoutToFurnitureInstances(this.layout.furniture)
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles)
    this.computeBathroomTiles()
    this.rebuildZoneData()
  }

  /** Rebuild all derived state from a new layout. Reassigns existing characters.
   *  @param shift Optional pixel shift to apply when grid expands left/up */
  rebuildFromLayout(layout: OfficeLayout, shift?: { col: number; row: number }): void {
    this.layout = layout
    this.tileMap = layoutToTileMap(layout)
    this.seats = layoutToSeats(layout.furniture)
    this.blockedTiles = getBlockedTiles(layout.furniture)
    this.rebuildFurnitureInstances()
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles)
    this.computeBathroomTiles()
    this.rebuildZoneData()

    // Shift character positions when grid expands left/up
    if (shift && (shift.col !== 0 || shift.row !== 0)) {
      for (const ch of this.characters.values()) {
        ch.tileCol += shift.col
        ch.tileRow += shift.row
        ch.x += shift.col * TILE_SIZE
        ch.y += shift.row * TILE_SIZE
        // Clear path since tile coords changed
        ch.path = []
        ch.moveProgress = 0
      }
    }

    // Reassign characters to new seats, preserving existing assignments when possible
    for (const seat of this.seats.values()) {
      seat.assigned = false
    }

    // First pass: try to keep characters at their existing seats
    for (const ch of this.characters.values()) {
      if (ch.seatId && this.seats.has(ch.seatId)) {
        const seat = this.seats.get(ch.seatId)!
        if (!seat.assigned) {
          seat.assigned = true
          // Snap character to seat position
          ch.tileCol = seat.seatCol
          ch.tileRow = seat.seatRow
          const cx = seat.seatCol * TILE_SIZE + TILE_SIZE / 2
          const cy = seat.seatRow * TILE_SIZE + TILE_SIZE / 2
          ch.x = cx
          ch.y = cy
          ch.dir = seat.facingDir
          continue
        }
      }
      ch.seatId = null // will be reassigned below
    }

    // Second pass: assign remaining characters to free seats
    for (const ch of this.characters.values()) {
      if (ch.seatId) continue
      const seatId = this.findFreeSeat()
      if (seatId) {
        this.seats.get(seatId)!.assigned = true
        ch.seatId = seatId
        const seat = this.seats.get(seatId)!
        ch.tileCol = seat.seatCol
        ch.tileRow = seat.seatRow
        ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2
        ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2
        ch.dir = seat.facingDir
      }
    }

    // Relocate any characters that ended up outside bounds or on non-walkable tiles
    for (const ch of this.characters.values()) {
      if (ch.seatId) continue // seated characters are fine
      if (ch.tileCol < 0 || ch.tileCol >= layout.cols || ch.tileRow < 0 || ch.tileRow >= layout.rows) {
        this.relocateCharacterToWalkable(ch)
      }
    }
  }

  /** Move a character to a random walkable tile */
  private relocateCharacterToWalkable(ch: Character): void {
    if (this.walkableTiles.length === 0) return
    const spawn = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)]
    ch.tileCol = spawn.col
    ch.tileRow = spawn.row
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2
    ch.path = []
    ch.moveProgress = 0
  }

  getLayout(): OfficeLayout {
    return this.layout
  }

  // ── Zone helpers ───────────────────────────────────────────

  /** Rebuild zone data structures from layout.zones */
  private rebuildZoneData(): void {
    const zones = this.layout.zones || new Array(this.layout.tiles.length).fill(null)
    this.zoneMap = zones

    this.zoneWalkableTiles.clear()
    this.lobbyWalkableTiles = []
    this.knownProjects.clear()

    for (const tile of this.walkableTiles) {
      const idx = tile.row * this.layout.cols + tile.col
      const zone = zones[idx]
      if (zone === null || zone === undefined) {
        this.lobbyWalkableTiles.push(tile)
      } else {
        this.knownProjects.add(zone)
        let arr = this.zoneWalkableTiles.get(zone)
        if (!arr) {
          arr = []
          this.zoneWalkableTiles.set(zone, arr)
        }
        arr.push(tile)
      }
    }
  }

  /** Compute walkable tiles adjacent to porta-potties for bathroom behavior */
  private computeBathroomTiles(): void {
    this.bathroomTiles = []
    for (const item of this.layout.furniture) {
      if (item.type !== FurnitureType.PORTA_POTTY) continue
      const adj: Array<{ dc: number; dr: number; dir: Direction }> = [
        { dc: -1, dr: 0, dir: Direction.RIGHT },
        { dc: 1, dr: 0, dir: Direction.LEFT },
        { dc: 0, dr: -1, dir: Direction.DOWN },
        { dc: 0, dr: 1, dir: Direction.UP },
      ]
      for (const { dc, dr, dir } of adj) {
        const nc = item.col + dc
        const nr = item.row + dr
        if (isWalkable(nc, nr, this.tileMap, this.blockedTiles)) {
          this.bathroomTiles.push({ col: nc, row: nr, faceDir: dir })
        }
      }
    }
  }

  /** Get walkable tiles for a character based on zone rules */
  getAgentWalkableTiles(ch: Character): Array<{ col: number; row: number }> {
    if (!ch.projectId) return this.walkableTiles // no project → full access
    const zoneTiles = this.zoneWalkableTiles.get(ch.projectId) || []
    if (ch.isActive) {
      // Active: prefer own zone, fall back to lobby if zone is empty
      return zoneTiles.length > 0 ? zoneTiles : this.lobbyWalkableTiles
    }
    // Idle: own zone + lobby
    return [...zoneTiles, ...this.lobbyWalkableTiles]
  }

  /** Find a free seat in a specific zone, or any free seat as fallback */
  private findFreeSeatInZone(projectId?: string): string | null {
    if (projectId) {
      const zones = this.layout.zones || []
      // First: try seats in the project's zone
      for (const [uid, seat] of this.seats) {
        if (seat.assigned) continue
        const idx = seat.seatRow * this.layout.cols + seat.seatCol
        if (zones[idx] === projectId) return uid
      }
    }
    // Fallback: any free seat
    return this.findFreeSeat()
  }

  /**
   * Generate a 4x3 interior room for a project.
   * Room has walls on perimeter, floor inside, a desk + chair, and a door.
   * Returns true if room was generated.
   */
  generateRoomForProject(projectId: string): boolean {
    if (this.knownProjects.has(projectId)) return false

    // Room dimensions: walls + interior
    const roomW = ROOM_INTERIOR_WIDTH + 2 // +2 for walls on left/right
    const roomH = ROOM_INTERIOR_HEIGHT + 2 // +2 for walls on top/bottom

    // Find bounding box of all non-VOID tiles (the "used area")
    let minCol = this.layout.cols, maxCol = -1
    let minRow = this.layout.rows, maxRow = -1
    for (let r = 0; r < this.layout.rows; r++) {
      for (let c = 0; c < this.layout.cols; c++) {
        const idx = r * this.layout.cols + c
        if (this.layout.tiles[idx] !== TileType.VOID) {
          if (c < minCol) minCol = c
          if (c > maxCol) maxCol = c
          if (r < minRow) minRow = r
          if (r > maxRow) maxRow = r
        }
      }
    }

    if (maxCol === -1) {
      // No non-VOID tiles found, place at origin
      minCol = 0; maxCol = 0; minRow = 0; maxRow = 0
    }

    // Try placement positions: right, bottom, left, top
    type Placement = { col: number; row: number; doorSide: 'left' | 'right' | 'top' | 'bottom' }
    const candidates: Placement[] = [
      // Right of used area
      { col: maxCol + 1 + ROOM_GAP, row: minRow, doorSide: 'left' },
      // Below used area
      { col: minCol, row: maxRow + 1 + ROOM_GAP, doorSide: 'top' },
      // Left of used area
      { col: minCol - roomW - ROOM_GAP, row: minRow, doorSide: 'right' },
      // Above used area
      { col: minCol, row: minRow - roomH - ROOM_GAP, doorSide: 'bottom' },
    ]

    let layout = this.layout
    let placed = false

    for (const candidate of candidates) {
      // Expand layout if needed
      let currentLayout = layout
      let totalShiftCol = 0
      let totalShiftRow = 0

      // Expand right/down if room extends beyond grid
      while (candidate.col + totalShiftCol + roomW > currentLayout.cols && currentLayout.cols < MAX_COLS) {
        const result = expandLayout(currentLayout, 'right')
        if (!result) break
        currentLayout = result.layout
      }
      while (candidate.row + totalShiftRow + roomH > currentLayout.rows && currentLayout.rows < MAX_ROWS) {
        const result = expandLayout(currentLayout, 'down')
        if (!result) break
        currentLayout = result.layout
      }
      // Expand left/up if room starts before grid
      while (candidate.col + totalShiftCol < 0 && currentLayout.cols < MAX_COLS) {
        const result = expandLayout(currentLayout, 'left')
        if (!result) break
        currentLayout = result.layout
        totalShiftCol += result.shift.col
      }
      while (candidate.row + totalShiftRow < 0 && currentLayout.rows < MAX_ROWS) {
        const result = expandLayout(currentLayout, 'up')
        if (!result) break
        currentLayout = result.layout
        totalShiftRow += result.shift.row
      }

      const roomCol = candidate.col + totalShiftCol
      const roomRow = candidate.row + totalShiftRow

      // Verify all tiles in proposed area are VOID
      if (roomCol < 0 || roomRow < 0 || roomCol + roomW > currentLayout.cols || roomRow + roomH > currentLayout.rows) {
        continue
      }

      let allVoid = true
      for (let r = roomRow; r < roomRow + roomH; r++) {
        for (let c = roomCol; c < roomCol + roomW; c++) {
          const idx = r * currentLayout.cols + c
          if (currentLayout.tiles[idx] !== TileType.VOID) {
            allVoid = false
            break
          }
        }
        if (!allVoid) break
      }
      if (!allVoid) continue

      // Place the room
      const tiles = [...currentLayout.tiles]
      const tileColors = [...(currentLayout.tileColors || new Array(tiles.length).fill(null))]
      const zones = [...(currentLayout.zones || new Array(tiles.length).fill(null) as Array<string | null>)]

      // Generate a hue for this room based on projectId hash
      const hue = layout.zoneColors?.[projectId] ?? OfficeState.projectIdToHue(projectId)
      const roomFloorColor: FloorColor = { h: hue, s: 30, b: 10, c: 0 }

      for (let r = roomRow; r < roomRow + roomH; r++) {
        for (let c = roomCol; c < roomCol + roomW; c++) {
          const idx = r * currentLayout.cols + c
          const isPerimeter = r === roomRow || r === roomRow + roomH - 1 || c === roomCol || c === roomCol + roomW - 1
          if (isPerimeter) {
            tiles[idx] = TileType.WALL
            tileColors[idx] = DEFAULT_WALL_COLOR
          } else {
            tiles[idx] = ROOM_DEFAULT_FLOOR_PATTERN as TileTypeVal
            tileColors[idx] = roomFloorColor
            zones[idx] = projectId
          }
        }
      }

      // Place door: one floor tile on the wall closest to lobby
      const doorSide = candidate.doorSide
      let doorCol: number, doorRow: number
      const midInteriorCol = roomCol + 1 + Math.floor(ROOM_INTERIOR_WIDTH / 2)
      const midInteriorRow = roomRow + 1 + Math.floor(ROOM_INTERIOR_HEIGHT / 2)
      if (doorSide === 'left') {
        doorCol = roomCol
        doorRow = midInteriorRow
      } else if (doorSide === 'right') {
        doorCol = roomCol + roomW - 1
        doorRow = midInteriorRow
      } else if (doorSide === 'top') {
        doorCol = midInteriorCol
        doorRow = roomRow
      } else {
        doorCol = midInteriorCol
        doorRow = roomRow + roomH - 1
      }
      const doorIdx = doorRow * currentLayout.cols + doorCol
      tiles[doorIdx] = ROOM_DEFAULT_FLOOR_PATTERN as TileTypeVal
      tileColors[doorIdx] = roomFloorColor
      // Door is lobby (null zone) so agents can walk through it
      zones[doorIdx] = null

      // Place furniture: 1 desk + 1 chair inside the room
      const furniture = [...currentLayout.furniture]
      const deskCol = roomCol + 1
      const deskRow = roomRow + 1
      const deskUid = `room-${projectId}-desk`
      const chairUid = `room-${projectId}-chair`

      // Try to use catalog desk if available, otherwise use basic furniture type
      furniture.push({ uid: deskUid, type: FurnitureType.DESK, col: deskCol, row: deskRow })
      // Chair below the desk (facing up toward desk)
      const chairCol = deskCol
      const chairRow = deskRow + 2 < roomRow + roomH - 1 ? deskRow + 2 : deskRow - 1
      furniture.push({ uid: chairUid, type: FurnitureType.CHAIR, col: chairCol, row: chairRow })

      layout = { ...currentLayout, tiles, tileColors, zones, furniture }

      // Apply shift to existing characters if we expanded left/up
      if (totalShiftCol !== 0 || totalShiftRow !== 0) {
        for (const ch of this.characters.values()) {
          ch.tileCol += totalShiftCol
          ch.tileRow += totalShiftRow
          ch.x += totalShiftCol * TILE_SIZE
          ch.y += totalShiftRow * TILE_SIZE
          ch.path = []
          ch.moveProgress = 0
        }
      }

      placed = true
      break
    }

    if (!placed) return false

    // Rebuild everything from new layout
    this.layout = layout
    this.tileMap = layoutToTileMap(layout)
    this.seats = layoutToSeats(layout.furniture)
    this.blockedTiles = getBlockedTiles(layout.furniture)
    this.rebuildFurnitureInstances()
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles)
    this.computeBathroomTiles()
    this.rebuildZoneData()

    // Re-assign existing seats
    for (const seat of this.seats.values()) {
      seat.assigned = false
    }
    for (const ch of this.characters.values()) {
      if (ch.seatId && this.seats.has(ch.seatId)) {
        this.seats.get(ch.seatId)!.assigned = true
      } else {
        ch.seatId = null
      }
    }

    // Notify to save layout
    this.onLayoutChanged?.(layout)

    return true
  }

  /** Generate a deterministic hue from a projectId string */
  static projectIdToHue(projectId: string): number {
    let hash = 0
    for (let i = 0; i < projectId.length; i++) {
      hash = ((hash << 5) - hash + projectId.charCodeAt(i)) | 0
    }
    return ((hash % 360) + 360) % 360
  }

  /** Get the blocked-tile key for a character's own seat, or null */
  private ownSeatKey(ch: Character): string | null {
    if (!ch.seatId) return null
    const seat = this.seats.get(ch.seatId)
    if (!seat) return null
    return `${seat.seatCol},${seat.seatRow}`
  }

  /** Temporarily unblock a character's own seat, run fn, then re-block */
  private withOwnSeatUnblocked<T>(ch: Character, fn: () => T): T {
    const key = this.ownSeatKey(ch)
    if (key) this.blockedTiles.delete(key)
    const result = fn()
    if (key) this.blockedTiles.add(key)
    return result
  }

  private findFreeSeat(): string | null {
    for (const [uid, seat] of this.seats) {
      if (!seat.assigned) return uid
    }
    return null
  }

  addAgent(id: number, preferredPalette?: number, preferredHueShift?: number, preferredSeatId?: string, skipSpawnEffect?: boolean, folderName?: string, isExternal?: boolean, projectId?: string): void {
    if (this.characters.has(id)) return

    // Generate room for project if it doesn't exist yet
    if (projectId && !this.knownProjects.has(projectId)) {
      this.generateRoomForProject(projectId)
    }

    let palette: number
    let hueShift: number
    if (preferredPalette !== undefined) {
      palette = preferredPalette
      hueShift = preferredHueShift ?? 0
    } else {
      const existing = [...this.characters.values()]
        .filter(ch => !ch.isSubagent)
        .map(ch => ({ palette: ch.palette, hueShift: ch.hueShift }))
      const pick = AvatarIdentity.pickDiverse(existing)
      palette = pick.palette
      hueShift = pick.hueShift
    }

    // Try preferred seat first, then seat in project zone, then any free seat
    let seatId: string | null = null
    if (preferredSeatId && this.seats.has(preferredSeatId)) {
      const seat = this.seats.get(preferredSeatId)!
      if (!seat.assigned) {
        seatId = preferredSeatId
      }
    }
    if (!seatId) {
      seatId = this.findFreeSeatInZone(projectId)
    }

    let ch: Character
    if (seatId) {
      const seat = this.seats.get(seatId)!
      seat.assigned = true
      ch = createCharacter(id, palette, seatId, seat, hueShift)
    } else {
      // No seats — spawn at random walkable tile
      const spawn = this.walkableTiles.length > 0
        ? this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)]
        : { col: 1, row: 1 }
      ch = createCharacter(id, palette, null, null, hueShift)
      ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2
      ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2
      ch.tileCol = spawn.col
      ch.tileRow = spawn.row
    }

    if (folderName) {
      ch.folderName = folderName
    }
    if (isExternal) {
      ch.isExternal = true
    }
    if (projectId) {
      ch.projectId = projectId
    }
    if (!skipSpawnEffect) {
      ch.matrixEffect = 'spawn'
      ch.matrixEffectTimer = 0
      ch.matrixEffectSeeds = matrixEffectSeeds()
    }
    this.characters.set(id, ch)
  }

  removeAgent(id: number): void {
    const ch = this.characters.get(id)
    if (!ch) return
    if (ch.matrixEffect === 'despawn') return // already despawning
    // Free seat and clear selection immediately
    if (ch.seatId) {
      const seat = this.seats.get(ch.seatId)
      if (seat) seat.assigned = false
    }
    if (this.selectedAgentId === id) this.selectedAgentId = null
    if (this.cameraFollowId === id) this.cameraFollowId = null
    // Start despawn animation instead of immediate delete
    ch.matrixEffect = 'despawn'
    ch.matrixEffectTimer = 0
    ch.matrixEffectSeeds = matrixEffectSeeds()
    ch.bubbleType = null
  }

  /** Find seat uid at a given tile position, or null */
  getSeatAtTile(col: number, row: number): string | null {
    for (const [uid, seat] of this.seats) {
      if (seat.seatCol === col && seat.seatRow === row) return uid
    }
    return null
  }

  /** Reassign an agent from their current seat to a new seat */
  reassignSeat(agentId: number, seatId: string): void {
    const ch = this.characters.get(agentId)
    if (!ch) return
    // Unassign old seat
    if (ch.seatId) {
      const old = this.seats.get(ch.seatId)
      if (old) old.assigned = false
    }
    // Assign new seat
    const seat = this.seats.get(seatId)
    if (!seat || seat.assigned) return
    seat.assigned = true
    ch.seatId = seatId
    // Pathfind to new seat (unblock own seat tile for this query)
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles)
    )
    if (path.length > 0) {
      ch.path = path
      ch.moveProgress = 0
      ch.state = CharacterState.WALK
      ch.frame = 0
      ch.frameTimer = 0
    } else {
      // Already at seat or no path — sit down
      ch.state = CharacterState.TYPE
      ch.dir = seat.facingDir
      ch.frame = 0
      ch.frameTimer = 0
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC
      }
    }
  }

  /** Send an agent back to their currently assigned seat */
  sendToSeat(agentId: number): void {
    const ch = this.characters.get(agentId)
    if (!ch || !ch.seatId) return
    const seat = this.seats.get(ch.seatId)
    if (!seat) return
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles)
    )
    if (path.length > 0) {
      ch.path = path
      ch.moveProgress = 0
      ch.state = CharacterState.WALK
      ch.frame = 0
      ch.frameTimer = 0
    } else {
      // Already at seat — sit down
      ch.state = CharacterState.TYPE
      ch.dir = seat.facingDir
      ch.frame = 0
      ch.frameTimer = 0
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC
      }
    }
  }

  /** Walk an agent to an arbitrary walkable tile (right-click command) */
  walkToTile(agentId: number, col: number, row: number): boolean {
    const ch = this.characters.get(agentId)
    if (!ch || ch.isSubagent) return false
    if (!isWalkable(col, row, this.tileMap, this.blockedTiles)) {
      // Also allow walking to own seat tile (blocked for others but not self)
      const key = this.ownSeatKey(ch)
      if (!key || key !== `${col},${row}`) return false
    }
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, col, row, this.tileMap, this.blockedTiles)
    )
    if (path.length === 0) return false
    ch.path = path
    ch.moveProgress = 0
    ch.state = CharacterState.WALK
    ch.frame = 0
    ch.frameTimer = 0
    return true
  }

  /** Create a sub-agent character with the parent's palette. Returns the sub-agent ID. */
  addSubagent(parentAgentId: number, parentToolId: string): number {
    const key = `${parentAgentId}:${parentToolId}`
    if (this.subagentIdMap.has(key)) return this.subagentIdMap.get(key)!

    const id = this.nextSubagentId--
    const parentCh = this.characters.get(parentAgentId)
    const palette = parentCh ? parentCh.palette : 0
    const hueShift = parentCh ? parentCh.hueShift : 0

    // Find the free seat closest to the parent agent
    const parentCol = parentCh ? parentCh.tileCol : 0
    const parentRow = parentCh ? parentCh.tileRow : 0
    const dist = (c: number, r: number) =>
      Math.abs(c - parentCol) + Math.abs(r - parentRow)

    let bestSeatId: string | null = null
    let bestDist = Infinity
    for (const [uid, seat] of this.seats) {
      if (!seat.assigned) {
        const d = dist(seat.seatCol, seat.seatRow)
        if (d < bestDist) {
          bestDist = d
          bestSeatId = uid
        }
      }
    }

    let ch: Character
    if (bestSeatId) {
      const seat = this.seats.get(bestSeatId)!
      seat.assigned = true
      ch = createCharacter(id, palette, bestSeatId, seat, hueShift)
    } else {
      // No seats — spawn at closest walkable tile to parent
      let spawn = { col: 1, row: 1 }
      if (this.walkableTiles.length > 0) {
        let closest = this.walkableTiles[0]
        let closestDist = dist(closest.col, closest.row)
        for (let i = 1; i < this.walkableTiles.length; i++) {
          const d = dist(this.walkableTiles[i].col, this.walkableTiles[i].row)
          if (d < closestDist) {
            closest = this.walkableTiles[i]
            closestDist = d
          }
        }
        spawn = closest
      }
      ch = createCharacter(id, palette, null, null, hueShift)
      ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2
      ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2
      ch.tileCol = spawn.col
      ch.tileRow = spawn.row
    }
    ch.isSubagent = true
    ch.parentAgentId = parentAgentId
    if (parentCh?.projectId) {
      ch.projectId = parentCh.projectId
    }
    ch.matrixEffect = 'spawn'
    ch.matrixEffectTimer = 0
    ch.matrixEffectSeeds = matrixEffectSeeds()
    this.characters.set(id, ch)

    this.subagentIdMap.set(key, id)
    this.subagentMeta.set(id, { parentAgentId, parentToolId })
    return id
  }

  /** Remove a specific sub-agent character and free its seat */
  removeSubagent(parentAgentId: number, parentToolId: string): void {
    const key = `${parentAgentId}:${parentToolId}`
    const id = this.subagentIdMap.get(key)
    if (id === undefined) return

    const ch = this.characters.get(id)
    if (ch) {
      if (ch.matrixEffect === 'despawn') {
        // Already despawning — just clean up maps
        this.subagentIdMap.delete(key)
        this.subagentMeta.delete(id)
        return
      }
      if (ch.seatId) {
        const seat = this.seats.get(ch.seatId)
        if (seat) seat.assigned = false
      }
      // Start despawn animation — keep character in map for rendering
      ch.matrixEffect = 'despawn'
      ch.matrixEffectTimer = 0
      ch.matrixEffectSeeds = matrixEffectSeeds()
      ch.bubbleType = null
    }
    // Clean up tracking maps immediately so keys don't collide
    this.subagentIdMap.delete(key)
    this.subagentMeta.delete(id)
    if (this.selectedAgentId === id) this.selectedAgentId = null
    if (this.cameraFollowId === id) this.cameraFollowId = null
  }

  /** Remove all sub-agents belonging to a parent agent */
  removeAllSubagents(parentAgentId: number): void {
    const toRemove: string[] = []
    for (const [key, id] of this.subagentIdMap) {
      const meta = this.subagentMeta.get(id)
      if (meta && meta.parentAgentId === parentAgentId) {
        const ch = this.characters.get(id)
        if (ch) {
          if (ch.matrixEffect === 'despawn') {
            // Already despawning — just clean up maps
            this.subagentMeta.delete(id)
            toRemove.push(key)
            continue
          }
          if (ch.seatId) {
            const seat = this.seats.get(ch.seatId)
            if (seat) seat.assigned = false
          }
          // Start despawn animation
          ch.matrixEffect = 'despawn'
          ch.matrixEffectTimer = 0
          ch.matrixEffectSeeds = matrixEffectSeeds()
          ch.bubbleType = null
        }
        this.subagentMeta.delete(id)
        if (this.selectedAgentId === id) this.selectedAgentId = null
        if (this.cameraFollowId === id) this.cameraFollowId = null
        toRemove.push(key)
      }
    }
    for (const key of toRemove) {
      this.subagentIdMap.delete(key)
    }
  }

  /** Look up the sub-agent character ID for a given parent+toolId, or null */
  getSubagentId(parentAgentId: number, parentToolId: string): number | null {
    return this.subagentIdMap.get(`${parentAgentId}:${parentToolId}`) ?? null
  }

  setAgentActive(id: number, active: boolean): void {
    const ch = this.characters.get(id)
    if (ch) {
      ch.isActive = active
      if (!active) {
        // Sentinel -1: signals turn just ended, skip next seat rest timer.
        // Prevents the WALK handler from setting a 2-4 min rest on arrival.
        ch.seatTimer = -1
        ch.path = []
        ch.moveProgress = 0
      } else if (ch.projectId) {
        // Rush back to zone when becoming active and outside own zone
        const idx = ch.tileRow * this.layout.cols + ch.tileCol
        const currentZone = this.zoneMap[idx]
        if (currentZone !== ch.projectId) {
          // Pathfind to assigned seat (in zone) or nearest zone tile
          if (ch.seatId) {
            const seat = this.seats.get(ch.seatId)
            if (seat) {
              const path = this.withOwnSeatUnblocked(ch, () =>
                findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles)
              )
              if (path.length > 0) {
                ch.path = path
                ch.moveProgress = 0
                ch.state = CharacterState.WALK
                ch.frame = 0
                ch.frameTimer = 0
              }
            }
          }
        }
      }
      this.rebuildFurnitureInstances()
    }
  }

  /** Rebuild furniture instances with auto-state applied (active agents turn electronics ON) */
  private rebuildFurnitureInstances(): void {
    // Collect tiles where active agents face desks
    const autoOnTiles = new Set<string>()
    for (const ch of this.characters.values()) {
      if (!ch.isActive || !ch.seatId || ch.isRemote) continue
      const seat = this.seats.get(ch.seatId)
      if (!seat) continue
      // Find the desk tile(s) the agent faces from their seat
      const dCol = seat.facingDir === Direction.RIGHT ? 1 : seat.facingDir === Direction.LEFT ? -1 : 0
      const dRow = seat.facingDir === Direction.DOWN ? 1 : seat.facingDir === Direction.UP ? -1 : 0
      // Check tiles in the facing direction (desk could be 1-3 tiles deep)
      for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
        const tileCol = seat.seatCol + dCol * d
        const tileRow = seat.seatRow + dRow * d
        autoOnTiles.add(`${tileCol},${tileRow}`)
      }
      // Also check tiles to the sides of the facing direction (desks can be wide)
      for (let d = 1; d <= AUTO_ON_SIDE_DEPTH; d++) {
        const baseCol = seat.seatCol + dCol * d
        const baseRow = seat.seatRow + dRow * d
        if (dCol !== 0) {
          // Facing left/right: check tiles above and below
          autoOnTiles.add(`${baseCol},${baseRow - 1}`)
          autoOnTiles.add(`${baseCol},${baseRow + 1}`)
        } else {
          // Facing up/down: check tiles left and right
          autoOnTiles.add(`${baseCol - 1},${baseRow}`)
          autoOnTiles.add(`${baseCol + 1},${baseRow}`)
        }
      }
    }

    if (autoOnTiles.size === 0) {
      this.furniture = layoutToFurnitureInstances(this.layout.furniture)
      return
    }

    // Build modified furniture list with auto-state applied
    const modifiedFurniture: PlacedFurniture[] = this.layout.furniture.map((item) => {
      const entry = getCatalogEntry(item.type)
      if (!entry) return item
      // Check if any tile of this furniture overlaps an auto-on tile
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          if (autoOnTiles.has(`${item.col + dc},${item.row + dr}`)) {
            const onType = getOnStateType(item.type)
            if (onType !== item.type) {
              return { ...item, type: onType }
            }
            return item
          }
        }
      }
      return item
    })

    this.furniture = layoutToFurnitureInstances(modifiedFurniture)
  }

  setAgentTasks(id: number, tasks: Array<{ taskId: string; subject: string; status: 'pending' | 'in_progress' | 'completed' }>): void {
    const ch = this.characters.get(id)
    if (ch) {
      ch.tasks = tasks
    }
  }

  setAgentTool(id: number, tool: string | null): void {
    const ch = this.characters.get(id)
    if (ch) {
      ch.currentTool = tool
    }
  }

  showPermissionBubble(id: number): void {
    const ch = this.characters.get(id)
    if (ch) {
      ch.bubbleType = 'permission'
      ch.bubbleTimer = 0
    }
  }

  clearPermissionBubble(id: number): void {
    const ch = this.characters.get(id)
    if (ch && ch.bubbleType === 'permission') {
      ch.bubbleType = null
      ch.bubbleTimer = 0
    }
  }

  showThinkingBubble(id: number): void {
    const ch = this.characters.get(id)
    if (ch) {
      ch.bubbleType = 'thinking'
      ch.bubbleTimer = 0
    }
  }

  clearThinkingBubble(id: number): void {
    const ch = this.characters.get(id)
    if (ch && ch.bubbleType === 'thinking') {
      ch.bubbleType = null
      ch.bubbleTimer = 0
    }
  }

  showWaitingBubble(id: number): void {
    const ch = this.characters.get(id)
    if (ch) {
      ch.bubbleType = 'waiting'
      ch.bubbleTimer = WAITING_BUBBLE_DURATION_SEC
    }
  }

  /** Dismiss bubble on click — permission: instant, waiting: quick fade */
  dismissBubble(id: number): void {
    const ch = this.characters.get(id)
    if (!ch || !ch.bubbleType) return
    if (ch.bubbleType === 'permission') {
      ch.bubbleType = null
      ch.bubbleTimer = 0
    } else if (ch.bubbleType === 'waiting') {
      // Trigger immediate fade (0.3s remaining)
      ch.bubbleTimer = Math.min(ch.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC)
    }
  }

  /** Chat zoom popup: shows zoomed view of character when they post a chat message */
  chatZoomAgentId: number | null = null

  showChatMessage(agentId: number, msg: string): void {
    const ch = this.characters.get(agentId)
    if (!ch) return
    ch.chatMessage = msg
    ch.chatMessageTimer = CHAT_MESSAGE_DURATION_SEC
    this.chatZoomAgentId = agentId
  }

  dismissChatZoom(): void {
    this.chatZoomAgentId = null
  }

  update(dt: number): void {
    const toDelete: number[] = []
    for (const ch of this.characters.values()) {
      // Handle matrix effect animation
      if (ch.matrixEffect) {
        ch.matrixEffectTimer += dt
        if (ch.matrixEffectTimer >= MATRIX_EFFECT_DURATION) {
          if (ch.matrixEffect === 'spawn') {
            // Spawn complete — clear effect, resume normal FSM
            ch.matrixEffect = null
            ch.matrixEffectTimer = 0
            ch.matrixEffectSeeds = []
          } else {
            // Despawn complete — mark for deletion
            toDelete.push(ch.id)
          }
        }
        continue // skip normal FSM while effect is active
      }

      // Remote characters are driven by RemoteCharacterManager.interpolate()
      if (ch.isRemote) continue

      {
        const wanderTiles = ch.isSubagent ? this.walkableTiles : this.getAgentWalkableTiles(ch)
        this.withOwnSeatUnblocked(ch, () =>
          updateCharacter(ch, dt, wanderTiles, this.seats, this.tileMap, this.blockedTiles, this.layout.furniture, this.bathroomTiles)
        )
      }

      // Tick bubble timer for waiting bubbles
      if (ch.bubbleType === 'waiting') {
        ch.bubbleTimer -= dt
        if (ch.bubbleTimer <= 0) {
          ch.bubbleType = null
          ch.bubbleTimer = 0
        }
      }

      // Tick chat message timer
      if (ch.chatMessage) {
        ch.chatMessageTimer -= dt
        if (ch.chatMessageTimer <= 0) {
          ch.chatMessage = null
          ch.chatMessageTimer = 0
          if (this.chatZoomAgentId === ch.id) {
            this.chatZoomAgentId = null
          }
        }
      }
    }

    // Interpolate remote characters (driven by RemoteCharacterManager)
    this.onInterpolateRemote?.(dt)

    // Kamehameha: check for fire phase transitions → start knockback on targets
    for (const ch of this.characters.values()) {
      if (ch.state !== CharacterState.KAMEHAMEHA || ch.kamehamehaPhase !== 'fire') continue
      if (ch.kamehamehaTargetId === null) continue
      const target = this.characters.get(ch.kamehamehaTargetId)
      if (!target || target.state === CharacterState.KNOCKED) continue
      this.startKnockback(ch, target)
    }

    // Kamehameha: random trigger for idle characters
    for (const ch of this.characters.values()) {
      if (ch.state !== CharacterState.IDLE) continue
      if (ch.isActive || ch.isSubagent || ch.matrixEffect) continue
      if (Math.random() > KAMEHAMEHA_CHANCE_PER_SEC * dt) continue
      const target = this.findKamehamehaTarget(ch)
      if (!target) continue
      this.initiateKamehameha(ch, target)
    }

    // Chat encounters: idle characters on adjacent tiles start chatting (Sims-style)
    for (const ch of this.characters.values()) {
      if (ch.state !== CharacterState.IDLE || ch.isActive || ch.isSubagent || ch.matrixEffect) continue
      if (Math.random() > CHAT_CHANCE * dt) continue
      // Find an adjacent idle character
      for (const other of this.characters.values()) {
        if (other.id === ch.id) continue
        if (other.state !== CharacterState.IDLE || other.isActive || other.isSubagent || other.matrixEffect) continue
        const dist = Math.abs(other.tileCol - ch.tileCol) + Math.abs(other.tileRow - ch.tileRow)
        if (dist > CHAT_PROXIMITY_TILES) continue
        this.startChat(ch, other)
        break
      }
    }

    // Remove characters that finished despawn
    for (const id of toDelete) {
      this.characters.delete(id)
    }
  }

  /** Start a Sims-style chat between two characters */
  private startChat(a: Character, b: Character): void {
    const duration = CHAT_DURATION_MIN_SEC + Math.random() * (CHAT_DURATION_MAX_SEC - CHAT_DURATION_MIN_SEC)
    const emojiCount = Math.ceil(duration / CHAT_EMOJI_INTERVAL_SEC) + 1

    // Pick random emojis for each — different sequences so it looks like a real conversation
    const pickEmojis = () => {
      const emojis: string[] = []
      for (let i = 0; i < emojiCount; i++) {
        emojis.push(CHAT_EMOJIS[Math.floor(Math.random() * CHAT_EMOJIS.length)])
      }
      return emojis
    }

    // Face each other
    const dc = b.tileCol - a.tileCol
    const dr = b.tileRow - a.tileRow
    if (Math.abs(dc) >= Math.abs(dr)) {
      a.dir = dc > 0 ? Direction.RIGHT : Direction.LEFT
      b.dir = dc > 0 ? Direction.LEFT : Direction.RIGHT
    } else {
      a.dir = dr > 0 ? Direction.DOWN : Direction.UP
      b.dir = dr > 0 ? Direction.UP : Direction.DOWN
    }

    for (const ch of [a, b]) {
      ch.state = CharacterState.CHATTING
      ch.chattingWithId = ch === a ? b.id : a.id
      ch.chattingTimer = duration
      ch.chatEmojis = pickEmojis()
      ch.chatEmojiIndex = 0
      ch.chatEmojiTimer = CHAT_EMOJI_INTERVAL_SEC
      ch.path = []
      ch.moveProgress = 0
      ch.frame = 0
      ch.frameTimer = 0
      // Clear any existing interact emoji
      ch.interactEmoji = null
      ch.interactEmojiTimer = 0
    }
  }

  /** Find a valid kamehameha target: another idle non-active character within range */
  private findKamehamehaTarget(attacker: Character): Character | null {
    const candidates: Character[] = []
    for (const ch of this.characters.values()) {
      if (ch.id === attacker.id) continue
      if (ch.state !== CharacterState.IDLE) continue
      if (ch.isActive || ch.isSubagent || ch.matrixEffect) continue
      const dist = Math.abs(ch.tileCol - attacker.tileCol) + Math.abs(ch.tileRow - attacker.tileRow)
      if (dist > KAMEHAMEHA_MAX_RANGE_TILES || dist < KAMEHAMEHA_MIN_RANGE_TILES) continue
      candidates.push(ch)
    }
    if (candidates.length === 0) return null
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  /** Start a kamehameha attack from attacker toward target */
  private initiateKamehameha(attacker: Character, target: Character): void {
    attacker.state = CharacterState.KAMEHAMEHA
    attacker.kamehamehaPhase = 'charge'
    attacker.kamehamehaTimer = KAMEHAMEHA_CHARGE_SEC
    attacker.kamehamehaTargetId = target.id
    attacker.frame = 0
    attacker.frameTimer = 0
    attacker.path = []
    attacker.moveProgress = 0

    // Face the target
    const dc = target.tileCol - attacker.tileCol
    const dr = target.tileRow - attacker.tileRow
    if (Math.abs(dc) >= Math.abs(dr)) {
      attacker.dir = dc > 0 ? Direction.RIGHT : Direction.LEFT
    } else {
      attacker.dir = dr > 0 ? Direction.DOWN : Direction.UP
    }

    this.onKamehameha?.()
  }

  /** Apply knockback to the target character */
  private startKnockback(attacker: Character, target: Character): void {
    // Knockback direction: from attacker toward target
    const dc = target.tileCol - attacker.tileCol
    const dr = target.tileRow - attacker.tileRow
    let dirCol: number, dirRow: number
    if (Math.abs(dc) >= Math.abs(dr)) {
      dirCol = dc > 0 ? 1 : -1
      dirRow = 0
    } else {
      dirCol = 0
      dirRow = dr > 0 ? 1 : -1
    }

    // Find farthest walkable tile in knockback direction
    let destCol = target.tileCol
    let destRow = target.tileRow
    for (let i = 1; i <= KAMEHAMEHA_KNOCKBACK_TILES; i++) {
      const nc = target.tileCol + dirCol * i
      const nr = target.tileRow + dirRow * i
      if (isWalkable(nc, nr, this.tileMap, this.blockedTiles)) {
        destCol = nc
        destRow = nr
      } else {
        break
      }
    }

    target.state = CharacterState.KNOCKED
    target.knockbackFromX = target.x
    target.knockbackFromY = target.y
    target.knockbackToX = destCol * TILE_SIZE + TILE_SIZE / 2
    target.knockbackToY = destRow * TILE_SIZE + TILE_SIZE / 2
    target.knockbackProgress = 0
    target.knockbackRecoveryTimer = 0
    target.frame = 0
    target.frameTimer = 0
    target.path = []
    target.moveProgress = 0

    // Face toward attacker (getting hit)
    if (dirCol > 0) target.dir = Direction.LEFT
    else if (dirCol < 0) target.dir = Direction.RIGHT
    else if (dirRow > 0) target.dir = Direction.UP
    else target.dir = Direction.DOWN
  }

  getCharacters(): Character[] {
    return Array.from(this.characters.values())
  }

  /** Get character at pixel position (for hit testing). Returns id or null. */
  getCharacterAt(worldX: number, worldY: number): number | null {
    const chars = this.getCharacters().sort((a, b) => b.y - a.y)
    for (const ch of chars) {
      // Skip characters that are despawning or in bathroom
      if (ch.matrixEffect === 'despawn') continue
      if (ch.state === CharacterState.BATHROOM) continue
      // Character sprite is 16x24, anchored bottom-center
      // Apply sitting offset to match visual position
      const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
      const anchorY = ch.y + sittingOffset
      const left = ch.x - CHARACTER_HIT_HALF_WIDTH
      const right = ch.x + CHARACTER_HIT_HALF_WIDTH
      const top = anchorY - CHARACTER_HIT_HEIGHT
      const bottom = anchorY
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        return ch.id
      }
    }
    return null
  }
}
