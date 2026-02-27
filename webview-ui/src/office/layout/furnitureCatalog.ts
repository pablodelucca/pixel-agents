import { FurnitureType } from '../types.js'
import type { FurnitureCatalogEntry, SpriteData } from '../types.js'
import {
  DESK_SQUARE_SPRITE,
  BOOKSHELF_SPRITE,
  PLANT_SPRITE,
  COOLER_SPRITE,
  WHITEBOARD_SPRITE,
  CHAIR_SPRITE,
  PC_SPRITE,
  LAMP_SPRITE,
  FOOSBALL_TABLE_SPRITE,
} from '../sprites/spriteData.js'

export interface LoadedAssetData {
  catalog: Array<{
    id: string
    label: string
    category: string
    width: number
    height: number
    footprintW: number
    footprintH: number
    isDesk: boolean
    groupId?: string
    orientation?: string  // 'front' | 'back' | 'left' | 'right'
    state?: string        // 'on' | 'off'
    canPlaceOnSurfaces?: boolean
    backgroundTiles?: number
    canPlaceOnWalls?: boolean
  }>
  sprites: Record<string, SpriteData>
}

export type FurnitureCategory = 'desks' | 'chairs' | 'storage' | 'decor' | 'electronics' | 'wall' | 'misc'

export interface CatalogEntryWithCategory extends FurnitureCatalogEntry {
  category: FurnitureCategory
}

export const FURNITURE_CATALOG: CatalogEntryWithCategory[] = [
  // ── Original hand-drawn sprites ──
  { type: FurnitureType.DESK,       label: 'Desk',       footprintW: 2, footprintH: 2, sprite: DESK_SQUARE_SPRITE,  isDesk: true,  category: 'desks' },
  { type: FurnitureType.BOOKSHELF,  label: 'Bookshelf',  footprintW: 1, footprintH: 2, sprite: BOOKSHELF_SPRITE,    isDesk: false, category: 'storage' },
  { type: FurnitureType.PLANT,      label: 'Plant',      footprintW: 1, footprintH: 1, sprite: PLANT_SPRITE,        isDesk: false, category: 'decor' },
  { type: FurnitureType.COOLER,     label: 'Cooler',     footprintW: 1, footprintH: 1, sprite: COOLER_SPRITE,       isDesk: false, category: 'misc' },
  { type: FurnitureType.WHITEBOARD, label: 'Whiteboard', footprintW: 2, footprintH: 1, sprite: WHITEBOARD_SPRITE,   isDesk: false, category: 'decor' },
  { type: FurnitureType.CHAIR,      label: 'Chair',      footprintW: 1, footprintH: 1, sprite: CHAIR_SPRITE,        isDesk: false, category: 'chairs' },
  { type: FurnitureType.PC,         label: 'PC',         footprintW: 1, footprintH: 1, sprite: PC_SPRITE,           isDesk: false, category: 'electronics' },
  { type: FurnitureType.LAMP,       label: 'Lamp',       footprintW: 1, footprintH: 1, sprite: LAMP_SPRITE,         isDesk: false, category: 'decor' },
  { type: FurnitureType.FOOSBALL,   label: 'Foosball',   footprintW: 2, footprintH: 1, sprite: FOOSBALL_TABLE_SPRITE, isDesk: false, category: 'decor' },

]

// ── Rotation groups ──────────────────────────────────────────────
// Flexible rotation: supports 2+ orientations (not just all 4)
interface RotationGroup {
  /** Ordered list of orientations available for this group */
  orientations: string[]
  /** Maps orientation → asset ID (for the default/off state) */
  members: Record<string, string>
}

// Maps any member asset ID → its rotation group
const rotationGroups = new Map<string, RotationGroup>()

// ── State groups ────────────────────────────────────────────────
// Maps asset ID → its on/off counterpart (symmetric for toggle)
const stateGroups = new Map<string, string>()
// Directional maps for getOnStateType / getOffStateType
const offToOn = new Map<string, string>()  // off asset → on asset
const onToOff = new Map<string, string>()  // on asset → off asset

// Internal catalog (includes all variants for getCatalogEntry lookups)
let internalCatalog: CatalogEntryWithCategory[] | null = null

// Dynamic catalog built from loaded assets (when available)
// Only includes "front" variants for grouped items (shown in editor palette)
let dynamicCatalog: CatalogEntryWithCategory[] | null = null
let dynamicCategories: FurnitureCategory[] | null = null

/**
 * Build catalog from loaded assets. Returns true if successful.
 * Once built, all getCatalog* functions use the dynamic catalog.
 * Uses ONLY custom assets (excludes hardcoded furniture when assets are loaded).
 */
export function buildDynamicCatalog(assets: LoadedAssetData): boolean {
  if (!assets?.catalog || !assets?.sprites) return false

  // Build all entries (including non-front variants)
  const allEntries = assets.catalog.map((asset) => {
    const sprite = assets.sprites[asset.id]
    if (!sprite) {
      console.warn(`No sprite data for asset ${asset.id}`)
      return null
    }
    return {
      type: asset.id,
      label: asset.label,
      footprintW: asset.footprintW,
      footprintH: asset.footprintH,
      sprite,
      isDesk: asset.isDesk,
      category: asset.category as FurnitureCategory,
      ...(asset.orientation ? { orientation: asset.orientation } : {}),
      ...(asset.canPlaceOnSurfaces ? { canPlaceOnSurfaces: true } : {}),
      ...(asset.backgroundTiles ? { backgroundTiles: asset.backgroundTiles } : {}),
      ...(asset.canPlaceOnWalls ? { canPlaceOnWalls: true } : {}),
    }
  }).filter((e): e is CatalogEntryWithCategory => e !== null)

  if (allEntries.length === 0) return false

  // Build rotation groups from groupId + orientation metadata
  rotationGroups.clear()
  stateGroups.clear()
  offToOn.clear()
  onToOff.clear()

  // Phase 1: Collect orientations per group (only "off" or stateless variants for rotation)
  const groupMap = new Map<string, Map<string, string>>() // groupId → (orientation → assetId)
  for (const asset of assets.catalog) {
    if (asset.groupId && asset.orientation) {
      // For rotation groups, only use the "off" or stateless variant
      if (asset.state && asset.state !== 'off') continue
      let orientMap = groupMap.get(asset.groupId)
      if (!orientMap) {
        orientMap = new Map()
        groupMap.set(asset.groupId, orientMap)
      }
      orientMap.set(asset.orientation, asset.id)
    }
  }

  // Phase 2: Register rotation groups with 2+ orientations
  const nonFrontIds = new Set<string>()
  const orientationOrder = ['front', 'right', 'back', 'left']
  for (const orientMap of groupMap.values()) {
    if (orientMap.size < 2) continue
    // Build ordered list of available orientations
    const orderedOrients = orientationOrder.filter((o) => orientMap.has(o))
    if (orderedOrients.length < 2) continue
    const members: Record<string, string> = {}
    for (const o of orderedOrients) {
      members[o] = orientMap.get(o)!
    }
    const rg: RotationGroup = { orientations: orderedOrients, members }
    for (const id of Object.values(members)) {
      rotationGroups.set(id, rg)
    }
    // Track non-front IDs to exclude from visible catalog
    for (const [orient, id] of Object.entries(members)) {
      if (orient !== 'front') nonFrontIds.add(id)
    }
  }

  // Phase 3: Build state groups (on ↔ off pairs within same groupId + orientation)
  const stateMap = new Map<string, Map<string, string>>() // "groupId|orientation" → (state → assetId)
  for (const asset of assets.catalog) {
    if (asset.groupId && asset.state) {
      const key = `${asset.groupId}|${asset.orientation || ''}`
      let sm = stateMap.get(key)
      if (!sm) {
        sm = new Map()
        stateMap.set(key, sm)
      }
      sm.set(asset.state, asset.id)
    }
  }
  for (const sm of stateMap.values()) {
    const onId = sm.get('on')
    const offId = sm.get('off')
    if (onId && offId) {
      stateGroups.set(onId, offId)
      stateGroups.set(offId, onId)
      offToOn.set(offId, onId)
      onToOff.set(onId, offId)
    }
  }

  // Also register rotation groups for "on" state variants (so rotation works on on-state items too)
  for (const asset of assets.catalog) {
    if (asset.groupId && asset.orientation && asset.state === 'on') {
      // Find the off-variant's rotation group
      const offCounterpart = stateGroups.get(asset.id)
      if (offCounterpart) {
        const offGroup = rotationGroups.get(offCounterpart)
        if (offGroup) {
          // Build an equivalent group for the "on" state
          const onMembers: Record<string, string> = {}
          for (const orient of offGroup.orientations) {
            const offId = offGroup.members[orient]
            const onId = stateGroups.get(offId)
            // Use on-state variant if available, otherwise fall back to off-state
            onMembers[orient] = onId ?? offId
          }
          const onGroup: RotationGroup = { orientations: offGroup.orientations, members: onMembers }
          for (const id of Object.values(onMembers)) {
            if (!rotationGroups.has(id)) {
              rotationGroups.set(id, onGroup)
            }
          }
        }
      }
    }
  }

  // Track "on" variant IDs to exclude from visible catalog
  const onStateIds = new Set<string>()
  for (const asset of assets.catalog) {
    if (asset.state === 'on') onStateIds.add(asset.id)
  }

  // Store full internal catalog (all variants — for getCatalogEntry lookups)
  internalCatalog = allEntries

  // Visible catalog: exclude non-front variants and "on" state variants
  const visibleEntries = allEntries.filter((e) => !nonFrontIds.has(e.type) && !onStateIds.has(e.type))

  // Strip orientation/state suffix from labels for grouped variants
  for (const entry of visibleEntries) {
    if (rotationGroups.has(entry.type) || stateGroups.has(entry.type)) {
      entry.label = entry.label
        .replace(/ - Front - Off$/, '')
        .replace(/ - Front$/, '')
        .replace(/ - Off$/, '')
    }
  }

  dynamicCatalog = visibleEntries
  dynamicCategories = Array.from(new Set(visibleEntries.map((e) => e.category)))
    .filter((c): c is FurnitureCategory => !!c)
    .sort()

  const rotGroupCount = new Set(Array.from(rotationGroups.values())).size
  console.log(`✓ Built dynamic catalog with ${allEntries.length} assets (${visibleEntries.length} visible, ${rotGroupCount} rotation groups, ${stateGroups.size / 2} state pairs)`)
  return true
}

export function getCatalogEntry(type: string): CatalogEntryWithCategory | undefined {
  // Check internal catalog first (includes all variants, e.g., non-front rotations)
  if (internalCatalog) {
    return internalCatalog.find((e) => e.type === type)
  }
  const catalog = dynamicCatalog || FURNITURE_CATALOG
  return catalog.find((e) => e.type === type)
}

export function getCatalogByCategory(category: FurnitureCategory): CatalogEntryWithCategory[] {
  const catalog = dynamicCatalog || FURNITURE_CATALOG
  return catalog.filter((e) => e.category === category)
}

export function getActiveCatalog(): CatalogEntryWithCategory[] {
  return dynamicCatalog || FURNITURE_CATALOG
}

export function getActiveCategories(): Array<{ id: FurnitureCategory; label: string }> {
  const categories = dynamicCategories || (FURNITURE_CATEGORIES.map((c) => c.id) as FurnitureCategory[])
  return FURNITURE_CATEGORIES.filter((c) => categories.includes(c.id))
}

export const FURNITURE_CATEGORIES: Array<{ id: FurnitureCategory; label: string }> = [
  { id: 'desks', label: 'Desks' },
  { id: 'chairs', label: 'Chairs' },
  { id: 'storage', label: 'Storage' },
  { id: 'electronics', label: 'Tech' },
  { id: 'decor', label: 'Decor' },
  { id: 'wall', label: 'Wall' },
  { id: 'misc', label: 'Misc' },
]

// ── Rotation helpers ─────────────────────────────────────────────

/** Returns the next asset ID in the rotation group (cw or ccw), or null if not rotatable. */
export function getRotatedType(currentType: string, direction: 'cw' | 'ccw'): string | null {
  const group = rotationGroups.get(currentType)
  if (!group) return null
  const order = group.orientations.map((o) => group.members[o])
  const idx = order.indexOf(currentType)
  if (idx === -1) return null
  const step = direction === 'cw' ? 1 : -1
  const nextIdx = (idx + step + order.length) % order.length
  return order[nextIdx]
}

/** Returns the toggled state variant (on↔off), or null if no state variant exists. */
export function getToggledType(currentType: string): string | null {
  return stateGroups.get(currentType) ?? null
}

/** Returns the "on" variant if this type has one, otherwise returns the type unchanged. */
export function getOnStateType(currentType: string): string {
  return offToOn.get(currentType) ?? currentType
}

/** Returns the "off" variant if this type has one, otherwise returns the type unchanged. */
export function getOffStateType(currentType: string): string {
  return onToOff.get(currentType) ?? currentType
}

/** Returns true if the given furniture type is part of a rotation group. */
export function isRotatable(type: string): boolean {
  return rotationGroups.has(type)
}
