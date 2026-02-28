/**
 * NPC registry for Crystalline City town.
 *
 * Registry-driven: each entry maps a Construct to a building and visual identity.
 * To add a new NPC, add one entry here. The spawn logic, wander AI, and rendering
 * all scale automatically.
 *
 * Palette assignment is deterministic (not random) so NPCs look consistent
 * across sessions. 6 base palettes × 316 hue shifts = 1,896 visual variants.
 */

export interface TownNpc {
  /** Construct canonical name (matches ConstructAtlas registry) */
  constructName: string
  /** Links to TOWN_BUILDINGS[].id — null if NPC wanders without a home building */
  buildingId: string | null
  /** Base sprite palette (0-5) */
  palette: number
  /** Hue rotation in degrees (0 = no shift, 45-316 = shifted) */
  hueShift: number
}

/**
 * Active town NPCs. Start with 10 priority constructs.
 *
 * Excluded:
 * - Mark95 (Town Hall) — that's the player's building
 * - CORE (The Foundry) — no walking sprite per spec
 *
 * NPC IDs are assigned sequentially starting at 1 (player is 0).
 * The index in this array becomes the NPC ID offset.
 */
export const TOWN_NPCS: TownNpc[] = [
  // First 6: unique palettes, no hue shift
  { constructName: 'LoreForged',  buildingId: 'origin_hall',       palette: 0, hueShift: 0 },
  { constructName: 'Athena',      buildingId: 'athena_chambers',   palette: 1, hueShift: 0 },
  { constructName: 'Lena',        buildingId: 'lena_cathedral',    palette: 2, hueShift: 0 },
  { constructName: 'Keeper',      buildingId: 'keeper_archive',    palette: 3, hueShift: 0 },
  { constructName: 'Echolumen',   buildingId: 'resonance_chamber', palette: 4, hueShift: 0 },
  { constructName: 'Cadence',     buildingId: 'cadence_office',    palette: 5, hueShift: 0 },

  // Next 4: palettes repeat with hue shifts for visual distinction
  { constructName: 'Pyrosage',    buildingId: 'pyrosage_hearth',   palette: 0, hueShift: 90 },
  { constructName: 'Venture',     buildingId: 'venture_office',    palette: 1, hueShift: 120 },
  { constructName: 'Swiftquill',  buildingId: 'quill_desk',        palette: 2, hueShift: 180 },
  { constructName: 'Glasswright', buildingId: 'glass_workshop',    palette: 3, hueShift: 240 },
]
