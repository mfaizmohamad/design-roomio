import { describe, it, expect, beforeEach } from 'vitest'
import type { RoomDesign, FurnitureItem } from './interior'
import { wrapSingleRoom, addRoom, roomFromInterior } from './house'
import { placeConnector, suggestPlacement } from './connectors'
import { swingArc, swingHitsFurniture } from './geometry/swing'
import { __resetIdCounter } from './util/id'

function fixture(id: string, x: number, z: number, w = 60, d = 60): FurnitureItem {
  return {
    id,
    archetype: 'misc-box',
    category: 'misc',
    name: id,
    x,
    z,
    rotation: 0,
    w,
    d,
    h: 80,
    color: '#888',
  }
}

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

/** Living (A) at origin + a room B to its right, with B's furniture supplied. */
function twoRooms(bFurniture: FurnitureItem[]) {
  let house = wrapSingleRoom(makeRoom('A'), 'living')
  const aId = house.rooms[0].room_id
  const roomB = roomFromInterior(makeRoom('B', bFurniture), 'bedroom', { x: 600, z: 0 })
  house = addRoom(house, roomB)
  return { house, aId, bId: roomB.room_id }
}

beforeEach(() => __resetIdCounter())

describe('C4 — door swing arc + overlap warning (AC7)', () => {
  it('builds a swing arc for a hinged door, into the target room', () => {
    const { house, aId, bId } = twoRooms([])
    const { house: h2, connector } = placeConnector(house, suggestPlacement(house, aId, bId, 'hinged')!)
    const arc = swingArc(connector, h2)
    expect(arc).not.toBeNull()
    expect(arc!.into_room).toBe(bId)
    expect(arc!.leaves).toHaveLength(1)
    expect(arc!.leaves[0].radius).toBeGreaterThan(0)
  })

  it('warns when the swing overlaps a fixture in the target room', () => {
    // fixture parked right inside the door's quarter-circle near the hinge
    const { house, aId, bId } = twoRooms([fixture('dresser', 45, 205, 80, 50)])
    const { house: h2, connector } = placeConnector(house, suggestPlacement(house, aId, bId, 'hinged')!)
    const hits = swingHitsFurniture(connector, h2)
    expect(hits.map((h) => h.furniture_id)).toContain('dresser')
  })

  it('does not warn when the fixture is clear of the swing', () => {
    // far corner of the room, well outside an ~85 cm radius arc at the wall
    const { house, aId, bId } = twoRooms([fixture('bed', 450, 350, 150, 200)])
    const { house: h2, connector } = placeConnector(house, suggestPlacement(house, aId, bId, 'hinged')!)
    expect(swingHitsFurniture(connector, h2)).toHaveLength(0)
  })

  it('open connectors have no swing and never warn', () => {
    const { house, aId, bId } = twoRooms([fixture('dresser', 45, 205, 80, 50)])
    const { house: h2, connector } = placeConnector(house, suggestPlacement(house, aId, bId, 'archway')!)
    expect(swingArc(connector, h2)).toBeNull()
    expect(swingHitsFurniture(connector, h2)).toHaveLength(0)
  })

  it('double doors produce two leaves', () => {
    const { house, aId, bId } = twoRooms([])
    const { house: h2, connector } = placeConnector(house, suggestPlacement(house, aId, bId, 'double')!)
    expect(swingArc(connector, h2)!.leaves).toHaveLength(2)
  })
})
