import { describe, it, expect, beforeEach } from 'vitest'
import type { RoomDesign, FurnitureItem } from './interior'
import type { RoomType } from './types'
import { wrapSingleRoom, addRoom, roomFromInterior } from './house'
import { placeConnector, suggestPlacement } from './connectors'
import { evaluateAdjacency } from './adjacency'
import { __resetIdCounter } from './util/id'

function makeRoom(id: string, furniture: FurnitureItem[] = []): RoomDesign {
  return {
    id,
    name: id,
    unit: 'cm',
    shape: 'rect',
    corners: [
      { x: 0, z: 0 },
      { x: 600, z: 0 },
      { x: 600, z: 400 },
      { x: 0, z: 400 },
    ],
    wallHeight: 270,
    wallThickness: 12,
    openings: [],
    materials: { wallColor: '#ddd', floorTexture: 'oak' },
    furniture,
    createdAt: 1,
    updatedAt: 1,
  }
}

/** A: type at origin; B: type to the right; returns ids. */
function pair(typeA: RoomType, typeB: RoomType, bFurniture: FurnitureItem[] = []) {
  let house = wrapSingleRoom(makeRoom('A'), typeA)
  const aId = house.rooms[0].room_id
  const roomB = roomFromInterior(makeRoom('B', bFurniture), typeB, { x: 600, z: 0 })
  house = addRoom(house, roomB)
  return { house, aId, bId: roomB.room_id }
}

beforeEach(() => __resetIdCounter())

describe('C5 — adjacency suggestions (AC1–AC9), all dismissible', () => {
  it('every suggestion is dismissible (never a block)', () => {
    const { house } = pair('living', 'dining')
    const all = evaluateAdjacency(house)
    expect(all.length).toBeGreaterThan(0)
    expect(all.every((s) => s.dismissible === true)).toBe(true)
  })

  it('AC1 — an archway into a bathroom warns (privacy)', () => {
    const { house, aId, bId } = pair('living', 'bathroom')
    const { house: h2 } = placeConnector(house, suggestPlacement(house, aId, bId, 'archway')!)
    const acs = evaluateAdjacency(h2).filter((s) => s.rule === 'AC1')
    expect(acs).toHaveLength(1)
    expect(acs[0].severity).toBe('warn')
    expect(acs[0].suggestedTypes).toEqual(['hinged', 'pocket'])
  })

  it('AC1 — a hinged door into a bathroom does NOT warn', () => {
    const { house, aId, bId } = pair('living', 'bathroom')
    const { house: h2 } = placeConnector(house, suggestPlacement(house, aId, bId, 'hinged')!)
    expect(evaluateAdjacency(h2).filter((s) => s.rule === 'AC1' && s.severity === 'warn')).toHaveLength(0)
  })

  it('AC4 — an open connector into a bedroom warns', () => {
    const { house, aId, bId } = pair('living', 'bedroom')
    const { house: h2 } = placeConnector(house, suggestPlacement(house, aId, bId, 'cased_opening')!)
    expect(evaluateAdjacency(h2).some((s) => s.rule === 'AC4' && s.severity === 'warn')).toBe(true)
  })

  it('AC2 — kitchen↔dining (unconnected) suggests an open connector', () => {
    const { house } = pair('kitchen', 'dining')
    const s = evaluateAdjacency(house).find((x) => x.rule === 'AC2')
    expect(s).toBeDefined()
    expect(s!.suggestedTypes).toContain('pass_through')
  })

  it('AC3 — living↔dining (unconnected) suggests archway/wide/half-wall', () => {
    const { house } = pair('living', 'dining')
    const s = evaluateAdjacency(house).find((x) => x.rule === 'AC3')
    expect(s).toBeDefined()
    expect(s!.suggestedTypes).toEqual(['archway', 'wide_opening', 'half_wall'])
  })

  it('AC5 — foyer↔living (unconnected) suggests archway/cased opening', () => {
    const { house } = pair('foyer', 'living')
    const s = evaluateAdjacency(house).find((x) => x.rule === 'AC5')
    expect(s).toBeDefined()
    expect(s!.suggestedTypes).toEqual(['archway', 'cased_opening'])
  })

  it('AC8 — two adjacent generic rooms with no connector suggests adding one', () => {
    const { house } = pair('office', 'office')
    expect(evaluateAdjacency(house).some((s) => s.rule === 'AC8')).toBe(true)
  })

  it('AC9 — a too-narrow connector suggests widening', () => {
    const { house, aId, bId } = pair('living', 'dining')
    const plan = suggestPlacement(house, aId, bId, 'cased_opening')!
    const { house: h2 } = placeConnector(house, { ...plan, width_cm: 60 })
    const s = evaluateAdjacency(h2).find((x) => x.rule === 'AC9')
    expect(s).toBeDefined()
    expect(s!.message).toMatch(/60 cm/)
  })

  it('AC7 — a door swing hitting a fixture warns', () => {
    const dresser: FurnitureItem = {
      id: 'dresser',
      archetype: 'misc-box',
      category: 'misc',
      name: 'Dresser',
      x: 45,
      z: 205,
      rotation: 0,
      w: 80,
      d: 50,
      h: 80,
      color: '#888',
    }
    const { house, aId, bId } = pair('living', 'bedroom', [dresser])
    const { house: h2 } = placeConnector(house, suggestPlacement(house, aId, bId, 'hinged')!)
    const s = evaluateAdjacency(h2).find((x) => x.rule === 'AC7')
    expect(s).toBeDefined()
    expect(s!.message).toMatch(/Dresser/)
  })

  it('AC6 — a room branching to 3+ rooms with no hallway suggests a hallway', () => {
    // center room adjacent to left, right, top
    let house = wrapSingleRoom(makeRoom('center'), 'living')
    house = { ...house, rooms: [{ ...house.rooms[0], footprint: { ...house.rooms[0].footprint, x: 600, z: 0 } }] }
    house = addRoom(house, roomFromInterior(makeRoom('left'), 'bedroom', { x: 0, z: 0 }))
    house = addRoom(house, roomFromInterior(makeRoom('right'), 'office', { x: 1200, z: 0 }))
    house = addRoom(house, roomFromInterior(makeRoom('top'), 'dining', { x: 600, z: -400 }))
    const s = evaluateAdjacency(house).find((x) => x.rule === 'AC6')
    expect(s).toBeDefined()
    expect(s!.suggestedTypes).toEqual(['hallway_link'])
  })

  it('a single bedroom (no neighbours) produces no suggestions', () => {
    const house = wrapSingleRoom(makeRoom('only'), 'bedroom')
    expect(evaluateAdjacency(house)).toHaveLength(0)
  })
})
