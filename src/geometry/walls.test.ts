import { describe, it, expect } from 'vitest'
import {
  deriveWalls,
  buildWallParts,
  pointInPolygon,
  polygonCentroid,
  bbox,
  signedArea,
  safeInteriorPoint,
  pointOnWall,
  isRectilinear,
  type WallPart,
} from './walls'
import { PRESETS, presetCorners } from './presets'
import type { Opening, Vec2, Wall } from '../types'

const RECT_CORNERS: Vec2[] = [
  { x: 0, z: 0 },
  { x: 600, z: 0 },
  { x: 600, z: 400 },
  { x: 0, z: 400 },
]

// ---------------------------------------------------------------------------
// polygonCentroid / bbox / signedArea / pointOnWall / isRectilinear
// ---------------------------------------------------------------------------

describe('polygonCentroid', () => {
  it('returns the average of corners for a rectangle', () => {
    const c = polygonCentroid(RECT_CORNERS)
    expect(c.x).toBeCloseTo(300, 6)
    expect(c.z).toBeCloseTo(200, 6)
  })
})

describe('bbox', () => {
  it('computes bounds, size and center', () => {
    const b = bbox(RECT_CORNERS)
    expect(b.minX).toBe(0)
    expect(b.minZ).toBe(0)
    expect(b.maxX).toBe(600)
    expect(b.maxZ).toBe(400)
    expect(b.w).toBe(600)
    expect(b.d).toBe(400)
    expect(b.cx).toBe(300)
    expect(b.cz).toBe(200)
  })
})

describe('signedArea', () => {
  it('is nonzero for the rectangle and equals ±w*d in magnitude', () => {
    expect(Math.abs(signedArea(RECT_CORNERS))).toBeCloseTo(600 * 400, 6)
  })
})

describe('pointOnWall', () => {
  it('interpolates along a→b', () => {
    const wall = deriveWalls(RECT_CORNERS)[0]
    const start = pointOnWall(wall, 0)
    const end = pointOnWall(wall, 1)
    const mid = pointOnWall(wall, 0.5)
    expect(start.x).toBeCloseTo(wall.a.x, 6)
    expect(start.z).toBeCloseTo(wall.a.z, 6)
    expect(end.x).toBeCloseTo(wall.b.x, 6)
    expect(end.z).toBeCloseTo(wall.b.z, 6)
    expect(mid.x).toBeCloseTo((wall.a.x + wall.b.x) / 2, 6)
  })
})

describe('isRectilinear', () => {
  it('is true for the axis-aligned rectangle', () => {
    expect(isRectilinear(deriveWalls(RECT_CORNERS))).toBe(true)
  })

  it('is true for the L-shape (all walls axis-aligned)', () => {
    expect(isRectilinear(deriveWalls(presetCorners('l')))).toBe(true)
  })

  it('is false for the beveled shape (has diagonal walls)', () => {
    expect(isRectilinear(deriveWalls(presetCorners('beveled')))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// deriveWalls — count + inward-pointing unit normals
// ---------------------------------------------------------------------------

/** Dot of a wall's inward normal with (centroid - wall midpoint). */
function normalFacesCentroid(wall: Wall, centroid: Vec2): number {
  return wall.nx * (centroid.x - wall.midX) + wall.nz * (centroid.z - wall.midZ)
}

describe('deriveWalls', () => {
  it('returns N walls for an N-corner rectangle, each with a unit normal', () => {
    const walls = deriveWalls(RECT_CORNERS)
    expect(walls).toHaveLength(4)
    for (const w of walls) {
      expect(Math.hypot(w.nx, w.nz)).toBeCloseTo(1, 6)
      expect(Math.hypot(w.dirX, w.dirZ)).toBeCloseTo(1, 6)
    }
  })

  it('orients inward normals toward the centroid for the rectangle', () => {
    const walls = deriveWalls(RECT_CORNERS)
    const c = polygonCentroid(RECT_CORNERS)
    for (const w of walls) {
      expect(normalFacesCentroid(w, c)).toBeGreaterThan(0)
    }
  })

  it('orients inward normals toward the centroid for the L-shape', () => {
    const corners = presetCorners('l')
    const walls = deriveWalls(corners)
    const c = polygonCentroid(corners)
    expect(walls).toHaveLength(6)
    for (const w of walls) {
      // The notch's reflex edges still point toward the centroid in this
      // convex-enough L; the implementation uses centroid orientation.
      expect(normalFacesCentroid(w, c)).toBeGreaterThan(0)
    }
  })

  it('records the wall length, midpoint and angle consistently', () => {
    const walls = deriveWalls(RECT_CORNERS)
    const south = walls[0] // (0,0)->(600,0)
    expect(south.length).toBeCloseTo(600, 6)
    expect(south.midX).toBeCloseTo(300, 6)
    expect(south.midZ).toBeCloseTo(0, 6)
    // angle = atan2(nx, nz); inward normal of south wall is (0, +1) → angle 0.
    expect(south.angle).toBeCloseTo(Math.atan2(south.nx, south.nz), 6)
  })

  it('skips degenerate zero-length edges', () => {
    const withDup: Vec2[] = [
      { x: 0, z: 0 },
      { x: 0, z: 0 }, // duplicate → zero-length edge
      { x: 600, z: 0 },
      { x: 600, z: 400 },
      { x: 0, z: 400 },
    ]
    const walls = deriveWalls(withDup)
    // 5 corners but one edge is degenerate → 4 real walls.
    expect(walls).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// buildWallParts — openings carve holes
// ---------------------------------------------------------------------------

const WALL_HEIGHT = 270
const THICKNESS = 12

/** Does a wall part's [u, v] rectangle overlap the given rectangle? */
function partOverlapsRect(
  part: WallPart,
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
): boolean {
  const puMin = part.uCenter - part.lenU / 2
  const puMax = part.uCenter + part.lenU / 2
  const pvMin = part.vCenter - part.lenV / 2
  const pvMax = part.vCenter + part.lenV / 2
  // strict overlap (touching edges don't count)
  return puMin < uMax - 1e-6 && puMax > uMin + 1e-6 && pvMin < vMax - 1e-6 && pvMax > vMin + 1e-6
}

describe('buildWallParts', () => {
  const wall = deriveWalls(RECT_CORNERS)[0] // south wall, length 600

  it('returns a single full-height strip when there are no openings', () => {
    const parts = buildWallParts(wall, [], WALL_HEIGHT, THICKNESS)
    expect(parts).toHaveLength(1)
    expect(parts[0].lenV).toBeCloseTo(WALL_HEIGHT, 6)
  })

  it('carves a door (sill 0): side strips + header, NO sill piece, hole left empty', () => {
    const door: Opening = {
      id: 'd1',
      kind: 'door',
      style: 'single',
      wallId: wall.id,
      t: 0.5,
      width: 100,
      height: 210,
      sill: 0,
    }
    const parts = buildWallParts(wall, [door], WALL_HEIGHT, THICKNESS)

    // Opening occupies u in [250, 350], v in [0, 210].
    const uMin = 250
    const uMax = 350
    const vMin = 0
    const vMax = 210

    // No solid part may intrude into the door opening rectangle.
    for (const part of parts) {
      expect(
        partOverlapsRect(part, uMin, uMax, vMin, vMax),
        `part u${part.uCenter} v${part.vCenter} must not cover the door opening`,
      ).toBe(false)
    }

    // There must be at least two full-height side strips and a header above.
    const fullHeight = parts.filter((p) => Math.abs(p.lenV - WALL_HEIGHT) < 0.1)
    expect(fullHeight.length).toBeGreaterThanOrEqual(2)

    // A header sits above the door (vBottom of part > opening top).
    const header = parts.find((p) => p.vCenter - p.lenV / 2 >= vMax - 1e-3)
    expect(header).toBeTruthy()

    // No sill piece below a door (sill = 0).
    const sill = parts.find((p) => p.vCenter + p.lenV / 2 <= 0.1 + 1e-3 && p.lenV > 0.1)
    expect(sill).toBeFalsy()
  })

  it('carves a window (sill > 0): side strips + header + a sill piece below', () => {
    const win: Opening = {
      id: 'w1',
      kind: 'window',
      style: 'windowSingle',
      wallId: wall.id,
      t: 0.5,
      width: 120,
      height: 120,
      sill: 90,
    }
    const parts = buildWallParts(wall, [win], WALL_HEIGHT, THICKNESS)

    // Opening: u in [240, 360], v in [90, 210].
    const uMin = 240
    const uMax = 360
    const vMin = 90
    const vMax = 210

    for (const part of parts) {
      expect(
        partOverlapsRect(part, uMin, uMax, vMin, vMax),
        `part must not cover the window opening`,
      ).toBe(false)
    }

    // A sill piece exists below the window (top at sill=90, bottom at 0).
    const sill = parts.find(
      (p) =>
        Math.abs(p.uCenter - 300) < 1 &&
        p.vCenter - p.lenV / 2 < 1e-3 &&
        Math.abs(p.vCenter + p.lenV / 2 - 90) < 1,
    )
    expect(sill, 'window should produce a sill piece below it').toBeTruthy()

    // And a header above the window.
    const header = parts.find(
      (p) => Math.abs(p.uCenter - 300) < 1 && p.vCenter - p.lenV / 2 >= vMax - 1e-3,
    )
    expect(header).toBeTruthy()
  })

  it('produces at least 2 side strips for an opening in the middle of the wall', () => {
    const opening: Opening = {
      id: 'o1',
      kind: 'door',
      style: 'single',
      wallId: wall.id,
      t: 0.5,
      width: 80,
      height: 200,
      sill: 0,
    }
    const parts = buildWallParts(wall, [opening], WALL_HEIGHT, THICKNESS)
    const sideStrips = parts.filter((p) => Math.abs(p.lenV - WALL_HEIGHT) < 0.1)
    expect(sideStrips.length).toBeGreaterThanOrEqual(2)
  })
})

describe('buildWallParts — stacked openings (multi-storey walls)', () => {
  const wall = deriveWalls(RECT_CORNERS)[0] // length 600
  const op = (id: string, t: number, width: number, sill: number, height: number): Opening => ({
    id, kind: 'door', style: 'passage', wallId: wall.id, t, width, height, sill,
  })

  it('a doorway with a second opening directly above it keeps BOTH holes open', () => {
    // double-height wall (580): ground doorway [0,210] + upper-storey passage [290,510]
    const parts = buildWallParts(wall, [op('lo', 0.5, 100, 0, 210), op('hi', 0.5, 100, 290, 220)], 580, THICKNESS)
    for (const p of parts) {
      expect(partOverlapsRect(p, 250, 350, 0, 210), 'ground hole').toBe(false)
      expect(partOverlapsRect(p, 250, 350, 290, 510), 'upper hole').toBe(false)
    }
    // the band between them and the header above the upper one are solid
    expect(parts.some((p) => Math.abs(p.uCenter - 300) < 1 && Math.abs(p.vCenter - 250) < 1)).toBe(true)
    expect(parts.some((p) => Math.abs(p.uCenter - 300) < 1 && Math.abs(p.vCenter - 545) < 1)).toBe(true)
  })

  it('partially overlapping stacked openings leave no solid in either hole', () => {
    const a = op('a', 0.4, 120, 0, 210) // u 180..300
    const b = op('b', 0.5, 120, 290, 110) // u 240..360
    const parts = buildWallParts(wall, [a, b], 580, THICKNESS)
    for (const p of parts) {
      expect(partOverlapsRect(p, 180, 300, 0, 210)).toBe(false)
      expect(partOverlapsRect(p, 240, 360, 290, 400)).toBe(false)
    }
    // …and the wall is otherwise closed: total solid area = wall − holes
    const area = parts.reduce((s, p) => s + p.lenU * p.lenV, 0)
    const wallArea = (600 + THICKNESS) * 580
    expect(area).toBeCloseTo(wallArea - 120 * 210 - 120 * 110, 3)
  })

  it('a plain wall is still exactly one strip', () => {
    expect(buildWallParts(wall, [], 580, THICKNESS)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// pointInPolygon — inside / outside, incl. L-shape notch
// ---------------------------------------------------------------------------

describe('pointInPolygon', () => {
  it('is true for an interior point and false for an exterior one (rectangle)', () => {
    expect(pointInPolygon({ x: 300, z: 200 }, RECT_CORNERS)).toBe(true)
    expect(pointInPolygon({ x: -10, z: 200 }, RECT_CORNERS)).toBe(false)
    expect(pointInPolygon({ x: 300, z: 500 }, RECT_CORNERS)).toBe(false)
  })

  it('treats a point in the removed L-notch as OUTSIDE', () => {
    // L preset: W=600, D=400, cutW=240, cutD=180. The removed notch is the
    // top-right rectangle x in (360, 600], z in [0, 180).
    const corners = presetCorners('l')
    // A point clearly inside the removed notch:
    expect(pointInPolygon({ x: 500, z: 80 }, corners)).toBe(false)
    // A point in the solid body is inside:
    expect(pointInPolygon({ x: 100, z: 200 }, corners)).toBe(true)
    expect(pointInPolygon({ x: 500, z: 300 }, corners)).toBe(true)
  })

  it('treats points in the T-shape removed notches as OUTSIDE', () => {
    // T preset: notchW=150, notchD=90. Bottom corners at z=D=400 are carved
    // away for x in [0,150) and x in (450,600], from z = 310 to 400.
    const corners = presetCorners('t')
    expect(pointInPolygon({ x: 50, z: 380 }, corners)).toBe(false)
    expect(pointInPolygon({ x: 550, z: 380 }, corners)).toBe(false)
    // Center stem is solid.
    expect(pointInPolygon({ x: 300, z: 380 }, corners)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// safeInteriorPoint — confirmed-inside for every preset
// ---------------------------------------------------------------------------

describe('safeInteriorPoint', () => {
  it('returns a point pointInPolygon confirms inside for all 6 presets', () => {
    expect(PRESETS).toHaveLength(6)
    for (const preset of PRESETS) {
      const corners = preset.corners()
      const p = safeInteriorPoint(corners)
      expect(
        pointInPolygon(p, corners),
        `safeInteriorPoint for "${preset.id}" must be inside`,
      ).toBe(true)
    }
  })
})
