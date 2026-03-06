import type { AvatarAppearance } from './types.js'

const PALETTE_COUNT = 6
const HUE_SHIFT_MIN_DEG = 45
const HUE_SHIFT_RANGE_DEG = 270

export class AvatarIdentity {
  static fromUserName(userName: string): AvatarAppearance {
    let hash = 0
    for (let i = 0; i < userName.length; i++) {
      hash = ((hash << 5) - hash + userName.charCodeAt(i)) | 0
    }
    const palette = ((hash % PALETTE_COUNT) + PALETTE_COUNT) % PALETTE_COUNT
    const hueHash = ((hash >>> 16) ^ hash) & 0xffff
    const hueShift = hueHash % 360
    return { palette, hueShift }
  }

  static pickDiverse(existing: AvatarAppearance[]): AvatarAppearance {
    const counts = new Array(PALETTE_COUNT).fill(0) as number[]
    for (const a of existing) counts[a.palette]++
    const minCount = Math.min(...counts)
    const available: number[] = []
    for (let i = 0; i < PALETTE_COUNT; i++) {
      if (counts[i] === minCount) available.push(i)
    }
    const palette = available[Math.floor(Math.random() * available.length)]
    let hueShift = 0
    if (minCount > 0) {
      hueShift = HUE_SHIFT_MIN_DEG + Math.floor(Math.random() * HUE_SHIFT_RANGE_DEG)
    }
    return { palette, hueShift }
  }

  static cacheKey(appearance: AvatarAppearance): string {
    return `${appearance.palette}:${appearance.hueShift}`
  }
}
