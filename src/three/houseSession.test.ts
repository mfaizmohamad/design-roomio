import { describe, it, expect } from 'vitest'
import { useHouse } from './houseSession'
import { useStore } from '../store'
import { layoutHouse } from './houseLayout'
import { bbox } from '../geometry/walls'
import { LISTING_FLATS } from '../data/listingFlats'
import { HOMES } from '../data/homes'
import { levelOf } from './houseLevels'
import type { FlatListing } from '../data/listings'

/** Minimal FlatListing for the loader tests (only id/bhk/rent/text are read). */
function mkListing(p: Partial<FlatListing> & { id: string }): FlatListing {
  return {
    postId: null, permalink: null, author: null, text: '', phones: [], rent: null,
    bhk: null, location: null, gender: null, occupancy: null, images: [], video: null,
    hasVideo: false, hasImages: false, postedAbs: null, seq: 0, ...p,
  }
}

describe('houseSession — delete room + undo', () => {
  it('removeRoom captures an undo snapshot; undoRemove restores it at its original index', () => {
    // start from a clean 3-room house
    useHouse.setState({ rooms: [], activeId: null, lastRemoved: null })
    const h = useHouse.getState()
    h.ensureInit() // seeds one room from the editor's current design
    const id1 = useHouse.getState().rooms[0].id
    const id2 = h.addRoom('kitchen')
    const id3 = h.addRoom('bedroom')
    expect(useHouse.getState().rooms.map((r) => r.id)).toEqual([id1, id2, id3])

    // delete the MIDDLE room — no confirm, instant
    useHouse.getState().removeRoom(id2)
    expect(useHouse.getState().rooms.map((r) => r.id)).toEqual([id1, id3])
    expect(useHouse.getState().lastRemoved?.entry.id).toBe(id2)
    expect(useHouse.getState().lastRemoved?.index).toBe(1)

    // UNDO restores it at index 1 and clears the snapshot
    useHouse.getState().undoRemove()
    expect(useHouse.getState().rooms.map((r) => r.id)).toEqual([id1, id2, id3])
    expect(useHouse.getState().lastRemoved).toBeNull()
  })

  it('keeps the last room (cannot delete it) and dismissUndo clears the snapshot', () => {
    useHouse.setState({ rooms: [], activeId: null, lastRemoved: null })
    const h = useHouse.getState()
    h.ensureInit()
    const only = useHouse.getState().rooms[0].id
    h.removeRoom(only)
    expect(useHouse.getState().rooms).toHaveLength(1) // never the last
    expect(useHouse.getState().lastRemoved).toBeNull()

    const id2 = h.addRoom('bathroom')
    useHouse.getState().removeRoom(id2)
    expect(useHouse.getState().lastRemoved?.entry.id).toBe(id2)
    useHouse.getState().dismissUndo()
    expect(useHouse.getState().lastRemoved).toBeNull()
  })
})

// The 3BHK must read as ONE connected house — not scattered/overlapping boxes.
describe('houseSession — 3BHK flat is one gap-free, connected floor plan', () => {
  function boxes() {
    useHouse.setState({ rooms: [], activeId: null, lastRemoved: null })
    useHouse.getState().loadFlat3BHK()
    return useHouse.getState().rooms.map((r) => {
      const bb = bbox(r.design.corners)
      return { id: r.id, name: r.design.name, minX: r.pos!.x - bb.w / 2, maxX: r.pos!.x + bb.w / 2, minZ: r.pos!.z - bb.d / 2, maxZ: r.pos!.z + bb.d / 2, w: bb.w, d: bb.d }
    })
  }

  it('loads 10 rooms that do not overlap', () => {
    const b = boxes()
    expect(b).toHaveLength(10)
    for (let i = 0; i < b.length; i++)
      for (let j = i + 1; j < b.length; j++) {
        const ix = Math.min(b[i].maxX, b[j].maxX) - Math.max(b[i].minX, b[j].minX)
        const iz = Math.min(b[i].maxZ, b[j].maxZ) - Math.max(b[i].minZ, b[j].minZ)
        expect(ix > 1 && iz > 1, `${b[i].name} overlaps ${b[j].name}`).toBe(false)
      }
  })

  it('tiles the house rectangle with NO gaps (room areas sum to the bounding area)', () => {
    const b = boxes()
    const minX = Math.min(...b.map((r) => r.minX)), maxX = Math.max(...b.map((r) => r.maxX))
    const minZ = Math.min(...b.map((r) => r.minZ)), maxZ = Math.max(...b.map((r) => r.maxZ))
    const sum = b.reduce((s, r) => s + r.w * r.d, 0)
    expect(sum).toBe((maxX - minX) * (maxZ - minZ)) // gap-free ⇒ union == bounding rect
  })

  it('layoutHouse cuts a doorway into every room — so the whole plan is reachable', () => {
    useHouse.setState({ rooms: [], activeId: null, lastRemoved: null })
    useHouse.getState().loadFlat3BHK()
    const rooms = useHouse.getState().rooms
    const placed = layoutHouse(rooms.map((r) => ({ design: r.design, pos: r.pos, type: r.type })))
    for (const p of placed)
      expect(p.extraOpenings.length, `${p.design.name} has no doorway`).toBeGreaterThan(0)
    // the hallway is the spine: it should connect to the most rooms
    const hall = placed.find((p) => p.design.name === 'Hallway')!
    expect(hall.extraOpenings.length).toBeGreaterThanOrEqual(5)
  })
})

// The MVP unlock: EVERY scraped listing opens in 3D — replicas via the untouched
// replica path, everything else via a generic furnished flat from its metadata.
describe('houseSession — loadDynamicListing (dynamic scene from metadata)', () => {
  const REPLICA_ID = '4550925665232147' // Kothrud 2BHK replica (has a unique "Dry Balcony")
  const roomNames = () => useHouse.getState().rooms.map((r) => r.design.name)

  it('a listing WITH a replica takes the replica path (never the generic 2BHK)', () => {
    expect(LISTING_FLATS[REPLICA_ID]).toBeTruthy()
    useHouse.setState({ rooms: [], activeId: null, lastRemoved: null })
    // bhk says 2BHK, but a replica exists → must load the hand-authored flat, not FLAT_2BHK
    const ok = useHouse.getState().loadDynamicListing(mkListing({ id: REPLICA_ID, bhk: '2BHK' }))
    expect(ok).toBe(true)
    const names = roomNames()
    expect(names).toContain('Dry Balcony') // unique to the replica; the generic 2BHK has none
    expect(useHouse.getState().rooms.length).toBe(LISTING_FLATS[REPLICA_ID].rooms.length)
  })

  it('a replica loads identically whether reached by id or by listing object', () => {
    useHouse.setState({ rooms: [], activeId: null, lastRemoved: null })
    useHouse.getState().loadListingFlat(REPLICA_ID)
    const viaId = roomNames()
    useHouse.setState({ rooms: [], activeId: null, lastRemoved: null })
    useHouse.getState().loadDynamicListing(mkListing({ id: REPLICA_ID, bhk: null }))
    expect(roomNames()).toEqual(viaId) // replica path unchanged — no regression
  })

  it('a listing WITHOUT a replica builds the generic template for its bhk', () => {
    useHouse.setState({ rooms: [], activeId: null, lastRemoved: null })
    const ok = useHouse.getState().loadDynamicListing(mkListing({ id: 'no-replica-2bhk', bhk: '2BHK' }))
    expect(ok).toBe(true)
    const names = roomNames()
    expect(names).not.toContain('Dry Balcony')
    expect(names).toContain('Master Bedroom')
    expect(names).toContain('Common Bath')
    // generic rooms are furnished (each got starter pieces via the §7 solver)
    const furnished = useHouse.getState().rooms.some((r) => r.design.furniture.length > 0)
    expect(furnished).toBe(true)
  })

  it('a null-bhk studio listing builds the single-room studio template', () => {
    useHouse.setState({ rooms: [], activeId: null, lastRemoved: null })
    useHouse.getState().loadDynamicListing(mkListing({ id: 'studio-x', bhk: null, text: 'cozy studio for rent' }))
    expect(roomNames()).toEqual(['Studio Room', 'Kitchen', 'Bathroom'])
  })

  it('never overlaps rooms in a generated flat (studio tiles cleanly)', () => {
    useHouse.setState({ rooms: [], activeId: null, lastRemoved: null })
    useHouse.getState().loadDynamicListing(mkListing({ id: 'studio-y', bhk: '1RK' }))
    const b = useHouse.getState().rooms.map((r) => {
      const bb = bbox(r.design.corners)
      return { minX: r.pos!.x - bb.w / 2, maxX: r.pos!.x + bb.w / 2, minZ: r.pos!.z - bb.d / 2, maxZ: r.pos!.z + bb.d / 2 }
    })
    for (let i = 0; i < b.length; i++)
      for (let j = i + 1; j < b.length; j++) {
        const ix = Math.min(b[i].maxX, b[j].maxX) - Math.max(b[i].minX, b[j].minX)
        const iz = Math.min(b[i].maxZ, b[j].maxZ) - Math.max(b[i].minZ, b[j].minZ)
        expect(ix > 1 && iz > 1).toBe(false)
      }
  })
})

// Clicking a room in the plan view must let you customize its size.
describe('houseSession — resizeRoom (plan-view room resize)', () => {
  function noOverlap() {
    const b = useHouse.getState().rooms.map((r) => {
      const bb = bbox(r.design.corners)
      return { name: r.design.name, minX: r.pos!.x - bb.w / 2, maxX: r.pos!.x + bb.w / 2, minZ: r.pos!.z - bb.d / 2, maxZ: r.pos!.z + bb.d / 2 }
    })
    for (let i = 0; i < b.length; i++)
      for (let j = i + 1; j < b.length; j++) {
        const ix = Math.min(b[i].maxX, b[j].maxX) - Math.max(b[i].minX, b[j].minX)
        const iz = Math.min(b[i].maxZ, b[j].maxZ) - Math.max(b[i].minZ, b[j].minZ)
        expect(ix > 1 && iz > 1, `${b[i].name} overlaps ${b[j].name}`).toBe(false)
      }
  }

  it('resizes a room to the requested footprint, keeping its center', () => {
    useHouse.setState({ rooms: [], activeId: null, lastRemoved: null })
    useHouse.getState().loadFlat3BHK()
    const living = useHouse.getState().rooms.find((r) => r.design.name === 'Living Room')!
    const center = { ...living.pos! }

    useHouse.getState().resizeRoom(living.id, { w: 640, l: 520 })

    const after = useHouse.getState().rooms.find((r) => r.id === living.id)!
    const bb = bbox(after.design.corners)
    expect([Math.round(bb.w), Math.round(bb.d)]).toEqual([640, 520])
    expect(after.pos).toEqual(center) // the resized room is pinned about its center
  })

  it('re-settles neighbours so no rooms overlap after enlarging one', () => {
    useHouse.setState({ rooms: [], activeId: null, lastRemoved: null })
    useHouse.getState().loadFlat3BHK()
    const master = useHouse.getState().rooms.find((r) => r.design.name === 'Master Bedroom')!
    useHouse.getState().resizeRoom(master.id, { w: 620, l: 560 }) // much bigger
    noOverlap()
  })

  it('updates the live editor store when the resized room is the ACTIVE one', () => {
    useHouse.setState({ rooms: [], activeId: null, lastRemoved: null })
    useHouse.getState().loadFlat3BHK()
    // loadFlat3BHK makes the first room (Living Room) active + loaded in useStore
    const activeId = useHouse.getState().activeId!
    useHouse.getState().resizeRoom(activeId, { w: 600, l: 480 })
    const editorBB = bbox(useStore.getState().design.corners)
    expect([Math.round(editorBB.w), Math.round(editorBB.d)]).toEqual([600, 480])
  })

  it('clamps absurdly small sizes to a usable minimum', () => {
    useHouse.setState({ rooms: [], activeId: null, lastRemoved: null })
    useHouse.getState().loadFlat3BHK()
    const bath = useHouse.getState().rooms.find((r) => r.design.name === 'Common Bath')!
    useHouse.getState().resizeRoom(bath.id, { w: 5, l: 5 })
    const bb = bbox(useHouse.getState().rooms.find((r) => r.id === bath.id)!.design.corners)
    expect(bb.w).toBeGreaterThanOrEqual(120)
    expect(bb.d).toBeGreaterThanOrEqual(120)
  })
})

describe('houseSession — loadHome (multi-storey homes from data/homes)', () => {
  it('loads EVERY storey of a home at once, each room tagged with its level', () => {
    for (const home of HOMES) {
      expect(useHouse.getState().loadHome(home.id)).toBe(true)
      const st = useHouse.getState()
      expect(st.homeId).toBe(home.id)
      expect(st.levels.map((l) => l.elevationCm)).toEqual(home.levels.map((l) => l.elevationCm))
      home.levels.forEach((lv, i) => {
        expect(st.rooms.filter((r) => levelOf(r) === i)).toHaveLength(lv.rooms.length)
      })
      // the editor holds the landing room
      expect(useStore.getState().design.id).toBe(st.activeId)
    }
  })

  it('lands on the entry storey\'s double-height living room', () => {
    useHouse.getState().loadHome('canary')
    const d = useStore.getState().design
    expect(d.name).toBe('Living & Dining')
    expect(d.wallHeight).toBe(580)
    expect(levelOf(useHouse.getState().rooms.find((r) => r.id === d.id)!)).toBe(0)
    // curated scene: no "No bed / nowhere to sit" red flags on load
    expect(d.isReplica).toBe(true)
  })

  it('unknown home → false and the house is untouched', () => {
    useHouse.getState().loadHome('sky')
    const before = useHouse.getState().rooms
    expect(useHouse.getState().loadHome('nope')).toBe(false)
    expect(useHouse.getState().rooms).toBe(before)
  })

  it('any other flat load clears the home and its storeys', () => {
    useHouse.getState().loadHome('sky')
    useHouse.getState().loadFlat2BHK()
    expect(useHouse.getState().homeId).toBeNull()
    expect(useHouse.getState().levels).toEqual([])
    useHouse.getState().loadHome('sky')
    useHouse.getState().loadListingFlat(Object.keys(LISTING_FLATS)[0])
    expect(useHouse.getState().homeId).toBeNull()
    expect(useHouse.getState().rooms.every((r) => levelOf(r) === 0)).toBe(true)
  })

  it('a room added while working upstairs joins the upper storey', () => {
    useHouse.getState().loadHome('canary')
    const upstairs = useHouse.getState().rooms.find((r) => levelOf(r) === 1)!
    useHouse.getState().switchRoom(upstairs.id)
    const id = useHouse.getState().addRoom('office')
    expect(levelOf(useHouse.getState().rooms.find((r) => r.id === id)!)).toBe(1)
  })

  it('dragging an upstairs room never shoves the rooms of the storey below', () => {
    useHouse.getState().loadHome('canary')
    const before = new Map(useHouse.getState().rooms.filter((r) => levelOf(r) === 0).map((r) => [r.id, r.pos]))
    const up = useHouse.getState().rooms.find((r) => levelOf(r) === 1 && r.design.name === 'Bedroom 3')!
    useHouse.getState().moveRoom(up.id, { x: up.pos!.x + 40, z: up.pos!.z })
    // moveRoom rounds every centre to whole cm (so a .5 centre may shift 0.5);
    // a real same-storey push would move a room by tens of cm
    for (const r of useHouse.getState().rooms.filter((x) => levelOf(x) === 0)) {
      const b = before.get(r.id)!
      expect(Math.abs(r.pos!.x - b.x) + Math.abs(r.pos!.z - b.z), r.design.name).toBeLessThanOrEqual(1)
    }
  })
})

describe('houseSession — authored furniture positions survive loading', () => {
  // addFurniture places at CATALOG size and nudges to fit; the authored size is
  // applied after. A stair authored smaller than its catalog default used to be
  // left ~30cm off its stairwell — which stranded a walker at the top.
  it('every resized piece in every home sits exactly where the plan puts it', () => {
    for (const home of HOMES) {
      useHouse.getState().loadHome(home.id)
      useHouse.getState().syncActive()
      const rooms = useHouse.getState().rooms
      home.levels.forEach((lv, level) => {
        for (const spec of lv.rooms) {
          const entry = rooms.find((r) => r.design.name === spec.name && levelOf(r) === level)!
          for (const f of spec.furniture.filter((x) => x.w || x.d)) {
            const hit = entry.design.furniture.some(
              (g) => g.archetype === f.a && Math.abs(g.x - f.x) < 1 && Math.abs(g.z - f.z) < 1,
            )
            expect(hit, `${home.id}/${spec.name}: ${f.a} moved off (${f.x}, ${f.z})`).toBe(true)
          }
        }
      })
    }
  })
})
