import { describe, it, expect } from 'vitest'
import { resolveWalk, pointInAnyFurniture } from '../src/engine/collision'
import { deriveWalls, pointInPolygon } from '../src/engine/geometry'
import type { Colliders, Vec2 } from '../src/contract/sceneContract'

const corners: Vec2[] = [
  { x: 0, z: 0 },
  { x: 600, z: 0 },
  { x: 600, z: 400 },
  { x: 0, z: 400 },
]

function world(furniture: Colliders['furniture'] = []): Colliders {
  return {
    walls: deriveWalls(corners),
    furniture,
    polygon: corners,
    wallThickness: 10,
    bounds: { minX: 0, minZ: 0, maxX: 600, maxZ: 400 },
  }
}

const RADIUS = 18
const MARGIN = 5 + RADIUS // wallThickness/2 + radius

describe('resolveWalk — walls', () => {
  it('leaves a point well inside untouched', () => {
    const r = resolveWalk({ x: 300, z: 200 }, { x: 320, z: 210 }, world(), { radius: RADIUS })
    expect(r.x).toBeCloseTo(320, 5)
    expect(r.z).toBeCloseTo(210, 5)
  })

  it('clamps a point that pokes through a wall back to the margin', () => {
    // propose far past the +x wall
    const r = resolveWalk({ x: 300, z: 200 }, { x: 1000, z: 200 }, world(), { radius: RADIUS })
    expect(r.x).toBeLessThanOrEqual(600 - MARGIN + 1e-6)
    expect(r.x).toBeCloseTo(600 - MARGIN, 4)
    expect(pointInPolygon(r, corners)).toBe(true)
  })

  it('clamps all four walls', () => {
    for (const [px, pz, axis, lim] of [
      [-500, 200, 'x', MARGIN],
      [1100, 200, 'x', 600 - MARGIN],
      [300, -500, 'z', MARGIN],
      [300, 900, 'z', 400 - MARGIN],
    ] as const) {
      const r = resolveWalk({ x: 300, z: 200 }, { x: px, z: pz }, world(), { radius: RADIUS })
      expect(r[axis]).toBeCloseTo(lim, 3)
    }
  })

  it('slides along a wall: tangential motion is preserved when pushed in', () => {
    // moving toward +x wall AND +z; x clamps, z should keep moving
    const r = resolveWalk({ x: 560, z: 100 }, { x: 700, z: 180 }, world(), { radius: RADIUS })
    expect(r.x).toBeCloseTo(600 - MARGIN, 3)
    expect(r.z).toBeCloseTo(180, 3) // tangential component untouched
  })
})

describe('resolveWalk — furniture', () => {
  const sofa = { cx: 300, cz: 200, w: 220, d: 95, rot: 0 }

  it('pushes a walker out of a furniture footprint', () => {
    const r = resolveWalk({ x: 300, z: 120 }, { x: 300, z: 200 }, world([sofa]), { radius: RADIUS })
    // must end clear of the inflated footprint
    expect(pointInAnyFurniture(r, [sofa])).toBe(false)
    // pushed out along the shorter (z) axis: |z-200| >= d/2 + radius
    expect(Math.abs(r.z - 200)).toBeGreaterThanOrEqual(95 / 2 + RADIUS - 1)
  })

  it('respects a rotated furniture footprint', () => {
    const rotated = { cx: 300, cz: 200, w: 220, d: 95, rot: Math.PI / 2 }
    const r = resolveWalk({ x: 180, z: 200 }, { x: 300, z: 200 }, world([rotated]), { radius: RADIUS })
    expect(pointInAnyFurniture(r, [rotated])).toBe(false)
  })

  it('a path between wall and furniture stays legal', () => {
    const w = world([sofa])
    let p = { x: 60, z: 60 }
    // simulate stepping toward the +x wall hugging the top
    for (let i = 0; i < 40; i++) {
      p = resolveWalk(p, { x: p.x + 20, z: p.z }, w, { radius: RADIUS })
      expect(pointInPolygon(p, corners)).toBe(true)
      expect(pointInAnyFurniture(p, [sofa])).toBe(false)
    }
  })
})
