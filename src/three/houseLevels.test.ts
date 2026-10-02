import { describe, it, expect } from 'vitest'
import { levelOf, elevationOfLevel, focusLevel, placementsFor, activeLevel, visiblePlacements } from './houseLevels'
import { toggleId } from './houseViewMode'
import { newDesign } from '../store'

describe('houseLevels', () => {
  it('a room with no level is on the ground floor (every pre-storey flat is unchanged)', () => {
    expect(levelOf({})).toBe(0)
    expect(levelOf({ level: 2 })).toBe(2)
  })

  it('elevation comes from the level table; an undescribed level sits at 0', () => {
    const levels = [
      { label: 'G', elevationCm: 0 },
      { label: 'F1', elevationCm: 300 },
    ]
    expect(elevationOfLevel(levels, 1)).toBe(300)
    expect(elevationOfLevel([], 1)).toBe(0)
  })

  it('planar surfaces follow the isolated storey, else the active room\'s', () => {
    expect(focusLevel('all', 1)).toBe(1)
    expect(focusLevel(0, 1)).toBe(0)
  })

  it('placementsFor merges the live design, tags storeys and filters one on request', () => {
    const g = newDesign('rect')
    const u = newDesign('rect')
    const live = { ...u, name: 'LIVE' }
    const s = {
      rooms: [
        { id: g.id, design: g, type: 'living' },
        { id: u.id, design: u, type: 'bedroom', level: 1 },
      ],
      activeId: u.id,
      levels: [
        { label: 'G', elevationCm: 0 },
        { label: 'F1', elevationCm: 290 },
      ],
    }
    const all = placementsFor(s, live)
    expect(all.map((p) => [p.level, p.elevationCm])).toEqual([[0, 0], [1, 290]])
    expect(all[1].design.name).toBe('LIVE') // the editor owns the active room
    expect(placementsFor(s, live, 1).map((p) => p.design.id)).toEqual([u.id])
    expect(activeLevel(s)).toBe(1)
  })
})

import { useHouse } from './houseSession'
import { useStore } from '../store'
import { layoutHouse, houseColliders } from './houseLayout'
import { storeyColliderPlacements, floorHeightAt, levelAtFloor, stairSurfaceCm } from './houseLevels'
import { HOMES } from '../data/homes'
import { resolveWalk } from '../../camera-flythrough/src/engine/collision'

// The user-facing bug: "I can't go up the stairs to the first floor". These walk
// the real homes the way FirstPersonWalk does — small steps, the floor follows
// floorHeightAt, a step changing the floor by > 45cm is refused, walls come from
// the storey you are on — and require arriving on the upper storey.

const MAX_STEP = 45 // mirrors camera-flythrough firstPersonWalk MAX_STEP_CM

function walker(homeId: string) {
  useHouse.getState().loadHome(homeId)
  const s = useHouse.getState()
  const live = useStore.getState().design
  const all = layoutHouse(placementsFor(s, live))
  let pos = { x: 0, z: 0 }
  let floor = 0
  return {
    all,
    at: (p: { x: number; z: number }) => {
      pos = { ...p }
      floor = floorHeightAt(all, p.x, p.z, 0) ?? 0
    },
    /** walk in a straight line to `to` in 4cm steps; returns false if blocked */
    walkTo(to: { x: number; z: number }): boolean {
      for (let i = 0; i < 400; i++) {
        const dx = to.x - pos.x
        const dz = to.z - pos.z
        const d = Math.hypot(dx, dz)
        if (d < 2) return true
        const step = Math.min(4, d)
        const prop = { x: pos.x + (dx / d) * step, z: pos.z + (dz / d) * step }
        const col = houseColliders(layoutHouse(storeyColliderPlacements(s, live, floor)))
        const r = resolveWalk(pos, prop, col, { radius: 18 })
        const f = floorHeightAt(all, r.x, r.z, floor)
        if (f === null || Math.abs(f - floor) > MAX_STEP) return false
        if (Math.hypot(r.x - pos.x, r.z - pos.z) < 0.5) return false // wall
        pos = r
        floor = f
      }
      return false
    },
    get floor() {
      return floor
    },
  }
}

/** World point of a stair's local (lx, lz) for the stair in room `roomName`. */
function stairPoint(all: ReturnType<typeof layoutHouse>, roomName: string, lx: number, lz: number) {
  const p = all.find((q) => q.design.name === roomName)!
  const f = p.design.furniture.find((x) => x.archetype.startsWith('stair'))!
  const ox = p.centerCm.x - p.design.corners[2].x / 2
  const oz = p.centerCm.z - p.design.corners[2].z / 2
  const c = Math.cos(f.rotation)
  const s = Math.sin(f.rotation)
  // local → world (the renderer's Y rotation)
  return { x: f.x + ox + lx * c + lz * s, z: f.z + oz - lx * s + lz * c, f }
}

describe('walking up the stairs to the upper storey', () => {
  // [home, stair room, the upstairs room the stair arrives in]
  const cases: Array<[string, string, string]> = [
    ['canary', 'Stair Hall', 'Upper Passage'],
    ['embercrest', 'Stair Hall', 'Upper Corridor'],
    ['sky', 'Staircase', 'Store'],
  ]
  for (const [home, hall, arrival] of cases) {
    it(`${home}: up flight A, across the landing, up flight B → on the upper floor`, () => {
      const w = walker(home)
      const up = HOMES.find((h) => h.id === home)!.levels[1].elevationCm
      const { f } = stairPoint(w.all, hall, 0, 0)
      const qa = -(f.w / 4) // centre line of flight A (−x half)
      const qb = f.w / 4 // flight B (+x half)
      const front = f.d / 2 - 5
      const landing = -f.d / 2 + 45 // body radius (18) + wall half-thickness clear of the back wall
      w.at(stairPoint(w.all, hall, qa, front + 3))
      expect(w.floor).toBeLessThan(MAX_STEP)
      expect(w.walkTo(stairPoint(w.all, hall, qa, landing)), 'climb flight A').toBe(true)
      expect(w.floor).toBeCloseTo(up / 2, 0)
      expect(w.walkTo(stairPoint(w.all, hall, qb, landing)), 'cross the landing').toBe(true)
      expect(w.walkTo(stairPoint(w.all, hall, qb, front)), 'climb flight B').toBe(true)
      expect(Math.abs(w.floor - up)).toBeLessThanOrEqual(10)
      expect(levelAtFloor(useHouse.getState().levels, w.floor)).toBe(1)
      // …and step off the top into the upstairs room, staying on the upper floor
      const room = w.all.find((p) => p.design.name === arrival && p.level === 1)!
      expect(w.walkTo(room.centerCm), `walk off the stair into ${arrival}`).toBe(true)
      expect(w.floor).toBe(up)
      // …and all the way back down to the ground floor
      expect(w.walkTo(stairPoint(w.all, hall, qb, front)), 'back onto flight B').toBe(true)
      expect(w.walkTo(stairPoint(w.all, hall, qb, landing)), 'down flight B').toBe(true)
      expect(w.walkTo(stairPoint(w.all, hall, qa, landing)), 'across the landing').toBe(true)
      expect(w.walkTo(stairPoint(w.all, hall, qa, front + 3)), 'down flight A').toBe(true)
      expect(w.floor).toBeLessThan(MAX_STEP)
    })
  }

  it('you cannot step off a flight\'s side or hop the U-stair\'s central wall', () => {
    const w = walker('canary')
    const { f } = stairPoint(w.all, 'Stair Hall', 0, 0)
    w.at(stairPoint(w.all, 'Stair Hall', -f.w / 4, f.d / 2 - 8))
    expect(w.walkTo(stairPoint(w.all, 'Stair Hall', -f.w / 4, 0))).toBe(true) // halfway up A
    // straight across into flight B at the same depth: B is ~a storey higher here
    expect(w.walkTo(stairPoint(w.all, 'Stair Hall', f.w / 4, 0))).toBe(false)
  })

  it('upstairs, the glass rail over the double-height living is solid', () => {
    useHouse.getState().loadHome('embercrest')
    const s = useHouse.getState()
    const col = houseColliders(layoutHouse(storeyColliderPlacements(s, useStore.getState().design, 300)))
    // upper corridor (x 482..810, z 400..505): push east into its rail at x 810
    // in walker-sized steps (the solver is per-frame; one huge step tunnels)
    let p = { x: 770, z: 452 }
    for (let i = 0; i < 40; i++) p = resolveWalk(p, { x: p.x + 3, z: p.z }, col, { radius: 18 })
    expect(p.x).toBeLessThan(800)
  })

  it('stair surface: U-stair climbs A to the half-landing, B back to the top', () => {
    const f = { archetype: 'stair-u', w: 200, d: 280, h: 300 }
    expect(stairSurfaceCm(f, -50, 140)).toBeCloseTo(0, 5) // foot of A
    expect(stairSurfaceCm(f, 0, -135)).toBe(150) // landing
    expect(stairSurfaceCm(f, 50, 140)).toBeCloseTo(300, 5) // top of B, same end as A's foot
    expect(stairSurfaceCm(f, 0, 200)).toBeNull() // off the stair
  })
})

describe('visiblePlacements (tour room multi-select)', () => {
  const p = (id: string, level: number) => ({ level, design: { id } })
  const placed = [p('living', 0), p('kitchen', 0), p('bed3', 1), p('nook', 1)]
  const ids = (xs: { design: { id: string } }[]) => xs.map((x) => x.design.id)

  it('shows everything with no level or room filter', () => {
    expect(ids(visiblePlacements(placed, 'all'))).toEqual(['living', 'kitchen', 'bed3', 'nook'])
    expect(ids(visiblePlacements(placed, 'all', []))).toEqual(['living', 'kitchen', 'bed3', 'nook'])
  })

  it('shows only the selected rooms, across storeys', () => {
    expect(ids(visiblePlacements(placed, 'all', ['kitchen', 'bed3']))).toEqual(['kitchen', 'bed3'])
  })

  it('intersects the selection with an isolated storey', () => {
    expect(ids(visiblePlacements(placed, 1, ['kitchen', 'bed3']))).toEqual(['bed3'])
    expect(ids(visiblePlacements(placed, 0))).toEqual(['living', 'kitchen'])
  })

  it('ignores ids that match no room', () => {
    expect(ids(visiblePlacements(placed, 'all', ['gone']))).toEqual([])
    expect(ids(visiblePlacements(placed, 'all', ['gone', 'nook']))).toEqual(['nook'])
  })
})

describe('toggleId (room button select / deselect)', () => {
  it('adds on first press and removes on second, keeping order', () => {
    const a = toggleId([], 'kitchen')
    const b = toggleId(a, 'living')
    expect(b).toEqual(['kitchen', 'living'])
    expect(toggleId(b, 'kitchen')).toEqual(['living'])
    expect(toggleId(toggleId(b, 'kitchen'), 'living')).toEqual([])
  })

  it('does not mutate its input', () => {
    const ids = ['a']
    toggleId(ids, 'b')
    toggleId(ids, 'a')
    expect(ids).toEqual(['a'])
  })
})
