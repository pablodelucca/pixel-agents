import { describe, it, expect } from 'vitest'
import { AvatarIdentity } from '../AvatarIdentity.js'
import type { AvatarAppearance } from '../types.js'

describe('AvatarIdentity', () => {
  describe('fromUserName', () => {
    it('returns same appearance for same name', () => {
      const a = AvatarIdentity.fromUserName('Alice')
      const b = AvatarIdentity.fromUserName('Alice')
      expect(a).toEqual(b)
    })

    it('returns palette in 0-5 range', () => {
      const result = AvatarIdentity.fromUserName('Bob')
      expect(result.palette).toBeGreaterThanOrEqual(0)
      expect(result.palette).toBeLessThan(6)
    })

    it('returns hueShift in 0-359 range', () => {
      const result = AvatarIdentity.fromUserName('Charlie')
      expect(result.hueShift).toBeGreaterThanOrEqual(0)
      expect(result.hueShift).toBeLessThan(360)
    })

    it('produces different appearances for different names', () => {
      const names = ['Alice', 'Bob', 'Charlie', 'Dave', 'Eve']
      const appearances = names.map(n => AvatarIdentity.fromUserName(n))
      const keys = appearances.map(a => `${a.palette}:${a.hueShift}`)
      const unique = new Set(keys)
      expect(unique.size).toBeGreaterThanOrEqual(3)
    })
  })

  describe('pickDiverse', () => {
    it('picks unused palette when available', () => {
      const existing: AvatarAppearance[] = [
        { palette: 0, hueShift: 0 },
        { palette: 1, hueShift: 0 },
      ]
      const result = AvatarIdentity.pickDiverse(existing)
      expect([2, 3, 4, 5]).toContain(result.palette)
      expect(result.hueShift).toBe(0)
    })

    it('returns hueShift > 0 when all palettes used', () => {
      const existing: AvatarAppearance[] = Array.from({ length: 6 }, (_, i) => ({
        palette: i,
        hueShift: 0,
      }))
      const result = AvatarIdentity.pickDiverse(existing)
      expect(result.hueShift).toBeGreaterThan(0)
    })

    it('picks from empty existing', () => {
      const result = AvatarIdentity.pickDiverse([])
      expect(result.palette).toBeGreaterThanOrEqual(0)
      expect(result.palette).toBeLessThan(6)
    })
  })

  describe('cacheKey', () => {
    it('is deterministic', () => {
      const a: AvatarAppearance = { palette: 2, hueShift: 45 }
      expect(AvatarIdentity.cacheKey(a)).toBe(AvatarIdentity.cacheKey(a))
    })

    it('differs for different appearances', () => {
      const a: AvatarAppearance = { palette: 0, hueShift: 0 }
      const b: AvatarAppearance = { palette: 1, hueShift: 0 }
      expect(AvatarIdentity.cacheKey(a)).not.toBe(AvatarIdentity.cacheKey(b))
    })
  })
})
