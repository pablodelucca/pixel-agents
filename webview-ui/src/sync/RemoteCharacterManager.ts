import type { Character, Direction } from '../office/types.js'
import type { OfficeState } from '../office/engine/officeState.js'
import type { PresenceClient, AgentSnapshot } from './types.js'
import { CharacterState } from '../office/types.js'
import { TILE_SIZE, WALK_SPEED_PX_PER_SEC } from '../constants.js'
import { createCharacter } from '../office/engine/characters.js'
import { matrixEffectSeeds } from '../office/engine/matrixEffect.js'

const TELEPORT_DISTANCE = TILE_SIZE * 2

export class RemoteCharacterManager {
  private remoteMap = new Map<string, number>()
  private despawning = new Set<number>()
  private nextId = -10000
  private os: OfficeState

  constructor(os: OfficeState) {
    this.os = os
  }

  updatePresence(clients: PresenceClient[]): void {
    const expectedKeys = new Set<string>()
    for (const client of clients) {
      for (const agent of client.agents) {
        expectedKeys.add(`${client.clientId}:${agent.id}`)
      }
    }

    // Despawn characters no longer in presence
    for (const [key, charId] of this.remoteMap) {
      if (!expectedKeys.has(key)) {
        this.startDespawn(charId)
        this.remoteMap.delete(key)
      }
    }

    // Create or update
    for (const client of clients) {
      for (const agent of client.agents) {
        const key = `${client.clientId}:${agent.id}`
        const existingId = this.remoteMap.get(key)

        if (existingId !== undefined) {
          if (this.despawning.has(existingId)) continue
          const ch = this.os.characters.get(existingId)
          if (!ch) continue
          this.applyUpdate(ch, agent, client.userName)
        } else {
          const ch = this.createRemote(agent, client.userName)
          this.remoteMap.set(key, ch.id)
        }
      }
    }
  }

  interpolate(dt: number): void {
    for (const charId of this.remoteMap.values()) {
      if (this.despawning.has(charId)) continue
      const ch = this.os.characters.get(charId)
      if (!ch || !ch.isRemote) continue
      if (ch.remoteTargetX === undefined || ch.remoteTargetY === undefined) continue

      const dx = ch.remoteTargetX - ch.x
      const dy = ch.remoteTargetY - ch.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist > TELEPORT_DISTANCE) {
        ch.x = ch.remoteTargetX
        ch.y = ch.remoteTargetY
      } else if (dist > 1) {
        const speed = WALK_SPEED_PX_PER_SEC * dt
        const step = Math.min(speed, dist)
        ch.x += (dx / dist) * step
        ch.y += (dy / dist) * step
      } else {
        ch.x = ch.remoteTargetX
        ch.y = ch.remoteTargetY
      }

      ch.tileCol = Math.round((ch.x - TILE_SIZE / 2) / TILE_SIZE)
      ch.tileRow = Math.round((ch.y - TILE_SIZE / 2) / TILE_SIZE)

      if (ch.remoteTargetDir !== undefined) {
        ch.dir = ch.remoteTargetDir
      }
    }
  }

  completeDespawn(charId: number): void {
    this.despawning.delete(charId)
  }

  dispose(): void {
    for (const charId of this.remoteMap.values()) {
      this.startDespawn(charId)
    }
    this.remoteMap.clear()
  }

  private createRemote(agent: AgentSnapshot, userName: string): Character {
    const id = this.nextId--
    const ch = createCharacter(id, agent.appearance.palette, null, null, agent.appearance.hueShift)
    ch.isRemote = true
    ch.userName = userName
    ch.isActive = false
    ch.state = CharacterState.IDLE
    ch.x = agent.x
    ch.y = agent.y
    ch.tileCol = Math.round((agent.x - TILE_SIZE / 2) / TILE_SIZE)
    ch.tileRow = Math.round((agent.y - TILE_SIZE / 2) / TILE_SIZE)
    ch.dir = agent.dir as Direction
    ch.remoteTargetX = agent.x
    ch.remoteTargetY = agent.y
    ch.remoteTargetDir = agent.dir as Direction
    ch.matrixEffect = 'spawn'
    ch.matrixEffectTimer = 0
    ch.matrixEffectSeeds = matrixEffectSeeds()
    this.os.characters.set(id, ch)
    return ch
  }

  private applyUpdate(ch: Character, agent: AgentSnapshot, userName: string): void {
    ch.userName = userName
    ch.currentTool = agent.activeTool || null
    ch.remoteTargetX = agent.x
    ch.remoteTargetY = agent.y
    ch.remoteTargetDir = agent.dir as Direction
    ch.state = agent.state as Character['state']
    ch.frame = agent.frame

    if (agent.status === 'permission') {
      ch.bubbleType = 'permission'
    } else if (agent.status === 'waiting') {
      if (ch.bubbleType !== 'waiting') {
        ch.bubbleType = 'waiting'
        ch.bubbleTimer = 2
      }
    } else if (ch.bubbleType === 'permission' || ch.bubbleType === 'waiting') {
      ch.bubbleType = null
    }
  }

  private startDespawn(charId: number): void {
    if (this.despawning.has(charId)) return
    const ch = this.os.characters.get(charId)
    if (!ch) return
    if (ch.matrixEffect === 'despawn') return
    ch.matrixEffect = 'despawn'
    ch.matrixEffectTimer = 0
    ch.matrixEffectSeeds = matrixEffectSeeds()
    this.despawning.add(charId)
  }
}
