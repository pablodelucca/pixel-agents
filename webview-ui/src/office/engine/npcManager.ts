/**
 * NPC Manager — manages non-player characters tied to furniture.
 * Currently: Vela at the RADAR desk.
 */

import {
  NPC_VELA_ID,
  RADAR_STAMP_DOWN_SEC,
  RADAR_STAMP_HOLD_SEC,
  RADAR_STAMP_UP_SEC,
} from '../../constants.js';
import type { Character, PlacedFurniture, Seat } from '../types.js';
import { CharacterState, Direction, TILE_SIZE } from '../types.js';
import { createCharacter } from './characters.js';

/** Vela's display name and role — shown on hover and in overlays */
export const VELA_NAME = 'Vela';
export const VELA_ROLE = 'Risk Architect';

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

/** Find the nearest seat adjacent to any RADAR desk. Used as the visitor seat.
 *  Returns null if no radar desk or no adjacent seats — callers should log
 *  a warning pointing users to place a chair next to the desk. */
export function findVisitorSeat(
  furniture: PlacedFurniture[],
  seats: Map<string, Seat>,
): Seat | null {
  const desk = findRadarDesk(furniture);
  if (!desk) return null;

  let best: Seat | null = null;
  let bestDist = Infinity;
  for (const seat of seats.values()) {
    // Manhattan distance to nearest desk tile
    let minDist = Infinity;
    for (let dr = 0; dr < RADAR_DESK_FOOTPRINT.h; dr++) {
      for (let dc = 0; dc < RADAR_DESK_FOOTPRINT.w; dc++) {
        const dist =
          Math.abs(seat.seatCol - (desk.col + dc)) + Math.abs(seat.seatRow - (desk.row + dr));
        if (dist < minDist) minDist = dist;
      }
    }
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

  /** Sync NPC state with current layout furniture. Call after rebuildFromLayout.
   *  Vela sits at the back row of the desk (in the backgroundTiles area) without
   *  needing a chair. Users only need to place one chair adjacent to the desk
   *  as the visitor seat. */
  syncWithLayout(furniture: PlacedFurniture[]): void {
    const desk = findRadarDesk(furniture);

    if (!desk) {
      if (this.vela) {
        console.log('[Pixel Agents] radar_desk removed — Vela despawned');
      }
      this.vela = null;
      this.radarDesk = null;
      return;
    }

    this.radarDesk = desk;

    // Vela stands behind the desk. Her pixel y is positioned so she renders
    // BEHIND the desk's solid front face (charZY < deskZY), with her head and
    // shoulders visible above the back lip — like a receptionist behind a counter.
    //
    // For a 2x2 desk at (col, row), desk zY = (row+2)*TILE_SIZE.
    // Character zY = pixelY + TILE_SIZE/2 + 0.5.
    // We need charZY < deskZY, so pixelY < row*TILE_SIZE + TILE_SIZE*1.5 - 0.5.
    // Setting pixelY = row*TILE_SIZE + 23 puts her at the very top of row+1,
    // rendering her just behind the desk with her lower body hidden.
    const velaCol = desk.col;
    const velaRow = desk.row;
    const velaPixelX = desk.col * TILE_SIZE + TILE_SIZE; // center of 2-wide desk
    const velaPixelY = desk.row * TILE_SIZE + 23; // render behind desk front face

    if (!this.vela) {
      this.vela = createCharacter(NPC_VELA_ID, -1, null, null, 0);
      this.vela.isNpc = true;
      this.vela.isActive = false;
      this.vela.state = CharacterState.IDLE; // Standing behind desk (no chair)
      this.vela.npcStampPhase = 'idle';
      this.vela.npcStampTimer = 0;
      console.log('[Pixel Agents] Vela spawned at radar_desk');
    }

    this.vela.state = CharacterState.IDLE;
    this.vela.tileCol = velaCol;
    this.vela.tileRow = velaRow;
    this.vela.x = velaPixelX;
    this.vela.y = velaPixelY;
    this.vela.dir = Direction.DOWN;
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

  /** Update assessment tier mid-stamp (tier arrives with verdict, not start).
   *  Only affects stamp_up duration — if already past stamp_up, no visual change. */
  setTier(tier: number): void {
    this.isT2 = tier === 2;
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

    // State mapping: idle = standing (IDLE state), stamping = typing (TYPE state)
    switch (v.npcStampPhase) {
      case 'idle': {
        v.state = CharacterState.IDLE;
        // No idle animation — standing pose (walk frame 1)
        v.frameTimer = 0;
        break;
      }
      case 'stamp_up': {
        v.state = CharacterState.TYPE;
        v.npcStampTimer = (v.npcStampTimer ?? 0) + dt;
        v.frame = 0; // stamp_up frame (maps to typing frame 0)
        const holdDuration = this.isT2 ? RADAR_STAMP_UP_T2_SEC : RADAR_STAMP_UP_SEC;
        if (v.npcStampTimer >= holdDuration) {
          v.npcStampPhase = 'stamp_down';
          v.npcStampTimer = 0;
          v.frame = 1;
        }
        break;
      }
      case 'stamp_down': {
        v.state = CharacterState.TYPE;
        v.npcStampTimer = (v.npcStampTimer ?? 0) + dt;
        v.frame = 1;
        if (v.npcStampTimer >= RADAR_STAMP_DOWN_SEC) {
          v.npcStampPhase = 'stamp_hold';
          v.npcStampTimer = 0;
        }
        break;
      }
      case 'stamp_hold': {
        v.state = CharacterState.TYPE;
        v.npcStampTimer = (v.npcStampTimer ?? 0) + dt;
        v.frame = 1;
        if (v.npcStampTimer >= RADAR_STAMP_HOLD_SEC) {
          v.npcStampPhase = 'idle';
          v.state = CharacterState.IDLE;
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
