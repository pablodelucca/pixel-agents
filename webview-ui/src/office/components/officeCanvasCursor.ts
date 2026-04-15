/**
 * Pure cursor-decision helper for OfficeCanvas (non-edit mode).
 *
 * Cascades: character hit → pointer, pet hit → pointer, clickable seat →
 * pointer, otherwise default. Extracted from `handleMouseMove` so the logic
 * can be unit-tested without rendering the full canvas component.
 */

export interface OfficeCursorTile {
  col: number;
  row: number;
}

export interface OfficeCursorSeat {
  assigned: unknown;
}

export interface OfficeCursorCharacter {
  seatId: string | null;
}

export interface OfficeCursorState {
  /** Result of `officeState.getCharacterAt(...)`. */
  hitId: number | null;
  /** Result of `officeState.getPetAt(...)`. `null` = no pet. */
  petId: string | null;
  /** Currently selected agent id (for seat hit logic), or null. */
  selectedAgentId: number | null;
  /** Tile under cursor, or null if outside grid. */
  tile: OfficeCursorTile | null;
  /** Seat lookup by tile, mirrors `officeState.getSeatAtTile`. */
  getSeatAtTile: (col: number, row: number) => string | null;
  /** Seat lookup by id, mirrors `officeState.seats.get(id)`. */
  getSeat: (seatId: string) => OfficeCursorSeat | undefined;
  /** Character lookup by id, mirrors `officeState.characters.get(id)`. */
  getCharacter: (id: number) => OfficeCursorCharacter | undefined;
}

/**
 * Compute the CSS cursor value for the canvas in normal (non-edit) mode.
 *
 * IMPORTANT: the pet check uses `petId !== null`, not truthy, so that an
 * empty string (unlikely but defensive) is still treated as a hit. `getPetAt`
 * returns `string | null` — `null` is the only "no pet" signal.
 */
export function computeNormalModeCursor(state: OfficeCursorState): 'pointer' | 'default' {
  if (state.hitId !== null) return 'pointer';
  if (state.petId !== null) return 'pointer';

  if (state.selectedAgentId !== null && state.tile) {
    const seatId = state.getSeatAtTile(state.tile.col, state.tile.row);
    if (seatId) {
      const seat = state.getSeat(seatId);
      if (seat) {
        const selectedCh = state.getCharacter(state.selectedAgentId);
        if (!seat.assigned || (selectedCh && selectedCh.seatId === seatId)) {
          return 'pointer';
        }
      }
    }
  }

  return 'default';
}
