import { describe, it, expect } from 'vitest'
import {
  planShots,
  planFlatShots,
  analyzeShot,
  nudgeClearOfObstructions,
  houseFrame,
  shotCount,
  FOV_CAP,
  NEAR_CLEAR_CM,
  type PlannerRoom,
  type HouseFrameCm,
} from './shotPlanner'
import { FLAT_2BHK, type FlatSpec } from '../data/flatTemplates'

// A plain rectangular room (no openings/furniture) unless overridden.
function room(over: Partial<PlannerRoom> = {}): PlannerRoom {
  return { name: 'Living Room', type: 'living', w: 520, l: 460, x: 260, z: 230, ...over }
}

// FlatSpec → PlannerRoom[] (the shape the shoot script feeds the planner).
function asPlannerRooms(spec: FlatSpec): PlannerRoom[] {
  return spec.map((r) => ({ name: r.name, type: r.type, w: r.w, l: r.l, x: r.x, z: r.z }))
}

describe('planShots — the rulebook', () => {
  it('emits LEVEL shots: target.y === cam.y (plumb verticals)', () => {
    for (const type of ['living', 'kitchen', 'bedroom', 'bathroom', 'dining'] as const) {
      for (const s of planShots(room({ type }))) {
        expect(s.cam[1]).toBe(s.target[1])
      }
    }
  })

  it('never tilts (unlike the 76–80°/keystoned hand-authored shots)', () => {
    // eye height in the pro 1.25–1.45 m band, and dead-level.
    for (const s of planShots(room())) {
      expect(s.cam[1]).toBeGreaterThanOrEqual(1.25)
      expect(s.cam[1]).toBeLessThanOrEqual(1.45)
      expect(Math.abs(s.cam[1] - s.target[1])).toBe(0)
    }
  })

  it('caps fov ≤ 65° (never the 76–80° of the current shots)', () => {
    const rooms: PlannerRoom[] = [
      room(),
      room({ type: 'bathroom', name: 'Bath', w: 180, l: 226, x: 90, z: 113 }), // small → widest fov
      room({ type: 'kitchen', name: 'Kitchen', w: 260, l: 230, x: 130, z: 115 }),
      room({ type: 'bedroom', name: 'BR', w: 450, l: 370, x: 225, z: 185 }),
    ]
    for (const r of rooms) {
      for (const s of planShots(r)) {
        expect(s.fov).toBeLessThanOrEqual(FOV_CAP)
        expect(s.fov).toBeGreaterThan(0)
      }
    }
  })

  it('every shot frames ≥3 walls (rejects degenerate 1-wall poses)', () => {
    const rooms: PlannerRoom[] = [
      room(),
      room({ type: 'bathroom', name: 'Bath', w: 180, l: 226, x: 90, z: 113 }),
      room({ type: 'kitchen', name: 'Kitchen', w: 260, l: 230, x: 130, z: 115 }),
      room({ type: 'bedroom', name: 'BR', w: 380, l: 320, x: 190, z: 160 }),
    ]
    for (const r of rooms) {
      const frame: HouseFrameCm = { cx: r.x, cz: r.z }
      for (const s of planShots(r, { frame })) {
        expect(analyzeShot(r, s, frame).visibleWallCount).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('shot counts per room type (2–3 living/kitchen/primary-bed, 2 bed/bath)', () => {
    expect(planShots(room({ type: 'living' })).length).toBe(3)
    expect(planShots(room({ type: 'kitchen' })).length).toBe(2)
    expect(planShots(room({ type: 'bathroom' })).length).toBe(2)
    expect(planShots(room({ type: 'bedroom' })).length).toBe(2) // standard bed
    expect(planShots(room({ type: 'bedroom' }), { isHero: true }).length).toBe(3) // primary bed
    expect(planShots(room({ type: 'hallway' })).length).toBe(1)
    // matches the shotCount helper
    expect(shotCount('living', false)).toBe(3)
    expect(shotCount('bedroom', true)).toBe(3)
  })

  it('never frames straight through a doorway', () => {
    // a room whose front wall (w2) is mostly a wide passage — the aim must dodge it.
    const r = room({
      openings: [{ kind: 'door', wallId: 'w2', t: 0.5, width: 280 }],
    })
    const frame: HouseFrameCm = { cx: r.x, cz: r.z }
    for (const s of planShots(r, { frame })) {
      expect(analyzeShot(r, s, frame).throughDoorway).toBe(false)
    }
  })

  it('hero rooms lead with a one-point (centred) composition', () => {
    const r = room({ type: 'living' })
    const frame: HouseFrameCm = { cx: r.x, cz: r.z }
    const hero = planShots(r, { isHero: true, frame })[0]
    const plain = planShots(r, { isHero: false, frame })[0]
    // one-point cam sits ~centred on its back wall; two-point is biased off-centre.
    const heroA = analyzeShot(r, hero, frame)
    const plainA = analyzeShot(r, plain, frame)
    const heroOff = Math.min(Math.abs(heroA.camHouse.x - r.x), Math.abs(heroA.camHouse.z - r.z))
    const plainOff = Math.min(Math.abs(plainA.camHouse.x - r.x), Math.abs(plainA.camHouse.z - r.z))
    expect(heroOff).toBeLessThanOrEqual(plainOff + 1e-6)
  })
})

describe('nudgeClearOfObstructions — the guard', () => {
  it('pushes a camera OUT of a foreground furniture footprint', () => {
    // a 120×120 cm piece jammed in the back-left corner (room-local 0..120).
    const r = room({ w: 400, l: 400, x: 200, z: 200, furniture: [{ x: 60, z: 60, w: 120, d: 120 }] })
    // a corner cam that lands inside the furniture+clearance zone.
    const before = { x: 40, z: 40 }
    const boxMaxX = 120
    const boxMaxZ = 120
    // sanity: it starts clipped.
    expect(before.x).toBeLessThan(boxMaxX + NEAR_CLEAR_CM)
    const after = nudgeClearOfObstructions(before, { x: r.x, z: r.z }, r)
    // pushed a full NEAR_CLEAR euclidean off the box corner (the push is diagonal
    // toward the room centre, so clearance is measured to the corner it exits).
    const dist = Math.hypot(Math.max(0, after.x - boxMaxX), Math.max(0, after.z - boxMaxZ))
    expect(after.x).toBeGreaterThan(boxMaxX) // out of the box in x
    expect(after.z).toBeGreaterThan(boxMaxZ) // out of the box in z
    expect(dist).toBeGreaterThanOrEqual(NEAR_CLEAR_CM - 6)
  })

  it('pushes a camera off a wall it sits too close to', () => {
    const r = room({ w: 400, l: 400, x: 200, z: 200 })
    const after = nudgeClearOfObstructions({ x: 5, z: 5 }, { x: r.x, z: r.z }, r)
    expect(after.x).toBeGreaterThanOrEqual(NEAR_CLEAR_CM - 6)
    expect(after.z).toBeGreaterThanOrEqual(NEAR_CLEAR_CM - 6)
  })

  it('planned shots keep the camera ≥ NEAR_CLEAR off walls + furniture', () => {
    const r = room({ furniture: [{ x: 60, z: 60, w: 140, d: 140 }, { x: 460, z: 400, w: 120, d: 120 }] })
    const frame: HouseFrameCm = { cx: r.x, cz: r.z }
    for (const s of planShots(r, { frame })) {
      const a = analyzeShot(r, s, frame)
      expect(a.minFurnitureClearCm).toBeGreaterThanOrEqual(NEAR_CLEAR_CM - 8)
    }
  })
})

describe('planFlatShots — a whole dynamic flat', () => {
  const rooms = asPlannerRooms(FLAT_2BHK)
  const shots = planFlatShots(rooms)
  const frame = houseFrame(rooms)

  it('emits per-room shots + exactly one whole-flat overview, with unique names', () => {
    const overviews = shots.filter((s) => s.name === 'overview')
    expect(overviews.length).toBe(1)
    const names = shots.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('every per-room shot is level, ≤65° fov, and frames ≥3 walls', () => {
    for (const s of shots) {
      if (s.name === 'overview') continue
      expect(s.fov).toBeLessThanOrEqual(FOV_CAP)
      expect(s.cam[1]).toBe(s.target[1])
      const r = rooms.find((rm) => rm.name === s.room)!
      expect(analyzeShot(r, s, frame).visibleWallCount).toBeGreaterThanOrEqual(3)
    }
  })

  it('the overview is the ONLY non-level (establishing) shot', () => {
    const nonLevel = shots.filter((s) => s.cam[1] !== s.target[1])
    expect(nonLevel.map((s) => s.name)).toEqual(['overview'])
  })

  it('gives the living room 3 shots and each bathroom 2', () => {
    expect(shots.filter((s) => s.room === 'Living Room').length).toBe(3)
    expect(shots.filter((s) => s.room === 'Master Bath').length).toBe(2)
    expect(shots.filter((s) => s.room === 'Common Bath').length).toBe(2)
  })
})
