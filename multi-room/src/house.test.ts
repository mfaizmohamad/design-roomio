import { describe, it, expect, beforeEach } from 'vitest'
import type { RoomDesign } from './interior'
import { wrapSingleRoom, createHouse, addRoom, roomFromInterior, moveRoom, getRoom } from './house'
import { coerceHouse, loadHouseJSON, saveHouseJSON } from './persistence'
import { __resetIdCounter } from './util/id'

/** A minimal valid RoomDesign matching Agent A's newDesign('rect'). */
function makeRoom(overrides: Partial<RoomDesign> = {}): RoomDesign {
  return {
    id: 'room_test',
    name: 'Untitled room',
    unit: 'ft',
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
    ...overrides,
  }
}

beforeEach(() => __resetIdCounter())

describe('C0/C1 — house wraps A’s room model', () => {
  it('wraps a single RoomDesign as a complete one-room house, empty connectors', () => {
    const house = wrapSingleRoom(makeRoom(), 'bedroom')
    expect(house.rooms).toHaveLength(1)
    expect(house.connectors).toEqual([])
    expect(house.rooms[0].type).toBe('bedroom')
    expect(house.rooms[0].interior.id).toBe('room_test')
    // footprint derived from the 600x400 bbox
    expect(house.rooms[0].footprint.w).toBe(600)
    expect(house.rooms[0].footprint.l).toBe(400)
  })

  it('a single bedroom stays valid (everything optional)', () => {
    const house = wrapSingleRoom(makeRoom())
    expect(house.rooms).toHaveLength(1)
    expect(house.connectors).toHaveLength(0)
    expect(house.schema_version).toBe('1.0')
  })

  it('adds and positions multiple rooms (two+ coexist)', () => {
    let house = wrapSingleRoom(makeRoom({ id: 'r1' }), 'bedroom')
    const living = roomFromInterior(makeRoom({ id: 'r2' }), 'living', { x: 600, z: 0 })
    house = addRoom(house, living)
    expect(house.rooms).toHaveLength(2)
    expect(getRoom(house, living.room_id)?.footprint.x).toBe(600)

    house = moveRoom(house, living.room_id, { x: 650, z: 10 })
    expect(getRoom(house, living.room_id)?.footprint.x).toBe(650)
    expect(getRoom(house, living.room_id)?.footprint.z).toBe(10)
  })
})

describe('C0 — backward compatibility (mandatory)', () => {
  it('loads a bare single-room RoomDesign JSON as a one-room house', () => {
    const json = JSON.stringify(makeRoom({ id: 'legacy' }))
    const house = loadHouseJSON(json)
    expect(house).not.toBeNull()
    expect(house!.rooms).toHaveLength(1)
    expect(house!.rooms[0].interior.id).toBe('legacy')
    expect(house!.connectors).toEqual([])
  })

  it("loads Agent A's localStorage design-map shape", () => {
    const map = {
      a: makeRoom({ id: 'a', updatedAt: 100 }),
      b: makeRoom({ id: 'b', updatedAt: 200 }),
    }
    const house = coerceHouse(map)
    expect(house).not.toBeNull()
    // newest (b) wins as the wrapped room
    expect(house!.rooms[0].interior.id).toBe('b')
  })

  it('round-trips a multi-room house through JSON', () => {
    let house = wrapSingleRoom(makeRoom({ id: 'r1' }), 'bedroom')
    house = addRoom(house, roomFromInterior(makeRoom({ id: 'r2' }), 'kitchen', { x: 600, z: 0 }))
    const reloaded = loadHouseJSON(saveHouseJSON(house))
    expect(reloaded).not.toBeNull()
    expect(reloaded!.rooms).toHaveLength(2)
    expect(reloaded!.rooms.map((r) => r.type)).toEqual(['bedroom', 'kitchen'])
  })

  it('rejects unrecognizable junk', () => {
    expect(coerceHouse(42)).toBeNull()
    expect(coerceHouse('nope')).toBeNull()
    expect(coerceHouse({ random: true })).toBeNull()
  })

  it('createHouse with no rooms is still a valid empty house', () => {
    const h = createHouse()
    expect(h.rooms).toEqual([])
    expect(h.connectors).toEqual([])
  })
})
