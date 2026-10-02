import { describe, it, expect } from 'vitest'
import {
  DESIGN_DEFAULTS,
  FURNITURE_PLAN,
  defaultFurnitureFor,
  buildSceneFromListing,
  rotationFor,
  FLAT_STUDIO,
  FLAT_1BHK,
  FLAT_2BHK,
  FLAT_3BHK,
  type FlatSpec,
} from './flatTemplates'
import { ARCHETYPE_MAP } from './archetypes'
import { FLOOR_MAP } from './materials'
import { ROOM_TYPES } from '../../multi-room/src/index'
import { deriveWalls } from '../geometry/walls'
import type { Opening } from '../types'

const FLATS: Array<[string, FlatSpec]> = [
  ['STUDIO', FLAT_STUDIO],
  ['1BHK', FLAT_1BHK],
  ['2BHK', FLAT_2BHK],
  ['3BHK', FLAT_3BHK],
]

describe('flat template design defaults — id integrity', () => {
  it('every per-type floor id is a real FLOOR_TEXTURES id', () => {
    for (const [type, dd] of Object.entries(DESIGN_DEFAULTS)) {
      expect(FLOOR_MAP[dd!.floor], `floor '${dd!.floor}' for ${type}`).toBeTruthy()
    }
  })

  it('every per-type wall color is a hex string', () => {
    for (const [type, dd] of Object.entries(DESIGN_DEFAULTS)) {
      expect(dd!.wall, `wall for ${type}`).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('every starter-furniture archetype id is a real catalog id', () => {
    for (const [type, plan] of Object.entries(FURNITURE_PLAN)) {
      for (const p of plan!) {
        expect(ARCHETYPE_MAP[p.a], `archetype '${p.a}' for ${type}`).toBeTruthy()
      }
    }
  })

  it('DESIGN_DEFAULTS + FURNITURE_PLAN only key real RoomTypes', () => {
    for (const t of Object.keys(DESIGN_DEFAULTS)) expect(ROOM_TYPES).toContain(t)
    for (const t of Object.keys(FURNITURE_PLAN)) expect(ROOM_TYPES).toContain(t)
  })
})

describe('flat template layouts — geometry', () => {
  for (const [name, spec] of FLATS) {
    it(`${name}: every room type is real + has a name and positive size`, () => {
      expect(spec.length).toBeGreaterThan(0)
      for (const r of spec) {
        expect(ROOM_TYPES, `${name} room '${r.name}' type`).toContain(r.type)
        expect(r.name.length).toBeGreaterThan(0)
        expect(r.w).toBeGreaterThan(0)
        expect(r.l).toBeGreaterThan(0)
      }
    })

    it(`${name}: rooms do not OVERLAP (axis-aligned rects from bbox-center + size)`, () => {
      const rects = spec.map((r) => ({
        name: r.name,
        x0: r.x - r.w / 2,
        x1: r.x + r.w / 2,
        z0: r.z - r.l / 2,
        z1: r.z + r.l / 2,
      }))
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i], b = rects[j]
          // overlap iff they intersect on BOTH axes with a real area (touching edges are OK)
          const EPS = 1
          const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
          const overlapZ = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0)
          const overlaps = overlapX > EPS && overlapZ > EPS
          expect(overlaps, `${name}: '${a.name}' overlaps '${b.name}'`).toBe(false)
        }
      }
    })

    it(`${name}: rooms TILE their bounding rectangle with no gaps (areas sum to the bbox area)`, () => {
      const minX = Math.min(...spec.map((r) => r.x - r.w / 2))
      const maxX = Math.max(...spec.map((r) => r.x + r.w / 2))
      const minZ = Math.min(...spec.map((r) => r.z - r.l / 2))
      const maxZ = Math.max(...spec.map((r) => r.z + r.l / 2))
      const bboxArea = (maxX - minX) * (maxZ - minZ)
      const sumArea = spec.reduce((s, r) => s + r.w * r.l, 0)
      // no overlaps (asserted above) + areas equal ⇒ a perfect gapless tiling
      expect(sumArea).toBeCloseTo(bboxArea, -2) // within ~1% at this scale
    })
  }
})

describe('defaultFurnitureFor', () => {
  const corners = [
    { x: 0, z: 0 },
    { x: 400, z: 0 },
    { x: 400, z: 300 },
    { x: 0, z: 300 },
  ]

  it('kitchen gets counter + sink + stove (reads as a kitchen)', () => {
    const ids = defaultFurnitureFor('kitchen', corners).map((f) => f.archetype)
    expect(ids).toContain('kitchen-counter')
    expect(ids).toContain('kitchen-sink')
    expect(ids).toContain('kitchen-stove')
  })

  it('bathroom gets a toilet (commode) + vanity + shower', () => {
    const ids = defaultFurnitureFor('bathroom', corners).map((f) => f.archetype)
    expect(ids).toContain('bath-toilet')
    expect(ids).toContain('bath-vanity')
    expect(ids).toContain('bath-shower')
  })

  it('places every seed inside the room bbox', () => {
    for (const t of ['living', 'bedroom', 'kitchen', 'bathroom', 'dining'] as const) {
      for (const f of defaultFurnitureFor(t, corners)) {
        expect(f.x).toBeGreaterThanOrEqual(0)
        expect(f.x).toBeLessThanOrEqual(400)
        expect(f.z).toBeGreaterThanOrEqual(0)
        expect(f.z).toBeLessThanOrEqual(300)
      }
    }
  })

  it('unknown/empty types return no furniture (never throws)', () => {
    expect(defaultFurnitureFor('hallway', corners)).toEqual([])
  })

  it('every seed carries a numeric rotation', () => {
    for (const f of defaultFurnitureFor('living', corners)) {
      expect(Number.isFinite(f.rotation)).toBe(true)
    }
  })
})

describe('defaultFurnitureFor — orientation + door clearance', () => {
  const corners = [
    { x: 0, z: 0 },
    { x: 400, z: 0 },
    { x: 400, z: 300 },
    { x: 0, z: 300 },
  ]
  const center = { x: 200, z: 150 }

  it('backs wall pieces onto their wall facing INTO the room (not facing the wall)', () => {
    expect(rotationFor('-z', 'front', { x: 200, z: 255 }, center)).toBeCloseTo(Math.PI) // +Z wall → faces -Z
    expect(rotationFor('+z', 'back', { x: 200, z: 45 }, center)).toBeCloseTo(0) // -Z wall → faces +Z
    expect(rotationFor('in', 'left', { x: 45, z: 150 }, center)).toBeCloseTo(Math.PI / 2) // -X wall → faces +X
    expect(rotationFor('in', 'right', { x: 355, z: 150 }, center)).toBeCloseTo((3 * Math.PI) / 2) // +X wall → faces -X
  })

  it('the living-room sofa BACKS onto its wall (rotation ~π), not facing it (rotation 0)', () => {
    const sofa = defaultFurnitureFor('living', corners).find((f) => f.archetype === 'sofa-3')!
    expect(sofa).toBeTruthy()
    expect(sofa.rotation).toBeCloseTo(Math.PI)
  })

  it('dining chairs face the table (the room centre)', () => {
    const chairs = defaultFurnitureFor('dining', corners).filter((f) => f.archetype === 'chair-dining')
    const nearBack = chairs.reduce((m, c) => (c.z < m.z ? c : m)) // -Z side chair
    expect(nearBack.rotation).toBeCloseTo(0) // faces +Z toward the table
  })

  it('nudges a back-wall piece off a centred doorway so nothing blocks the door', () => {
    const walls = deriveWalls(corners) // wall 0 = the z=0 (back) wall
    const door: Opening = { id: 'd', kind: 'door', style: 'single', wallId: walls[0].id, t: 0.5, width: 90, height: 210, sill: 0 }
    const tvNoDoor = defaultFurnitureFor('living', corners).find((f) => f.archetype === 'storage-tv')!
    const tvWithDoor = defaultFurnitureFor('living', corners, [door]).find((f) => f.archetype === 'storage-tv')!
    // without a door the media unit sits at the wall centre (x≈200); with a centred door it is pushed aside.
    expect(Math.abs(tvWithDoor.x - 200)).toBeGreaterThan(Math.abs(tvNoDoor.x - 200) + 20)
  })
})

// The dynamic-scene unlock: ANY scraped listing must resolve to a real, furnishable
// FlatSpec — even with a null/garbage bhk. buildSceneFromListing is pure + total.
describe('buildSceneFromListing — listing metadata → FlatSpec', () => {
  it('maps every canonical bhk value to the right template', () => {
    expect(buildSceneFromListing({ bhk: '1BHK' })).toBe(FLAT_1BHK)
    expect(buildSceneFromListing({ bhk: '2BHK' })).toBe(FLAT_2BHK)
    expect(buildSceneFromListing({ bhk: '3BHK' })).toBe(FLAT_3BHK)
    // every "*RK" (room-kitchen, no separate hall) + studio → the studio unit
    expect(buildSceneFromListing({ bhk: '1RK' })).toBe(FLAT_STUDIO)
    expect(buildSceneFromListing({ bhk: '3RK' })).toBe(FLAT_STUDIO)
    expect(buildSceneFromListing({ bhk: 'Studio' })).toBe(FLAT_STUDIO)
  })

  it('tolerates casing / whitespace / 4+ BHK', () => {
    expect(buildSceneFromListing({ bhk: ' 2 bhk ' })).toBe(FLAT_2BHK)
    expect(buildSceneFromListing({ bhk: '4BHK' })).toBe(FLAT_3BHK) // biggest template we have
  })

  it('falls back to post-text keywords when bhk is null', () => {
    expect(buildSceneFromListing({ bhk: null, text: 'Spacious 2 BHK flat near metro' })).toBe(FLAT_2BHK)
    expect(buildSceneFromListing({ bhk: null, text: 'cozy studio apartment' })).toBe(FLAT_STUDIO)
    expect(buildSceneFromListing({ bhk: null, text: 'available 1 rk on rent' })).toBe(FLAT_STUDIO)
    expect(buildSceneFromListing({ bhk: null, text: 'brand new 3 bhk with parking' })).toBe(FLAT_3BHK)
  })

  it('falls back to a rent tier when neither bhk nor keywords are present', () => {
    expect(buildSceneFromListing({ bhk: null, text: 'call for details', rent: 90000 })).toBe(FLAT_3BHK)
    expect(buildSceneFromListing({ bhk: null, text: 'call for details', rent: 50000 })).toBe(FLAT_2BHK)
    expect(buildSceneFromListing({ bhk: null, text: 'call for details', rent: 15000 })).toBe(FLAT_1BHK)
  })

  it('defaults to 1BHK for a fully unknown listing (never throws, never empty)', () => {
    for (const listing of [{}, { bhk: null }, { bhk: '' }, { bhk: 'penthouse?!' }, { bhk: null, text: '' }]) {
      const spec = buildSceneFromListing(listing)
      expect(spec).toBe(FLAT_1BHK)
    }
  })

  it('the explicit bhk field wins over conflicting text', () => {
    expect(buildSceneFromListing({ bhk: '1BHK', text: 'huge 3 bhk mansion' })).toBe(FLAT_1BHK)
  })

  it('every possible result is a valid non-empty flat (real types + positive size)', () => {
    const inputs = [
      { bhk: '1RK' }, { bhk: '1BHK' }, { bhk: '2BHK' }, { bhk: '3BHK' }, { bhk: '3RK' },
      { bhk: null }, { bhk: 'weird', rent: 99999 }, {},
    ]
    for (const input of inputs) {
      const spec = buildSceneFromListing(input)
      expect(spec.length).toBeGreaterThan(0)
      for (const r of spec) {
        expect(ROOM_TYPES).toContain(r.type)
        expect(r.w).toBeGreaterThan(0)
        expect(r.l).toBeGreaterThan(0)
      }
    }
  })
})
