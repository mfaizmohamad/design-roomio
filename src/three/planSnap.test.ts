import { describe, it, expect } from 'vitest'
import { applySnaps, rectFromCenter, type SnapRect } from './planSnap'

// A 200×200 room centered at the origin.
const A: SnapRect = { x: 0, z: 0, w: 200, d: 200 }

describe('applySnaps', () => {
  it('snaps a room flush against a neighbour (shared wall, no gap/overlap)', () => {
    // A occupies x ∈ [-100, 100]. A 200-wide room dragged to center x=205 has its left edge at 105 —
    // 5cm from A's right edge (100). With a 10cm threshold it should snap flush: left edge → 100 ⇒ center 200.
    const r = applySnaps({ x: 205, z: 0 }, { w: 200, d: 200 }, [A], { thresholdCm: 10 })
    expect(r.x).toBe(200) // left edge (100) exactly meets A's right edge (100) → shared wall
    expect(r.z).toBe(0) // already center-aligned on z → snapped to 0
    expect(r.guides.some((g) => g.axis === 'x' && g.at === 100)).toBe(true)
  })

  it('center-aligns to a neighbour when close', () => {
    // Dragged room's center at x=6 is within 10cm of A's center (0) → snaps center to 0.
    const r = applySnaps({ x: 6, z: 50 }, { w: 120, d: 120 }, [A], { thresholdCm: 10 })
    expect(r.x).toBe(0)
  })

  it('quantizes to the grid when no neighbour edge is closer', () => {
    // Far from A on x (no edge within threshold), grid 10 rounds a center of 103 → 100.
    const r = applySnaps({ x: 1003, z: 1003 }, { w: 200, d: 200 }, [A], { thresholdCm: 8, gridCm: 10 })
    expect(r.x).toBe(1000)
    expect(r.z).toBe(1000)
  })

  it('does nothing when the target is beyond the threshold', () => {
    const r = applySnaps({ x: 400, z: 400 }, { w: 200, d: 200 }, [A], { thresholdCm: 8 })
    expect(r.x).toBe(400)
    expect(r.z).toBe(400)
    expect(r.guides).toHaveLength(0)
  })

  it('disable bypasses all snapping (Alt-to-free-place)', () => {
    const r = applySnaps({ x: 205, z: 3 }, { w: 200, d: 200 }, [A], { thresholdCm: 10, gridCm: 10, disable: true })
    expect(r.x).toBe(205)
    expect(r.z).toBe(3)
    expect(r.guides).toHaveLength(0)
  })

  it('resolves each axis independently (flush edge on x, center on z)', () => {
    const B: SnapRect = { x: 500, z: 500, w: 200, d: 200 } // far away → no influence
    // x: left edge 105 near A's right edge 100 → snap flush (center → 200).
    // z: center 7 near A's center 0 → snap center to 0. Two different snap types, one per axis.
    const r = applySnaps({ x: 205, z: 7 }, { w: 200, d: 200 }, [A, B], { thresholdCm: 10 })
    expect(r.x).toBe(200)
    expect(r.z).toBe(0)
  })

  it('rectFromCenter builds a center-anchored rect', () => {
    expect(rectFromCenter({ x: 10, z: 20 }, { w: 100, d: 50 })).toEqual({ x: 10, z: 20, w: 100, d: 50 })
  })
})
