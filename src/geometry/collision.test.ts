import { describe, it, expect } from 'vitest'
import {
  resolveFurniture,
  obbOverlap,
  footprintCorners,
  type OBB,
} from './collision'
import { deriveWalls, pointInPolygon } from './walls'
import { presetCorners } from './presets'
import type { FurnitureItem, Vec2 } from '../types'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// A 600×400 rectangular room. Corners ordered clockwise in (x, z).
const RECT_CORNERS: Vec2[] = [
  { x: 0, z: 0 },
  { x: 600, z: 0 },
  { x: 600, z: 400 },
  { x: 0, z: 400 },
]

const WALL_THICKNESS = 12
const HALF_THICK = WALL_THICKNESS / 2

/** Build a furniture item with sensible defaults. */
function makeItem(over: Partial<FurnitureItem> = {}): FurnitureItem {
  return {
    id: 'item-1',
    archetype: 'sofa-2seat',
    category: 'sofa',
    name: 'Sofa',
    x: 300,
    z: 200,
    rotation: 0,
    w: 80,
    d: 60,
    h: 80,
    color: '#888888',
    ...over,
  }
}

/** Assert all four footprint corners are strictly inside the polygon. */
function expectAllCornersInside(
  cx: number,
  cz: number,
  w: number,
  d: number,
  rot: number,
  polygon: Vec2[],
) {
  const corners = footprintCorners(cx, cz, w, d, rot)
  expect(corners).toHaveLength(4)
  for (const corner of corners) {
    expect(
      pointInPolygon(corner, polygon),
      `corner (${corner.x.toFixed(1)}, ${corner.z.toFixed(1)}) should be inside polygon`,
    ).toBe(true)
  }
}

const OPTS = { wallThickness: WALL_THICKNESS }

// ---------------------------------------------------------------------------
// footprintCorners
// ---------------------------------------------------------------------------

describe('footprintCorners', () => {
  it('returns 4 corners centered on the item at rotation 0', () => {
    const corners = footprintCorners(100, 200, 80, 60, 0)
    expect(corners).toHaveLength(4)
    // At rot=0: world extents are ±w/2 in x and ±d/2 in z.
    const xs = corners.map((c) => c.x)
    const zs = corners.map((c) => c.z)
    expect(Math.min(...xs)).toBeCloseTo(100 - 40, 6)
    expect(Math.max(...xs)).toBeCloseTo(100 + 40, 6)
    expect(Math.min(...zs)).toBeCloseTo(200 - 30, 6)
    expect(Math.max(...zs)).toBeCloseTo(200 + 30, 6)
  })

  it('rotating 90° swaps the effective width/depth extents', () => {
    const w = 80
    const d = 60
    const corners = footprintCorners(0, 0, w, d, Math.PI / 2)
    const xs = corners.map((c) => c.x)
    const zs = corners.map((c) => c.z)
    const xExtent = Math.max(...xs) - Math.min(...xs)
    const zExtent = Math.max(...zs) - Math.min(...zs)
    // After a 90° turn the world x-extent equals the depth and z-extent the width.
    expect(xExtent).toBeCloseTo(d, 6)
    expect(zExtent).toBeCloseTo(w, 6)
  })

  it('matches the documented rotation convention (local +z -> world (sin,cos))', () => {
    // With cx=cz=0, w=0, d=2 (so hd=1, hw=0), the front-right corner is the
    // pure local +z offset (0, hd). At rot it must map to (sin(rot), cos(rot)).
    const rot = 0.7
    const corners = footprintCorners(0, 0, 0, 2, rot)
    // front-right is locals[0] = [hw, hd] = [0, 1]
    expect(corners[0].x).toBeCloseTo(Math.sin(rot), 6)
    expect(corners[0].z).toBeCloseTo(Math.cos(rot), 6)
  })
})

// ---------------------------------------------------------------------------
// obbOverlap
// ---------------------------------------------------------------------------

describe('obbOverlap', () => {
  it('reports true for two overlapping axis-aligned boxes', () => {
    const a: OBB = { cx: 0, cz: 0, w: 100, d: 100, rot: 0 }
    const b: OBB = { cx: 50, cz: 50, w: 100, d: 100, rot: 0 }
    expect(obbOverlap(a, b)).toBe(true)
  })

  it('reports false for distant boxes', () => {
    const a: OBB = { cx: 0, cz: 0, w: 100, d: 100, rot: 0 }
    const b: OBB = { cx: 1000, cz: 1000, w: 100, d: 100, rot: 0 }
    expect(obbOverlap(a, b)).toBe(false)
  })

  it('treats exactly-touching boxes as NOT overlapping (strict inequality)', () => {
    // Two 100-wide boxes whose faces touch exactly at x=50.
    const a: OBB = { cx: 0, cz: 0, w: 100, d: 100, rot: 0 }
    const b: OBB = { cx: 100, cz: 0, w: 100, d: 100, rot: 0 }
    expect(obbOverlap(a, b)).toBe(false)
  })

  it('handles rotated boxes — a 45° box overlaps a neighbour its AABB would miss', () => {
    // A box rotated 45° pokes its corner toward b. Centers are close enough that
    // the rotated diagonal reaches across.
    const a: OBB = { cx: 0, cz: 0, w: 100, d: 100, rot: Math.PI / 4 }
    const b: OBB = { cx: 65, cz: 0, w: 20, d: 20, rot: 0 }
    expect(obbOverlap(a, b)).toBe(true)

    // Same b moved far enough that even the rotated diagonal cannot reach.
    const far: OBB = { cx: 120, cz: 0, w: 20, d: 20, rot: 0 }
    expect(obbOverlap(a, far)).toBe(false)
  })

  it('detects overlap between two rotated boxes', () => {
    const a: OBB = { cx: 0, cz: 0, w: 120, d: 40, rot: Math.PI / 6 }
    const b: OBB = { cx: 20, cz: 10, w: 120, d: 40, rot: -Math.PI / 6 }
    expect(obbOverlap(a, b)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// resolveFurniture — §7 furniture stays inside the walls
// ---------------------------------------------------------------------------

describe('resolveFurniture — inside-room clamping (rectangular room)', () => {
  const walls = deriveWalls(RECT_CORNERS)

  it('derives 4 walls for the rectangular room', () => {
    expect(walls).toHaveLength(4)
  })

  it('clamps an item pushed THROUGH the south wall (z < 0) back inside', () => {
    const item = makeItem({ x: 300, z: 100 })
    // Propose a center far above the z=0 wall (outside the room).
    const res = resolveFurniture(
      item,
      { x: 300, z: -200 },
      walls,
      [],
      RECT_CORNERS,
      OPTS,
    )
    expectAllCornersInside(res.x, res.z, item.w, item.d, res.rotation, RECT_CORNERS)
    // It cannot have stayed at the proposed outside position.
    expect(res.z).toBeGreaterThan(0)
  })

  it('clamps an item pushed THROUGH the north wall (z > 400) back inside', () => {
    const item = makeItem({ x: 300, z: 300 })
    const res = resolveFurniture(
      item,
      { x: 300, z: 700 },
      walls,
      [],
      RECT_CORNERS,
      OPTS,
    )
    expectAllCornersInside(res.x, res.z, item.w, item.d, res.rotation, RECT_CORNERS)
    expect(res.z).toBeLessThan(400)
  })

  it('clamps an item pushed THROUGH the west wall (x < 0) back inside', () => {
    const item = makeItem({ x: 100, z: 200 })
    const res = resolveFurniture(
      item,
      { x: -300, z: 200 },
      walls,
      [],
      RECT_CORNERS,
      OPTS,
    )
    expectAllCornersInside(res.x, res.z, item.w, item.d, res.rotation, RECT_CORNERS)
    expect(res.x).toBeGreaterThan(0)
  })

  it('clamps an item pushed THROUGH the east wall (x > 600) back inside', () => {
    const item = makeItem({ x: 500, z: 200 })
    const res = resolveFurniture(
      item,
      { x: 900, z: 200 },
      walls,
      [],
      RECT_CORNERS,
      OPTS,
    )
    expectAllCornersInside(res.x, res.z, item.w, item.d, res.rotation, RECT_CORNERS)
    expect(res.x).toBeLessThan(600)
  })

  it('keeps the back face at least halfThickness inside the clamping wall', () => {
    const item = makeItem({ x: 300, z: 200, w: 80, d: 60 })
    const res = resolveFurniture(
      item,
      { x: 300, z: -500 },
      walls,
      [],
      RECT_CORNERS,
      OPTS,
    )
    // The nearest corner to the z=0 (south) wall must sit at >= halfThickness.
    const corners = footprintCorners(res.x, res.z, item.w, item.d, res.rotation)
    const minZ = Math.min(...corners.map((c) => c.z))
    expect(minZ).toBeGreaterThanOrEqual(HALF_THICK - 1e-6)
  })

  it('leaves an already-legal interior move untouched', () => {
    const item = makeItem({ x: 300, z: 200 })
    const res = resolveFurniture(
      item,
      { x: 320, z: 180 },
      walls,
      [],
      RECT_CORNERS,
      OPTS,
    )
    // Well inside, no snap, position should equal the proposed move.
    expect(res.x).toBeCloseTo(320, 6)
    expect(res.z).toBeCloseTo(180, 6)
    expect(res.snappedToWall).toBe(false)
  })
})

describe('resolveFurniture — sliding along a wall', () => {
  const walls = deriveWalls(RECT_CORNERS)

  it('preserves the tangential (x) coordinate while clamping the perpendicular (z) at the south wall', () => {
    const item = makeItem({ x: 300, z: 100, w: 80, d: 60 })
    // Drag diagonally: push hard into the south wall (z very negative) but also
    // slide sideways to x=150. The along-wall x should track the proposed move;
    // the perpendicular z is clamped.
    const res = resolveFurniture(
      item,
      { x: 150, z: -300 },
      walls,
      [],
      RECT_CORNERS,
      OPTS,
    )
    // Tangential coordinate is preserved (slide), since the south wall's normal
    // is purely along z and never touches x.
    expect(res.x).toBeCloseTo(150, 4)
    // Perpendicular is clamped so the back stays inside.
    const corners = footprintCorners(res.x, res.z, item.w, item.d, res.rotation)
    const minZ = Math.min(...corners.map((c) => c.z))
    expect(minZ).toBeGreaterThanOrEqual(HALF_THICK - 1e-6)
    expectAllCornersInside(res.x, res.z, item.w, item.d, res.rotation, RECT_CORNERS)
  })

  it('preserves the tangential (z) coordinate while clamping the perpendicular (x) at the east wall', () => {
    const item = makeItem({ x: 500, z: 200, w: 80, d: 60 })
    const res = resolveFurniture(
      item,
      { x: 1000, z: 320 },
      walls,
      [],
      RECT_CORNERS,
      OPTS,
    )
    // East wall normal is along x → tangential z is preserved.
    expect(res.z).toBeCloseTo(320, 4)
    expectAllCornersInside(res.x, res.z, item.w, item.d, res.rotation, RECT_CORNERS)
  })
})

describe('resolveFurniture — wall snapping', () => {
  const walls = deriveWalls(RECT_CORNERS)

  it('snaps flush when the back edge is within the snap threshold of the south wall', () => {
    // Item facing +z (rot 0), so its back (local -z) faces the z=0 south wall.
    // Place it so the back edge is a few cm from the inner wall face (within 18cm).
    const item = makeItem({ x: 300, z: 200, w: 80, d: 60, rotation: 0 })
    // back edge z = z - d/2. Inner wall face is at z = halfThickness = 6.
    // Put center at z = 6 + 30 + 5 = 41 → gap 5cm, within snap threshold.
    const res = resolveFurniture(
      item,
      { x: 300, z: 41 },
      walls,
      [],
      RECT_CORNERS,
      OPTS,
    )
    expect(res.snappedToWall).toBe(true)
    // Flush: back edge sits exactly at the inner wall face (z = halfThickness).
    const corners = footprintCorners(res.x, res.z, item.w, item.d, res.rotation)
    const minZ = Math.min(...corners.map((c) => c.z))
    expect(minZ).toBeCloseTo(HALF_THICK, 3)
    expectAllCornersInside(res.x, res.z, item.w, item.d, res.rotation, RECT_CORNERS)
  })

  it('does not snap when the back edge is far from any wall', () => {
    const item = makeItem({ x: 300, z: 200, w: 80, d: 60, rotation: 0 })
    const res = resolveFurniture(
      item,
      { x: 300, z: 200 },
      walls,
      [],
      RECT_CORNERS,
      OPTS,
    )
    expect(res.snappedToWall).toBe(false)
  })
})

describe('resolveFurniture — soft overlap (warning, never blocks)', () => {
  const walls = deriveWalls(RECT_CORNERS)

  it('reports the overlapped id and still updates position', () => {
    const other = makeItem({
      id: 'other-1',
      x: 300,
      z: 200,
      w: 100,
      d: 100,
    })
    const item = makeItem({ id: 'item-1', x: 100, z: 100, w: 80, d: 60 })
    // Move item right on top of other.
    const res = resolveFurniture(
      item,
      { x: 300, z: 200 },
      walls,
      [other],
      RECT_CORNERS,
      OPTS,
    )
    expect(res.overlaps).toContain('other-1')
    // The move is NOT blocked: position still moved to the proposed (legal) spot.
    expect(res.x).toBeCloseTo(300, 4)
    expect(res.z).toBeCloseTo(200, 4)
  })

  it('does not report overlap for a distant item', () => {
    const other = makeItem({ id: 'other-1', x: 100, z: 100, w: 40, d: 40 })
    const item = makeItem({ id: 'item-1', x: 500, z: 350, w: 40, d: 40 })
    const res = resolveFurniture(
      item,
      { x: 500, z: 350 },
      walls,
      [other],
      RECT_CORNERS,
      OPTS,
    )
    expect(res.overlaps).toHaveLength(0)
  })

  it('never reports overlap with itself', () => {
    const item = makeItem({ id: 'item-1', x: 300, z: 200 })
    const res = resolveFurniture(
      item,
      { x: 300, z: 200 },
      walls,
      [item],
      RECT_CORNERS,
      OPTS,
    )
    expect(res.overlaps).not.toContain('item-1')
  })
})

describe('resolveFurniture — L-shape room (concave)', () => {
  const corners = presetCorners('l')
  const walls = deriveWalls(corners)

  it('derives one wall per L-shape corner', () => {
    expect(walls).toHaveLength(corners.length)
    expect(walls).toHaveLength(6)
  })

  it('clamps an item shoved toward each L-shape wall to stay fully inside', () => {
    // For each wall, push the item hard along the OUTWARD normal (away from the
    // room) and confirm every corner is clamped back inside the L polygon.
    for (const wall of walls) {
      const item = makeItem({ x: wall.midX, z: wall.midZ, w: 60, d: 60 })
      const proposed = {
        x: wall.midX - wall.nx * 500,
        z: wall.midZ - wall.nz * 500,
      }
      const res = resolveFurniture(item, proposed, walls, [], corners, OPTS)
      expectAllCornersInside(res.x, res.z, item.w, item.d, res.rotation, corners)
    }
  })

  it('keeps an item inside when shoved into the concave (reflex) notch corner', () => {
    // The L notch interior corner is at (360, 180) for the default preset.
    // Place an item near it and shove it toward the notch; it must stay inside.
    const item = makeItem({ x: 360, z: 180, w: 80, d: 80 })
    const res = resolveFurniture(
      item,
      { x: 500, z: 80 },
      walls,
      [],
      corners,
      OPTS,
    )
    expectAllCornersInside(res.x, res.z, item.w, item.d, res.rotation, corners)
  })
})
