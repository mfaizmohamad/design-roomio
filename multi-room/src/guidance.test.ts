import { describe, it, expect } from 'vitest'
import type { FurnitureItem, RoomDesign } from './interior'
import { roomFromInterior } from './house'
import {
  evaluateWorkTriangle,
  islandFits,
  findTriangleFixtures,
  kitchenGuidance,
  ISLAND_MIN_ROOM_WIDTH,
} from './kitchen'
import {
  clearanceZone,
  checkFixtureClearance,
  bathroomGuidance,
  FIXTURE_FRONT_CLEARANCE,
} from './bathroom'

function fx(id: string, name: string, x: number, z: number, w = 60, d = 60, rotation = 0): FurnitureItem {
  return { id, archetype: 'misc-box', category: 'misc', name, x, z, rotation, w, d, h: 80, color: '#888' }
}

function room(id: string, furniture: FurnitureItem[], w = 400, l = 400): RoomDesign {
  return {
    id,
    name: id,
    unit: 'cm',
    shape: 'rect',
    corners: [
      { x: 0, z: 0 },
      { x: w, z: 0 },
      { x: w, z: l },
      { x: 0, z: l },
    ],
    wallHeight: 270,
    wallThickness: 12,
    openings: [],
    materials: { wallColor: '#ddd', floorTexture: 'tile' },
    furniture,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('C6 — kitchen work-triangle guidance', () => {
  it('accepts a well-proportioned triangle', () => {
    const r = evaluateWorkTriangle({ x: 0, z: 0 }, { x: 180, z: 0 }, { x: 180, z: 180 })
    expect(r.ok).toBe(true)
    expect(r.warnings).toHaveLength(0)
    expect(r.total).toBeCloseTo(180 + 180 + Math.hypot(180, 180), 1)
  })

  it('warns on a cramped triangle (legs + perimeter too small)', () => {
    const r = evaluateWorkTriangle({ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 0, z: 50 })
    expect(r.ok).toBe(false)
    expect(r.warnings.join(' ')).toMatch(/leg|perimeter/i)
  })

  it('warns on a too-spread triangle', () => {
    const r = evaluateWorkTriangle({ x: 0, z: 0 }, { x: 300, z: 0 }, { x: 300, z: 300 })
    expect(r.warnings.join(' ')).toMatch(/long|spread/i)
  })

  it('gates an island on room width (≥366 cm)', () => {
    expect(islandFits(ISLAND_MIN_ROOM_WIDTH + 10).fits).toBe(true)
    expect(islandFits(300).fits).toBe(false)
  })

  it('finds labeled sink/stove/fridge and evaluates live', () => {
    const furniture = [
      fx('s', 'Kitchen Sink', 0, 0),
      fx('c', 'Gas Stove', 180, 0),
      fx('f', 'Refrigerator', 180, 180),
    ]
    const found = findTriangleFixtures(furniture)
    expect(found.sink && found.stove && found.fridge).toBeTruthy()
    const g = kitchenGuidance(roomFromInterior(room('k', furniture, 400, 400), 'kitchen'))
    expect(g.triangle).toBeDefined()
    expect(g.triangle!.ok).toBe(true)
    expect(g.island.fits).toBe(true)
    expect(g.guidance.join(' ')).toMatch(/work triangle/i)
  })

  it('omits the triangle when fixtures are not labeled', () => {
    const g = kitchenGuidance(roomFromInterior(room('k', [fx('x', 'Placeholder Box', 0, 0)], 300), 'kitchen'))
    expect(g.triangle).toBeUndefined()
    expect(g.island.fits).toBe(false)
  })
})

describe('C6 — bathroom clearance guidance', () => {
  it('builds a clearance zone in front of a fixture (along its facing normal)', () => {
    const toilet = fx('t', 'Toilet', 100, 50, 60, 70, 0) // faces +z
    const zone = clearanceZone(toilet)
    expect(zone.cz).toBeCloseTo(50 + 70 / 2 + FIXTURE_FRONT_CLEARANCE / 2, 5)
    expect(zone.cx).toBeCloseTo(100, 5)
    expect(zone.w).toBe(60)
  })

  it('warns when something blocks the clear-floor space in front of a fixture', () => {
    const toilet = fx('t', 'Toilet', 100, 50, 60, 70, 0)
    const blocker = fx('b', 'Cabinet', 100, 50 + 70 / 2 + 20, 60, 30, 0) // sits in the zone
    const res = checkFixtureClearance(toilet, [toilet, blocker])
    expect(res.ok).toBe(false)
    expect(res.blockedBy).toContain('Cabinet')
  })

  it('passes when the clear-floor space is free', () => {
    const toilet = fx('t', 'Toilet', 100, 50, 60, 70, 0)
    const far = fx('b', 'Shelf', 350, 350, 40, 30, 0)
    const res = checkFixtureClearance(toilet, [toilet, far])
    expect(res.ok).toBe(true)
  })

  it('bathroomGuidance evaluates clearance for labeled fixtures', () => {
    const toilet = fx('t', 'Toilet', 100, 50, 60, 70, 0)
    const sink = fx('s', 'Vanity Sink', 250, 50, 70, 50, 0)
    const g = bathroomGuidance(roomFromInterior(room('bath', [toilet, sink], 350, 250), 'bathroom'))
    expect(g.clearances).toHaveLength(2)
    expect(g.guidance.join(' ')).toMatch(/clearance|privacy/i)
  })
})
