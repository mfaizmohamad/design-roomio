/**
 * Acceptance — the brief's "done bar" as one end-to-end scenario:
 *   single bedroom works untouched → add a living room joined by a cased opening
 *   (both rooms open) → add a kitchen offering work-triangle guidance → an archway
 *   into a bathroom triggers a dismissible privacy warning → connect living↔dining
 *   via an archway → a door whose swing hits a fixture warns → save/reload the
 *   multi-room house AND an old single-room file still opens.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { RoomDesign, FurnitureItem } from './interior'
import { wrapSingleRoom, addRoom, roomFromInterior } from './house'
import { placeConnector, suggestPlacement, openingsForRoom } from './connectors'
import { evaluateAdjacency } from './adjacency'
import { kitchenGuidance } from './kitchen'
import { essentialsFor, missingAssetsFor } from './data/roomTypes'
import { loadHouseJSON, saveHouseJSON } from './persistence'
import { __resetIdCounter } from './util/id'

function bedroom(): RoomDesign {
  return {
    id: 'legacy-bedroom',
    name: 'My bedroom',
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
    materials: { wallColor: '#eee', floorTexture: 'oak' },
    furniture: [],
    createdAt: 100,
    updatedAt: 100,
  }
}

function rect(id: string, furniture: FurnitureItem[] = []): RoomDesign {
  return { ...bedroom(), id, name: id, furniture }
}

beforeEach(() => __resetIdCounter())

describe('Acceptance — the full multi-room scenario', () => {
  it('runs the whole done-bar end to end', () => {
    // 1) single bedroom still works untouched
    let house = wrapSingleRoom(bedroom(), 'bedroom')
    const bedId = house.rooms[0].room_id
    expect(house.rooms).toHaveLength(1)
    expect(house.connectors).toHaveLength(0)

    // 2) add a living room beside it + a cased opening → both rooms open
    const living = roomFromInterior(rect('Living'), 'living', { x: 600, z: 0 })
    house = addRoom(house, living)
    const cased = placeConnector(house, suggestPlacement(house, bedId, living.room_id, 'cased_opening')!)
    house = cased.house
    const bedRoom = house.rooms.find((r) => r.room_id === bedId)!
    const livingRoom = house.rooms.find((r) => r.room_id === living.room_id)!
    expect(openingsForRoom(bedRoom, house).length).toBe(1) // hole cut in bedroom
    expect(openingsForRoom(livingRoom, house).length).toBe(1) // and in living
    // bedroom + open connector → dismissible AC4 privacy nudge (never blocks)
    expect(evaluateAdjacency(house).some((s) => s.rule === 'AC4')).toBe(true)

    // 3) add a kitchen; it offers work-triangle guidance + fixture essentials
    const kitchen = roomFromInterior(rect('Kitchen'), 'kitchen', { x: 1200, z: 0 })
    house = addRoom(house, kitchen)
    const kg = kitchenGuidance(house.rooms.find((r) => r.room_id === kitchen.room_id)!)
    expect(kg.guidance.join(' ')).toMatch(/work triangle/i)
    expect(essentialsFor('kitchen').length).toBeGreaterThan(0)
    expect(missingAssetsFor('kitchen').length).toBe(0) // fixtures now modeled (counter/sink/stove/fridge/island)

    // 4) archway into a bathroom → dismissible privacy warning (AC1)
    const bath = roomFromInterior(rect('Bathroom'), 'bathroom', { x: 0, z: 400 })
    house = addRoom(house, bath)
    const arch = placeConnector(house, suggestPlacement(house, bedId, bath.room_id, 'archway')!)
    house = arch.house
    const ac1 = evaluateAdjacency(house).find((s) => s.rule === 'AC1' && s.severity === 'warn')
    expect(ac1).toBeDefined()
    expect(ac1!.dismissible).toBe(true)

    // 5) add a dining room + connect living↔dining via an archway
    const dining = roomFromInterior(rect('Dining'), 'dining', { x: 600, z: 400 })
    house = addRoom(house, dining)
    const livingDining = placeConnector(
      house,
      suggestPlacement(house, living.room_id, dining.room_id, 'archway')!,
    )
    house = livingDining.house
    expect(house.connectors.some((c) => c.type === 'archway' && c.between.includes(dining.room_id))).toBe(true)

    // 6) a door whose swing hits a fixture warns (AC7)
    //    hinged door living↔kitchen, swinging into kitchen onto a parked box
    const kitchenWithBox = house.rooms.find((r) => r.room_id === kitchen.room_id)!
    kitchenWithBox.interior.furniture = [
      {
        id: 'box',
        archetype: 'misc-box',
        category: 'misc',
        name: 'Fridge',
        x: 45,
        z: 205,
        rotation: 0,
        w: 80,
        d: 70,
        h: 180,
        color: '#999',
      },
    ]
    const door = placeConnector(house, suggestPlacement(house, living.room_id, kitchen.room_id, 'hinged')!)
    house = door.house
    expect(evaluateAdjacency(house).some((s) => s.rule === 'AC7' && s.severity === 'warn')).toBe(true)

    // 7) save + reload the whole multi-room house
    const reloaded = loadHouseJSON(saveHouseJSON(house))
    expect(reloaded).not.toBeNull()
    expect(reloaded!.rooms).toHaveLength(5)
    expect(reloaded!.connectors.length).toBe(house.connectors.length)
    expect(reloaded!.rooms.map((r) => r.type).sort()).toEqual(
      ['bathroom', 'bedroom', 'dining', 'kitchen', 'living'].sort(),
    )

    // …and an OLD single-room file still opens (backward compat)
    const legacy = loadHouseJSON(JSON.stringify(bedroom()))
    expect(legacy).not.toBeNull()
    expect(legacy!.rooms).toHaveLength(1)
    expect(legacy!.connectors).toEqual([])
    expect(legacy!.rooms[0].interior.id).toBe('legacy-bedroom')
  })
})
