import { describe, it, expect, beforeEach } from 'vitest'
import type { RoomDesign } from './interior'
import { wrapSingleRoom, addRoom, roomFromInterior } from './house'
import { findSharedWalls } from './geometry/placement'
import {
  placeConnector,
  suggestPlacement,
  connectorOpenings,
  openingsForRoom,
  wallPartsWithConnectors,
} from './connectors'
import { __resetIdCounter } from './util/id'
import { HALF_WALL_SILL, PASS_THROUGH_SILL } from './data/connectorTypes'

function makeRoom(id: string): RoomDesign {
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
    furniture: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

/** Two 600x400 rooms placed side by side; A's right wall coincides with B's left. */
function twoAdjacentRooms() {
  let house = wrapSingleRoom(makeRoom('A'), 'living')
  const aId = house.rooms[0].room_id
  const roomB = roomFromInterior(makeRoom('B'), 'kitchen', { x: 600, z: 0 })
  house = addRoom(house, roomB)
  return { house, aId, bId: roomB.room_id }
}

beforeEach(() => __resetIdCounter())

describe('C3 — shared-wall detection', () => {
  it('detects the coinciding wall pair (A.w1 ↔ B.w3)', () => {
    const { house } = twoAdjacentRooms()
    const shared = findSharedWalls(house.rooms[0], house.rooms[1])
    expect(shared.length).toBeGreaterThan(0)
    expect(shared[0]).toMatchObject({ room_a_wall: 1, room_b_wall: 3 })
    expect(shared[0].overlap_cm).toBeCloseTo(400, 0)
  })

  it('does not report a shared wall for non-touching rooms', () => {
    let house = wrapSingleRoom(makeRoom('A'), 'living')
    const far = roomFromInterior(makeRoom('B'), 'kitchen', { x: 2000, z: 2000 })
    house = addRoom(house, far)
    expect(findSharedWalls(house.rooms[0], house.rooms[1])).toHaveLength(0)
  })
})

describe('C3 — a placed connector cuts the opening in BOTH rooms', () => {
  it('suggests a centered placement on the shared wall', () => {
    const { house, aId, bId } = twoAdjacentRooms()
    const plan = suggestPlacement(house, aId, bId, 'cased_opening')
    expect(plan).not.toBeNull()
    expect(plan!.shared_wall).toEqual({ room_a_wall: 1, room_b_wall: 3 })
    expect(plan!.position_along_wall).toBeCloseTo(0.5, 5)
  })

  it('derives an opening in each room, aligned at the same physical point', () => {
    const { house, aId, bId } = twoAdjacentRooms()
    const plan = suggestPlacement(house, aId, bId, 'cased_opening')!
    const { house: h2, connector } = placeConnector(house, plan)
    expect(h2.connectors).toHaveLength(1)

    const [oa, ob] = connectorOpenings(connector, h2)
    expect(oa.room_id).toBe(aId)
    expect(oa.opening.wallId).toBe('w1')
    expect(ob.room_id).toBe(bId)
    expect(ob.opening.wallId).toBe('w3')
    // antiparallel walls: center maps to center
    expect(oa.opening.t).toBeCloseTo(0.5, 5)
    expect(ob.opening.t).toBeCloseTo(0.5, 5)
    expect(oa.opening.width).toBe(ob.opening.width)
  })

  it('opening appears in both rooms’ wall geometry (genuine join)', () => {
    const { house, aId, bId } = twoAdjacentRooms()
    const plan = suggestPlacement(house, aId, bId, 'cased_opening')!
    const { house: h2 } = placeConnector(house, plan)
    const roomA = h2.rooms.find((r) => r.room_id === aId)!
    const roomB = h2.rooms.find((r) => r.room_id === bId)!

    expect(openingsForRoom(roomA, h2).filter((o) => o.wallId === 'w1')).toHaveLength(1)
    expect(openingsForRoom(roomB, h2).filter((o) => o.wallId === 'w3')).toHaveLength(1)

    // The shared wall must have a HOLE at the opening center in each room: no
    // full-height solid part should cover it.
    const centerU = 0.5 * 400 // wall length 400 cm
    const fullHeightCovers = (parts: { uCenter: number; lenU: number; lenV: number }[]) =>
      parts.some(
        (p) =>
          p.lenV >= 269 && // full height
          centerU >= p.uCenter - p.lenU / 2 &&
          centerU <= p.uCenter + p.lenU / 2,
      )

    const aParts = wallPartsWithConnectors(roomA, h2).get(1)!
    const bParts = wallPartsWithConnectors(roomB, h2).get(3)!
    expect(fullHeightCovers(aParts)).toBe(false)
    expect(fullHeightCovers(bParts)).toBe(false)
  })

  it('hinged door gets a swing; open connectors do not', () => {
    const { house, aId, bId } = twoAdjacentRooms()
    const plan = suggestPlacement(house, aId, bId, 'hinged')!
    const { connector: door } = placeConnector(house, plan)
    expect(door.swing).not.toBeNull()
    expect(door.swing!.into_room).toBe(bId)

    const plan2 = suggestPlacement(house, aId, bId, 'archway')!
    const { connector: arch } = placeConnector(house, plan2)
    expect(arch.swing).toBeNull()
  })

  it('pass-through and half-wall cut sill-raised holes', () => {
    const { house, aId, bId } = twoAdjacentRooms()
    const pt = placeConnector(house, suggestPlacement(house, aId, bId, 'pass_through')!)
    const [poa] = connectorOpenings(pt.connector, pt.house)
    expect(poa.opening.sill).toBe(PASS_THROUGH_SILL)

    const hw = placeConnector(house, suggestPlacement(house, aId, bId, 'half_wall')!)
    const [hoa] = connectorOpenings(hw.connector, hw.house)
    expect(hoa.opening.sill).toBe(HALF_WALL_SILL)
  })
})
