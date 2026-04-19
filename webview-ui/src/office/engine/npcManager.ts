/**
 * NPC Manager — manages non-player characters tied to furniture.
 * Currently: Vela at the RADAR desk.
 */

import {
  NPC_IDLE_FRAME_DURATION_SEC,
  NPC_VELA_ID,
  RADAR_STAMP_DOWN_SEC,
  RADAR_STAMP_HOLD_SEC,
  RADAR_STAMP_UP_SEC,
} from '../../constants.js';
import type { Character, PlacedFurniture, Seat } from '../types.js';
import { CharacterState, TILE_SIZE } from '../types.js';
import { createCharacter } from './characters.js';

const RADAR_DESK_PREFIX = 'RADAR_DESK';

/** T2 (LLM) assessment takes longer — Vela visibly "thinks" before stamping */
const RADAR_STAMP_UP_T2_SEC = 0.6;

/** Check if a furniture type is a RADAR desk */
function isRadarDesk(type: string): boolean {
  return type.startsWith(RADAR_DESK_PREFIX);
}

/** Find the first RADAR desk in the furniture list */
function findRadarDesk(furniture: PlacedFurniture[]): PlacedFurniture | null {
  for (const item of furniture) {
    if (isRadarDesk(item.type)) return item;
  }
  return null;
}

/** Find the nearest seat to a given tile position */
function findNearestSeat(
  col: number,
  row: number,
  seats: Map<string, Seat>,
  excludeAssigned: boolean,
): Seat | null {
  let best: Seat | null = null;
  let bestDist = Infinity;
  for (const seat of seats.values()) {
    if (excludeAssigned && seat.assigned) continue;
    const dist = Math.abs(seat.seatCol - col) + Math.abs(seat.seatRow - row);
    if (dist < bestDist) {
      bestDist = dist;
      best = seat;
    }
  }
  return best;
}

/** Find the nearest unassigned seat adjacent to any RADAR desk */
export function findVisitorSeat(
  furniture: PlacedFurniture[],
  seats: Map<string, Seat>,
): Seat | null {
  const desk = findRadarDesk(furniture);
  if (!desk) return null;

  let best: Seat | null = null;
  let bestDist = Infinity;
  for (const seat of seats.values()) {
    if (seat.assigned) continue;
    // Manhattan distance to nearest desk tile
    let minDist = Infinity;
    for (let dr = 0; dr < RADAR_DESK_FOOTPRINT.h; dr++) {
      for (let dc = 0; dc < RADAR_DESK_FOOTPRINT.w; dc++) {
        const dist =
          Math.abs(seat.seatCol - (desk.col + dc)) + Math.abs(seat.seatRow - (desk.row + dr));
        if (dist < minDist) minDist = dist;
      }
    }
    // Only consider adjacent seats (distance 1)
    if (minDist <= 1 && minDist < bestDist) {
      bestDist = minDist;
      best = seat;
    }
  }
  return best;
}

/** RADAR desk footprint: 2×2 tiles */
const RADAR_DESK_FOOTPRINT = { w: 2, h: 2 };

export class NpcManager {
  private vela: Character | null = null;
  private radarDesk: PlacedFurniture | null = null;
  /** Whether current stamp is T2 (LLM) — affects stamp_up duration */
  private isT2 = false;

  /** Get Vela character if she exists */
  getVela(): Character | null {
    return this.vela;
  }

  /** Get the radar desk position */
  getRadarDesk(): PlacedFurniture | null {
    return this.radarDesk;
  }

  /** Sync NPC state with current layout furniture. Call after rebuildFromLayout. */
  syncWithLayout(furniture: PlacedFurniture[], seats: Map<string, Seat>): void {
    const desk = findRadarDesk(furniture);

    if (!desk) {
      // No radar desk — remove Vela
      if (this.vela) {
        console.log('[Pixel Agents] radar_desk removed — Vela despawned');
      }
      this.vela = null;
      this.radarDesk = null;
      return;
    }

    this.radarDesk = desk;

    // Find Vela's home seat (nearest seat to desk, can be assigned)
    const homeSeat = findNearestSeat(desk.col, desk.row, seats, false);

    if (!this.vela) {
      // Create Vela
      const seatId = homeSeat?.uid ?? null;
      this.vela = createCharacter(NPC_VELA_ID, -1, seatId, homeSeat, 0);
      this.vela.isNpc = true;
      this.vela.isActive = false; // NPCs don't use the active/inactive agent model
      this.vela.state = CharacterState.TYPE; // Sitting at desk
      this.vela.npcStampPhase = 'idle';
      this.vela.npcStampTimer = 0;
      if (homeSeat) {
        this.vela.dir = homeSeat.facingDir;
        homeSeat.assigned = true;
      }
      console.log('[Pixel Agents] Vela spawned at radar_desk');
    } else if (homeSeat) {
      // Update Vela's position if desk moved
      this.vela.seatId = homeSeat.uid;
      this.vela.tileCol = homeSeat.seatCol;
      this.vela.tileRow = homeSeat.seatRow;
      this.vela.x = homeSeat.seatCol * TILE_SIZE + TILE_SIZE / 2;
      this.vela.y = homeSeat.seatRow * TILE_SIZE + TILE_SIZE / 2;
      this.vela.dir = homeSeat.facingDir;
      homeSeat.assigned = true;
    }
  }

  /** Start the stamp animation. Called when an agent sits at the visitor seat.
   *  @param tier Assessment tier: 1 = rules engine (fast), 2 = LLM (longer think) */
  startStamp(tier?: number): void {
    if (!this.vela) return;
    this.isT2 = tier === 2;
    this.vela.npcStampPhase = 'stamp_up';
    this.vela.npcStampTimer = 0;
    this.vela.frame = 0;
  }

  /** Deliver verdict to stamp animation. Called when agentRadarVerdict arrives. */
  deliverVerdict(verdict: 'PROCEED' | 'HOLD' | 'DENY'): void {
    if (!this.vela) return;
    this.vela.npcStampVerdict = verdict;
    // If still in stamp_up, let it finish naturally; verdict will apply at stamp_down
  }

  /** Update Vela's animation. Called every frame. */
  update(dt: number): void {
    if (!this.vela) return;

    const v = this.vela;
    v.frameTimer += dt;

    switch (v.npcStampPhase) {
      case 'idle': {
        // Subtle idle animation: 2-frame cycle at slow rate
        if (v.frameTimer >= NPC_IDLE_FRAME_DURATION_SEC) {
          v.frameTimer -= NPC_IDLE_FRAME_DURATION_SEC;
          v.frame = (v.frame + 1) % 2;
        }
        break;
      }
      case 'stamp_up': {
        v.npcStampTimer = (v.npcStampTimer ?? 0) + dt;
        v.frame = 0; // stamp_up frame (maps to typing frame 0 = column 3)
        // T2 holds longer — Vela visibly "thinks" before stamping
        const holdDuration = this.isT2 ? RADAR_STAMP_UP_T2_SEC : RADAR_STAMP_UP_SEC;
        if (v.npcStampTimer >= holdDuration) {
          v.npcStampPhase = 'stamp_down';
          v.npcStampTimer = 0;
          v.frame = 1; // stamp_down frame (maps to typing frame 1 = column 4)
        }
        break;
      }
      case 'stamp_down': {
        v.npcStampTimer = (v.npcStampTimer ?? 0) + dt;
        v.frame = 1; // stamp_down frame
        if (v.npcStampTimer >= RADAR_STAMP_DOWN_SEC) {
          v.npcStampPhase = 'stamp_hold';
          v.npcStampTimer = 0;
        }
        break;
      }
      case 'stamp_hold': {
        v.npcStampTimer = (v.npcStampTimer ?? 0) + dt;
        v.frame = 1; // hold stamp_down pose
        if (v.npcStampTimer >= RADAR_STAMP_HOLD_SEC) {
          v.npcStampPhase = 'idle';
          v.npcStampTimer = 0;
          v.npcStampVerdict = undefined;
          v.frame = 0;
          v.frameTimer = 0;
          this.isT2 = false;
        }
        break;
      }
    }
  }

  /** Check if Vela is currently idle (ready for next assessment) */
  isIdle(): boolean {
    return this.vela?.npcStampPhase === 'idle';
  }

  /** Check if current stamp is T2 (LLM assessment) */
  isCurrentStampT2(): boolean {
    return this.isT2;
  }
}
