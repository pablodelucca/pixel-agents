import { CharacterState, Direction, FurnitureType, TILE_SIZE } from '../types.js'
import type { Character, PlacedFurniture } from '../types.js'
import { findPath } from '../layout/tileMap.js'
import type { OfficeState } from './officeState.js'
import {
  FOOSBALL_BALL_SPEED_PX_PER_SEC,
  FOOSBALL_GAME_IDLE_CHECK_SEC,
  FOOSBALL_TABLE_INNER_MARGIN,
} from '../../constants.js'

export interface FoosballGame {
  /** Furniture reference */
  tableUid: string
  /** Table position in tiles */
  tableCol: number
  tableRow: number
  /** Player character IDs: [top, bottom] */
  players: [number, number]
  /** Ball position in pixels (world coords, within table bounds) */
  ballX: number
  ballY: number
  /** Ball velocity in px/sec */
  ballVX: number
  ballVY: number
  /** Scores: [top player, bottom player] */
  scores: [number, number]
  /** Game phase */
  phase: 'walking' | 'playing' | 'ending'
  /** Timer for phase transitions */
  phaseTimer: number
  /** Number of players that have arrived at position */
  arrivedCount: number
}

export class FoosballManager {
  private games: Map<string, FoosballGame> = new Map()
  private idleCheckTimer = 0
  /** Session-wide win tracking: characterId → total wins */
  sessionWins: Map<number, number> = new Map()

  getGames(): FoosballGame[] {
    return Array.from(this.games.values())
  }

  /** Check if a character is currently in a foosball game */
  isInGame(charId: number): boolean {
    for (const game of this.games.values()) {
      if (game.players[0] === charId || game.players[1] === charId) return true
    }
    return false
  }

  tryStartGame(idleCharacters: Character[], state: OfficeState): void {
    this.idleCheckTimer -= 0
    // Find foosball tables not currently hosting a game
    const tables = state.layout.furniture.filter(
      (f) => f.type === FurnitureType.FOOSBALL && !this.games.has(f.uid),
    )
    if (tables.length === 0) return

    // Filter idle chars not already in a game
    const available = idleCharacters.filter((ch) => !this.isInGame(ch.id))
    if (available.length < 2) return

    for (const table of tables) {
      if (available.length < 2) break

      // Pick 2 random idle characters
      const idx1 = Math.floor(Math.random() * available.length)
      const char1 = available.splice(idx1, 1)[0]
      const idx2 = Math.floor(Math.random() * available.length)
      const char2 = available.splice(idx2, 1)[0]

      // Player positions: top side (row - 1) and bottom side (row + 1)
      // Each stands at the center column of the 2-wide table
      const topCol = table.col
      const topRow = table.row - 1
      const botCol = table.col
      const botRow = table.row + 1

      // Pathfind players to positions — temporarily unblock their own seat tiles
      // so they can leave their chairs (seat tiles are normally blocked)
      const seatKey1 = char1.seatId ? this.seatTileKey(char1, state) : null
      const seatKey2 = char2.seatId ? this.seatTileKey(char2, state) : null
      if (seatKey1) state.blockedTiles.delete(seatKey1)
      if (seatKey2) state.blockedTiles.delete(seatKey2)

      const path1 = findPath(char1.tileCol, char1.tileRow, topCol, topRow, state.tileMap, state.blockedTiles)
      const path2 = findPath(char2.tileCol, char2.tileRow, botCol, botRow, state.tileMap, state.blockedTiles)

      if (seatKey1) state.blockedTiles.add(seatKey1)
      if (seatKey2) state.blockedTiles.add(seatKey2)

      // If either can't reach, skip this table
      if (path1.length === 0 && !(char1.tileCol === topCol && char1.tileRow === topRow)) continue
      if (path2.length === 0 && !(char2.tileCol === botCol && char2.tileRow === botRow)) continue

      // Set characters walking
      const game: FoosballGame = {
        tableUid: table.uid,
        tableCol: table.col,
        tableRow: table.row,
        players: [char1.id, char2.id],
        ballX: table.col * TILE_SIZE + TILE_SIZE, // center of 2-wide table
        ballY: table.row * TILE_SIZE + TILE_SIZE / 2,
        ballVX: 0,
        ballVY: 0,
        scores: [0, 0],
        phase: 'walking',
        phaseTimer: 0,
        arrivedCount: 0,
      }

      // Set both to FOOSBALL state and start walking
      this.setCharacterWalking(char1, path1, topCol, topRow, Direction.DOWN)
      this.setCharacterWalking(char2, path2, botCol, botRow, Direction.UP)

      this.games.set(table.uid, game)
    }
  }

  private setCharacterWalking(ch: Character, path: Array<{ col: number; row: number }>, targetCol: number, targetRow: number, faceDir: Direction): void {
    ch.state = CharacterState.WALK
    ch.frame = 0
    ch.frameTimer = 0
    if (ch.tileCol === targetCol && ch.tileRow === targetRow) {
      // Already there
      ch.state = CharacterState.FOOSBALL
      ch.dir = faceDir
      ch.path = []
    } else {
      ch.path = path
      ch.moveProgress = 0
    }
  }

  private resetBall(game: FoosballGame): void {
    game.ballX = game.tableCol * TILE_SIZE + TILE_SIZE // center
    game.ballY = game.tableRow * TILE_SIZE + TILE_SIZE / 2
    // Random direction
    const angle = (Math.random() * Math.PI / 2) - Math.PI / 4 + (Math.random() < 0.5 ? 0 : Math.PI)
    game.ballVX = Math.cos(angle) * FOOSBALL_BALL_SPEED_PX_PER_SEC
    game.ballVY = Math.sin(angle) * FOOSBALL_BALL_SPEED_PX_PER_SEC
  }

  update(dt: number, state: OfficeState): void {
    this.idleCheckTimer += dt

    const toRemove: string[] = []

    for (const [uid, game] of this.games) {
      const ch1 = state.characters.get(game.players[0])
      const ch2 = state.characters.get(game.players[1])

      // If either character was removed, end the game
      if (!ch1 || !ch2) {
        if (ch1) { ch1.state = CharacterState.IDLE; ch1.wanderTimer = 1 }
        if (ch2) { ch2.state = CharacterState.IDLE; ch2.wanderTimer = 1 }
        toRemove.push(uid)
        continue
      }

      // If either player became active, end the game immediately
      if (ch1.isActive || ch2.isActive) {
        ch1.state = CharacterState.IDLE
        ch1.wanderTimer = 1
        ch1.frame = 0
        ch1.frameTimer = 0
        ch2.state = CharacterState.IDLE
        ch2.wanderTimer = 1
        ch2.frame = 0
        ch2.frameTimer = 0
        toRemove.push(uid)
        continue
      }

      switch (game.phase) {
        case 'walking': {
          // Check if both players have arrived
          let arrived = 0
          if (ch1.state === CharacterState.FOOSBALL) arrived++
          else if (ch1.state === CharacterState.WALK && ch1.path.length === 0) {
            ch1.state = CharacterState.FOOSBALL
            ch1.dir = Direction.DOWN
            ch1.frame = 0
            ch1.frameTimer = 0
            arrived++
          }
          if (ch2.state === CharacterState.FOOSBALL) arrived++
          else if (ch2.state === CharacterState.WALK && ch2.path.length === 0) {
            ch2.state = CharacterState.FOOSBALL
            ch2.dir = Direction.UP
            ch2.frame = 0
            ch2.frameTimer = 0
            arrived++
          }
          game.arrivedCount = arrived
          if (arrived >= 2) {
            game.phase = 'playing'
            this.resetBall(game)
          }
          break
        }

        case 'playing': {
          // Animate characters slightly
          ch1.frameTimer += dt
          ch2.frameTimer += dt
          if (ch1.frameTimer >= 0.5) { ch1.frameTimer -= 0.5; ch1.frame = (ch1.frame + 1) % 2 }
          if (ch2.frameTimer >= 0.5) { ch2.frameTimer -= 0.5; ch2.frame = (ch2.frame + 1) % 2 }

          // Ball physics
          game.ballX += game.ballVX * dt
          game.ballY += game.ballVY * dt

          // Table bounds (pixel coords)
          const margin = FOOSBALL_TABLE_INNER_MARGIN
          const leftBound = game.tableCol * TILE_SIZE + margin
          const rightBound = (game.tableCol + 2) * TILE_SIZE - margin
          const topBound = game.tableRow * TILE_SIZE + margin
          const bottomBound = (game.tableRow + 1) * TILE_SIZE - margin

          // Bounce off left/right walls
          if (game.ballX <= leftBound) {
            game.ballX = leftBound
            game.ballVX = Math.abs(game.ballVX)
          } else if (game.ballX >= rightBound) {
            game.ballX = rightBound
            game.ballVX = -Math.abs(game.ballVX)
          }

          // Goal detection: top/bottom edges — score and reset, game continues indefinitely
          if (game.ballY <= topBound) {
            game.scores[1]++
            this.resetBall(game)
          } else if (game.ballY >= bottomBound) {
            game.scores[0]++
            this.resetBall(game)
          }

          // Add slight randomness to ball direction periodically for more interesting play
          game.phaseTimer += dt
          if (game.phaseTimer > 2.0) {
            game.phaseTimer = 0
            const nudge = (Math.random() - 0.5) * FOOSBALL_BALL_SPEED_PX_PER_SEC * 0.3
            game.ballVX += nudge
            // Normalize speed
            const speed = Math.sqrt(game.ballVX * game.ballVX + game.ballVY * game.ballVY)
            if (speed > 0) {
              game.ballVX = (game.ballVX / speed) * FOOSBALL_BALL_SPEED_PX_PER_SEC
              game.ballVY = (game.ballVY / speed) * FOOSBALL_BALL_SPEED_PX_PER_SEC
            }
          }
          break
        }

        case 'ending': {
          // Ending phase is only reached when a player becomes active (handled above)
          toRemove.push(uid)
          break
        }
      }
    }

    for (const uid of toRemove) {
      this.games.delete(uid)
    }

    // Periodically try to start new games
    if (this.idleCheckTimer >= FOOSBALL_GAME_IDLE_CHECK_SEC) {
      this.idleCheckTimer = 0
      // Any inactive, non-subagent character is eligible — whether IDLE (wandering)
      // or TYPE (sitting at desk resting). We pull them out of either state.
      const availableChars = Array.from(state.characters.values()).filter(
        (ch) => !ch.isActive && !ch.isSubagent && !ch.matrixEffect
          && (ch.state === CharacterState.IDLE || ch.state === CharacterState.TYPE)
          && !this.isInGame(ch.id),
      )
      if (availableChars.length >= 2) {
        this.tryStartGame(availableChars, state)
      }
    }
  }

  /** Get the blocked-tile key for a character's seat, or null */
  private seatTileKey(ch: Character, state: OfficeState): string | null {
    if (!ch.seatId) return null
    const seat = state.seats.get(ch.seatId)
    if (!seat) return null
    return `${seat.seatCol},${seat.seatRow}`
  }

  /** Find the foosball table PlacedFurniture for a game (for rendering) */
  getTableForGame(game: FoosballGame, layout: PlacedFurniture[]): PlacedFurniture | undefined {
    return layout.find((f) => f.uid === game.tableUid)
  }
}
