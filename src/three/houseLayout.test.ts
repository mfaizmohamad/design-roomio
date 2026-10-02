import { describe, it, expect } from 'vitest'
import { layoutHouse, houseBoundsCm, houseColliders, type RoomPlacement } from './houseLayout'
import { newDesign } from '../store'
import { bbox, deriveWalls } from '../geometry/walls'
import type { Opening, FurnitureItem, RoomDesign } from '../types'
import { resolveWalk } from '../../camera-flythrough/src/engine/collision'

function room(id: string, type?: string): RoomPlacement {
  return { design: { ...newDesign('rect'), id, openings: [] }, type }
}
function aabbOf(p: ReturnType<typeof layoutHouse>[number]) {
  const bb = bbox(p.design.corners)
  return { minX: p.centerCm.x - bb.w / 2, maxX: p.centerCm.x + bb.w / 2, minZ: p.centerCm.z - bb.d / 2, maxZ: p.centerCm.z + bb.d / 2 }
}
function rectsOverlap(a: ReturnType<typeof aabbOf>, b: ReturnType<typeof aabbOf>) {
  return Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 1 && Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > 1
}

// dims of the default rect room (all test rooms are identical)
const W = bbox(room('w').design.corners).w
const D = bbox(room('w').design.corners).d

describe('houseLayout — 2D floor plan', () => {
  it('arranges rooms in a 2D grid (not a single straight strip)', () => {
    const placed = layoutHouse([room('a'), room('b'), room('c')])
    expect(placed).toHaveLength(3)
    // ⌈√3⌉ = 2 per row ⇒ rooms occupy more than one z band (2D, not a strip)
    const zBands = new Set(placed.map((p) => Math.round(p.centerCm.z)))
    expect(zBands.size).toBeGreaterThan(1)
    // no two rooms overlap
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) expect(rectsOverlap(aabbOf(placed[i]), aabbOf(placed[j]))).toBe(false)
  })

  it('honors explicit per-room positions (drag / template)', () => {
    const a = room('a')
    a.pos = { x: 120, z: 240 }
    const b = room('b')
    b.pos = { x: 900, z: 240 }
    const placed = layoutHouse([a, b])
    expect(placed[0].centerCm).toEqual({ x: 120, z: 240 })
    expect(placed[1].centerCm).toEqual({ x: 900, z: 240 })
  })

  it('un-positioned rooms never overlap positioned ones (mixed state: add a room after dragging)', () => {
    const a = room('a')
    a.pos = { x: W / 2, z: D / 2 } // dragged/positioned
    const b = room('b')
    b.pos = { x: W + W / 2, z: D / 2 } // dragged/positioned
    const c = room('c') // freshly added — no pos (this used to grid-pack at the origin, ON TOP of a)
    const placed = layoutHouse([a, b, c])
    const C = aabbOf(placed[2])
    expect(rectsOverlap(C, aabbOf(placed[0]))).toBe(false)
    expect(rectsOverlap(C, aabbOf(placed[1]))).toBe(false)
  })

  it('cuts a real doorway between rooms that share a wall edge (unique ids)', () => {
    const placed = layoutHouse([room('a'), room('b'), room('c')])
    const total = placed.reduce((n, p) => n + p.extraOpenings.length, 0)
    expect(total).toBeGreaterThanOrEqual(2) // the grid corner connects to its 2 neighbours
    for (const p of placed)
      for (const o of p.extraOpenings) {
        expect(o.kind).toBe('door')
        expect(o.width).toBeGreaterThan(70)
        expect(o.sill).toBe(0)
      }
    const ids = placed.flatMap((p) => p.extraOpenings.map((o) => o.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('does NOT connect two bedrooms directly (realism: reached from the hall)', () => {
    const a = room('a', 'bedroom')
    a.pos = { x: W / 2, z: D / 2 }
    const b = room('b', 'bedroom')
    b.pos = { x: W + W / 2, z: D / 2 } // touches a along the shared vertical wall
    const placed = layoutHouse([a, b])
    expect(placed[0].extraOpenings).toHaveLength(0)
    expect(placed[1].extraOpenings).toHaveLength(0)
  })

  it('single room: no doorways', () => {
    const placed = layoutHouse([room('solo')])
    expect(placed[0].extraOpenings).toHaveLength(0)
  })

  // Step rightward like the real ~5 cm/frame walk loop (resolveWalk is not swept).
  function walkRight(cols: ReturnType<typeof houseColliders>, start: { x: number; z: number }) {
    let p = start
    for (let i = 0; i < 120; i++) p = resolveWalk(p, { x: p.x + 5, z: p.z }, cols, { radius: 18 })
    return p
  }

  function twoSideBySide() {
    const a = room('a')
    a.pos = { x: W / 2, z: D / 2 }
    const b = room('b')
    b.pos = { x: W + W / 2, z: D / 2 }
    return layoutHouse([a, b])
  }

  it('houseColliders: you can WALK through the doorway between two adjacent rooms', () => {
    const placed = twoSideBySide()
    const cols = houseColliders(placed)
    const end = walkRight(cols, { x: W - 120, z: D / 2 }) // z=D/2 is the centred doorway
    expect(end.x).toBeGreaterThan(W + 20)
  })

  it('houseColliders: a SOLID part of the shared wall still blocks you', () => {
    const placed = twoSideBySide()
    const cols = houseColliders(placed)
    const end = walkRight(cols, { x: W - 120, z: 35 }) // near the wall end, away from the door
    expect(end.x).toBeLessThan(W)
  })

  it('houseColliders: you CANNOT walk through a window (sill > 0 → solid at the floor)', () => {
    const a = room('a')
    a.pos = { x: W / 2, z: D / 2 }
    const rightWall = deriveWalls(a.design.corners)
      .filter((w) => Math.abs(w.dirX) < 0.25)
      .reduce((m, w) => (w.midX > m.midX ? w : m))
    const win: Opening = { id: 'win', kind: 'window', style: 'windowSingle', wallId: rightWall.id, t: 0.2, width: 100, height: 120, sill: 90 }
    a.design.openings = [win]
    const b = room('b')
    b.pos = { x: W + W / 2, z: D / 2 }
    const placed = layoutHouse([a, b])
    const cols = houseColliders(placed)
    const winZ = rightWall.a.z + rightWall.dirZ * (0.2 * rightWall.length)
    const end = walkRight(cols, { x: W - 120, z: winZ })
    expect(end.x).toBeLessThan(W) // window is solid at the floor — blocked
  })

  // A flat floor covering (rug/carpet) must be WALKABLE — you step onto it, so it
  // must not become a collider footprint (else you hit an invisible wall at its edge).
  function furn(archetype: string, over: Partial<FurnitureItem>): FurnitureItem {
    return {
      id: `f-${archetype}`, archetype, category: 'decor', name: archetype,
      x: 300, z: 200, rotation: 0, w: 100, d: 100, h: 50, color: '#888', ...over,
    }
  }

  it('houseColliders: a rug adds NO collider footprint, but a sofa does', () => {
    const emptyCount = houseColliders(layoutHouse([room('a')])).furniture.length

    const withRug = room('a')
    withRug.design.furniture = [furn('decor-rug-large', { h: 1.5, w: 300, d: 250 })]
    expect(houseColliders(layoutHouse([withRug])).furniture.length).toBe(emptyCount)

    const withSofa = room('a')
    withSofa.design.furniture = [furn('sofa-chesterfield', { h: 78, w: 200, d: 90 })]
    expect(houseColliders(layoutHouse([withSofa])).furniture.length).toBe(emptyCount + 1)
  })

  it('houseColliders: you WALK OVER a rug in your path, but a sofa blocks you', () => {
    // Both pieces sit at the doorway (x≈W, z=D/2) squarely across the walk path.
    const rugRoom = room('a')
    rugRoom.pos = { x: W / 2, z: D / 2 }
    rugRoom.design.furniture = [furn('decor-rug-large', { x: W, z: D / 2, w: 200, d: 300, h: 1.5 })]
    const rugB = room('b'); rugB.pos = { x: W + W / 2, z: D / 2 }
    const rugCols = houseColliders(layoutHouse([rugRoom, rugB]))
    expect(walkRight(rugCols, { x: W - 120, z: D / 2 }).x).toBeGreaterThan(W + 20) // passed through

    const sofaRoom = room('a')
    sofaRoom.pos = { x: W / 2, z: D / 2 }
    sofaRoom.design.furniture = [furn('sofa-chesterfield', { x: W, z: D / 2, w: 120, d: 200, h: 78 })]
    const sofaB = room('b'); sofaB.pos = { x: W + W / 2, z: D / 2 }
    const sofaCols = houseColliders(layoutHouse([sofaRoom, sofaB]))
    expect(walkRight(sofaCols, { x: W - 120, z: D / 2 }).x).toBeLessThan(W) // stopped at the sofa
  })

  it('house bounds enclose all rooms', () => {
    const placed = layoutHouse([room('a'), room('b'), room('c')])
    const hb = houseBoundsCm(placed)
    expect(hb.w).toBeGreaterThan(0)
    for (const p of placed) {
      const bb = bbox(p.design.corners)
      expect(p.centerCm.x - bb.w / 2).toBeGreaterThanOrEqual(hb.minX - 1e-6)
      expect(p.centerCm.x + bb.w / 2).toBeLessThanOrEqual(hb.maxX + 1e-6)
    }
  })
})

// Multi-storey houses: rooms on different levels overlap/abut in plan BY DESIGN
// (an upper bedroom sits over the kitchen) — they must never be auto-connected.
describe('layoutHouse — storeys', () => {
  const box = (id: string): RoomDesign => ({
    ...newDesign('rect'),
    id,
    corners: [
      { x: 0, z: 0 },
      { x: 400, z: 0 },
      { x: 400, z: 300 },
      { x: 0, z: 300 },
    ],
    openings: [],
  })

  it('adjacent rooms on the SAME level get a doorway; on different levels they do not', () => {
    const same = layoutHouse([
      { design: box('a'), pos: { x: 200, z: 150 }, level: 0 },
      { design: box('b'), pos: { x: 600, z: 150 }, level: 0 },
    ])
    expect(same[0].extraOpenings.length).toBe(1)
    const split = layoutHouse([
      { design: box('a'), pos: { x: 200, z: 150 }, level: 0 },
      { design: box('b'), pos: { x: 600, z: 150 }, level: 1, elevationCm: 290 },
    ])
    expect(split[0].extraOpenings).toEqual([])
    expect(split[1].extraOpenings).toEqual([])
  })

  it('carries level + elevation through to the placed room (absent ⇒ ground)', () => {
    const [g, u] = layoutHouse([
      { design: box('g'), pos: { x: 200, z: 150 } },
      { design: box('u'), pos: { x: 200, z: 150 }, level: 1, elevationCm: 290 },
    ])
    expect([g.level, g.elevationCm]).toEqual([0, 0])
    expect([u.level, u.elevationCm]).toEqual([1, 290])
  })
})
