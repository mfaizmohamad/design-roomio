import { describe, it, expect } from 'vitest'
import { clamp, clamp01, DEG2RAD } from './math'

// These tests PIN the exact behavior of the helpers as they existed inline in
// src/geometry/collision.ts, lighting/src/colorTemp.ts, lighting/src/sun.ts,
// multi-room/src/connectors.ts and src/data/personas.ts before consolidation.
// They must keep passing for the extraction to be behavior-preserving.

describe('shared/lib/math · clamp(v, lo, hi)', () => {
  it('returns v when within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })
  it('clamps below lo and above hi', () => {
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })
  it('is inclusive at the boundaries', () => {
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })
  it('passes NaN through (both comparisons false), matching the original ternary', () => {
    expect(Number.isNaN(clamp(NaN, 0, 10))).toBe(true)
  })
  it('checks v<lo before v>hi (branch order matters for inverted bounds)', () => {
    // clamp(5, 10, 0): 5 < 10 → returns lo (10), exactly as the ternary did.
    expect(clamp(5, 10, 0)).toBe(10)
  })
})

describe('shared/lib/math · clamp01(v)', () => {
  it('passes through values within [0, 1]', () => {
    expect(clamp01(0)).toBe(0)
    expect(clamp01(0.5)).toBe(0.5)
    expect(clamp01(1)).toBe(1)
  })
  it('clamps below 0 and above 1', () => {
    expect(clamp01(-0.5)).toBe(0)
    expect(clamp01(1.5)).toBe(1)
  })
  it('passes NaN through, matching the original ternary', () => {
    expect(Number.isNaN(clamp01(NaN))).toBe(true)
  })
  it('is equivalent to clamp(v, 0, 1) across a range', () => {
    for (const v of [-2, -0.1, 0, 0.3, 0.999, 1, 2]) {
      expect(clamp01(v)).toBe(clamp(v, 0, 1))
    }
  })
})

describe('shared/lib/math · DEG2RAD', () => {
  it('equals Math.PI / 180', () => {
    expect(DEG2RAD).toBe(Math.PI / 180)
  })
  it('converts 180° to π exactly', () => {
    expect(180 * DEG2RAD).toBe(Math.PI)
  })
})
