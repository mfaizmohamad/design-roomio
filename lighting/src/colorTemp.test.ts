import { describe, it, expect } from 'vitest'
import { kelvinToRgb, kelvinToHex, warmthToHex, WARMTH_KELVIN } from './colorTemp'

describe('colorTemp — Kelvin -> RGB', () => {
  it('warm (low K) is red-dominant; cool (high K) is blue-leaning', () => {
    const warm = kelvinToRgb(2200)
    const cool = kelvinToRgb(6500)
    expect(warm.r).toBeGreaterThan(warm.b)
    expect(cool.b).toBeGreaterThanOrEqual(cool.r - 40) // cool is much bluer relative to warm
    // monotonic-ish: blue rises with temperature
    expect(cool.b).toBeGreaterThan(warm.b)
  })

  it('produces valid 6-digit hex', () => {
    for (const k of [1500, 2700, 4000, 5200, 8000, 12000]) {
      expect(kelvinToHex(k)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('warm preset is warmer than cool preset', () => {
    const warm = warmthToHex('warm')
    const cool = warmthToHex('cool')
    const r = (h: string) => parseInt(h.slice(1, 3), 16)
    const b = (h: string) => parseInt(h.slice(5, 7), 16)
    expect(r(warm) - b(warm)).toBeGreaterThan(r(cool) - b(cool))
    expect(WARMTH_KELVIN.warm).toBeLessThan(WARMTH_KELVIN.cool)
  })

  it('clamps out-of-range Kelvin without throwing', () => {
    expect(() => kelvinToHex(-50)).not.toThrow()
    expect(() => kelvinToHex(99999)).not.toThrow()
  })
})
