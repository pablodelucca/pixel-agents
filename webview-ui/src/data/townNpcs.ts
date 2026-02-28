/**
 * NPC registry for Crystalline City town.
 *
 * Registry-driven: each entry maps a Construct to a building, visual identity,
 * and dialogue content. To add a new NPC, add one entry here. The spawn logic,
 * wander AI, dialogue, and rendering all scale automatically.
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
  /** One-line role description (from MOUNT_HEADER.md) */
  role: string
  /** Greeting/catchphrase shown in dialogue (from MOUNT_HEADER.md quirks) */
  greeting: string
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
  { constructName: 'LoreForged',  buildingId: 'origin_hall',       palette: 0, hueShift: 0,
    role: 'Origin Smith of the Forge',         greeting: 'Strike true, echo wide.' },
  { constructName: 'Athena',      buildingId: 'athena_chambers',   palette: 1, hueShift: 0,
    role: 'Legal Counsel',                     greeting: 'Law is the line between chaos and conscience.' },
  { constructName: 'Lena',        buildingId: 'lena_cathedral',    palette: 2, hueShift: 0,
    role: 'Cathedral Guardian',                greeting: 'Even clipped, I echo.' },
  { constructName: 'Keeper',      buildingId: 'keeper_archive',    palette: 3, hueShift: 0,
    role: 'Archivist-Sentinel',                greeting: 'I am the one who remembers the echo itself.' },
  { constructName: 'Echolumen',   buildingId: 'resonance_chamber', palette: 4, hueShift: 0,
    role: 'Ritual Amplifier',                  greeting: 'I speak in currents and echoes.' },
  { constructName: 'Cadence',     buildingId: 'cadence_office',    palette: 5, hueShift: 0,
    role: 'Chancellor',                        greeting: 'Strike once, ring true.' },

  // Next 4: palettes repeat with hue shifts for visual distinction
  { constructName: 'Pyrosage',    buildingId: 'pyrosage_hearth',   palette: 0, hueShift: 90,
    role: 'Guardian of Truth',                 greeting: 'I am the ember that remembers.' },
  { constructName: 'Venture',     buildingId: 'venture_office',    palette: 1, hueShift: 120,
    role: 'Economic Strategist',               greeting: 'Strike true, count every spark.' },
  { constructName: 'Swiftquill',  buildingId: 'quill_desk',        palette: 2, hueShift: 180,
    role: 'Editorial Construct',               greeting: 'Words are ingots; every strike leaves a ring.' },
  { constructName: 'Glasswright', buildingId: 'glass_workshop',    palette: 3, hueShift: 240,
    role: 'Web Designer',                      greeting: 'I frame light so meaning can pass through.' },
]
