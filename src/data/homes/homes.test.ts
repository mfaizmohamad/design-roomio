import { describe, it, expect } from 'vitest'
import { HOMES, HOME_MAP } from './index'
import type { ReplicaRoom } from '../listingFlats'
import { ARCHETYPE_MAP } from '../archetypes'
import { FLOOR_MAP } from '../materials'
import { MAX_WALL_HEIGHT_CM } from '../../units'

// Homes are hand-authored plans (the Canary is traced from its unit plan). A
// single mistyped `t` or centre silently yields a door into a wall, two rooms
// overlapping, or an upstairs door opening onto the solid wall of a double-
// height room — invisible to typecheck, obvious on screen. These pin the
// authoring contract (data/homes/types.ts) for EVERY registered home, so a new
// home is checked the moment it is added to the registry.

type Pt = { x: number; z: number }
interface Placed { r: ReplicaRoom; level: number; elev: number; h: number }

/** World endpoints of a room's wall wN (w0 back, w1 x=w, w2 front, w3 x=0). */
function wallSeg(r: ReplicaRoom, id: string): [Pt, Pt] {
  const x0 = r.x - r.w / 2
  const z0 = r.z - r.l / 2
  const c = [
    { x: x0, z: z0 },
    { x: x0 + r.w, z: z0 },
    { x: x0 + r.w, z: z0 + r.l },
    { x: x0, z: z0 + r.l },
  ]
  const i = Number(id.slice(1))
  return [c[i], c[(i + 1) % 4]]
}

const lerp = ([a, b]: [Pt, Pt], t: number): Pt => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })
const segLen = ([a, b]: [Pt, Pt]) => Math.hypot(b.x - a.x, b.z - a.z)
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z)

/** Is p on segment s (strictly between its ends, within tol cm)? */
function onSeg(p: Pt, s: [Pt, Pt], tol = 1): boolean {
  const [a, b] = s
  const len = segLen(s)
  const t = ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / (len * len)
  if (t <= 0.001 || t >= 0.999) return false
  return dist(lerp(s, t), p) <= tol
}

const WALLS = ['w0', 'w1', 'w2', 'w3']

for (const home of HOMES) {
  const all: Placed[] = home.levels.flatMap((lv, level) =>
    lv.rooms.map((r) => ({ r, level, elev: lv.elevationCm, h: r.wallHeight ?? 270 })),
  )

  describe(`home ${home.id}`, () => {
    it('levels are bottom-up with the entry storey at elevation 0', () => {
      expect(home.levels[0].elevationCm).toBe(0)
      for (let i = 1; i < home.levels.length; i++) {
        expect(home.levels[i].elevationCm).toBeGreaterThan(home.levels[i - 1].elevationCm)
      }
    })

    it('room names are unique across the home (they label rooms in one session)', () => {
      const names = all.map((p) => p.r.name)
      expect(new Set(names).size).toBe(names.length)
    })

    it('no two rooms overlap in 3D (same-level rooms never; across levels only if vertically apart)', () => {
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i]
          const b = all[j]
          const ox = Math.min(a.r.x + a.r.w / 2, b.r.x + b.r.w / 2) - Math.max(a.r.x - a.r.w / 2, b.r.x - b.r.w / 2)
          const oz = Math.min(a.r.z + a.r.l / 2, b.r.z + b.r.l / 2) - Math.max(a.r.z - a.r.l / 2, b.r.z - b.r.l / 2)
          const oy = Math.min(a.elev + a.h, b.elev + b.h) - Math.max(a.elev, b.elev)
          expect(ox > 1 && oz > 1 && oy > 1, `${a.r.name} intersects ${b.r.name}`).toBe(false)
        }
      }
    })

    it('every finish and every furniture archetype resolves; furniture sits inside its room', () => {
      for (const { r } of all) {
        expect(FLOOR_MAP[r.floor], `${r.name} floor ${r.floor}`).toBeDefined()
        if (r.wallTexture) expect(FLOOR_MAP[r.wallTexture]).toBeDefined()
        for (const f of r.furniture) {
          expect(ARCHETYPE_MAP[f.a], `${r.name}: ${f.a}`).toBeDefined()
          expect(f.x >= 0 && f.x <= r.w && f.z >= 0 && f.z <= r.l, `${r.name}: ${f.a} outside`).toBe(true)
        }
      }
    })

    it('every opening fits its wall and its ceiling', () => {
      for (const { r, h } of all) {
        expect(h).toBeLessThanOrEqual(MAX_WALL_HEIGHT_CM)
        for (const o of r.openings) {
          expect(WALLS).toContain(o.wallId)
          const len = segLen(wallSeg(r, o.wallId))
          const u = o.t * len
          const tag = `${r.name} ${o.wallId}@${o.t} ${o.style}`
          expect(u - o.width / 2, tag).toBeGreaterThanOrEqual(-0.5)
          expect(u + o.width / 2, tag).toBeLessThanOrEqual(len + 0.5)
          expect(o.sill + o.height, tag).toBeLessThanOrEqual(h)
        }
      }
    })

    it('every opening on a shared wall has its twin at the same world spot and height (one side bare)', () => {
      for (const a of all) {
        for (const o of a.r.openings) {
          const p = lerp(wallSeg(a.r, o.wallId), o.t)
          const y0 = a.elev + o.sill
          const y1 = y0 + o.height
          for (const b of all) {
            if (b === a) continue
            const nWall = WALLS.find((w) => onSeg(p, wallSeg(b.r, w)))
            if (!nWall) continue
            // the neighbour's wall only matters where it actually stands
            if (Math.min(y1, b.elev + b.h) - Math.max(y0, b.elev) <= 1) continue
            const tag = `${a.r.name} ${o.wallId}@${o.t} (y ${y0}) ↔ ${b.r.name} ${nWall}`
            const twin = b.r.openings.find(
              (q) =>
                q.wallId === nWall &&
                dist(lerp(wallSeg(b.r, nWall), q.t), p) <= 3 &&
                Math.abs(b.elev + q.sill - y0) <= 1,
            )
            expect(twin, `${tag}: no twin`).toBeDefined()
            expect(Math.abs(twin!.width - o.width), `${tag}: width`).toBeLessThanOrEqual(1)
            expect(!!twin!.bare !== !!o.bare, `${tag}: exactly one side must be bare`).toBe(true)
          }
        }
      }
    })

    it('has a stair (if multi-storey), and a living room on the entry level to land on', () => {
      const isStair = (a: string) => ['staircase', 'staircaseU'].includes(ARCHETYPE_MAP[a]?.model ?? '')
      if (home.levels.length > 1) expect(all.some((p) => p.r.furniture.some((f) => isStair(f.a)))).toBe(true)
      expect(home.levels[0].rooms.some((r) => r.type === 'living')).toBe(true)
    })

    // A stair is only usable if a door leads to its FOOT. The Pandaul stair was
    // first built with its doorway opposite the TOP of the U-stair's return
    // flight and its front edge 12cm off that wall: every test above passed,
    // the stair was unreachable. stair-u climbs on its local −x flight from the
    // front (+z) edge and returns on +x (mirrors stairSurfaceCm in
    // three/houseLevels.ts); a straight flight climbs from its front edge.
    it('every stair has floor at its foot, reached from a ground-level door without crossing the stair', () => {
      const APPROACH = 30 // one stride in front of the first / beyond the last tread
      for (const p of all) {
        for (const f of p.r.furniture) {
          const model = ARCHETYPE_MAP[f.a]?.model
          if (model !== 'staircase' && model !== 'staircaseU') continue
          const arch = ARCHETYPE_MAP[f.a]!
          const w = f.w ?? arch.w
          const d = f.d ?? arch.d
          const h = f.h ?? arch.h
          const flightX = model === 'staircaseU' ? 4 + Math.max(30, (w - 8) / 2) / 2 : 0
          // stair-local ↔ room-local (three.js rotation.y, as the renderer applies it)
          const c = Math.cos(f.rot)
          const s = Math.sin(f.rot)
          const toRoom = (lx: number, lz: number): Pt => ({ x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c })
          const toStair = (q: Pt): Pt => {
            const ux = q.x - f.x
            const uz = q.z - f.z
            return { x: ux * c - uz * s, z: ux * s + uz * c }
          }
          const onStair = (q: Pt) => {
            const l = toStair(q)
            return Math.abs(l.x) < w / 2 - 1 && Math.abs(l.z) < d / 2 - 1
          }
          const tag = `${p.r.name}: ${f.a}`

          const x0 = p.r.x - p.r.w / 2
          const z0 = p.r.z - p.r.l / 2
          const groundDoors = p.r.openings.filter((o) => o.kind === 'door' && o.sill <= 1)
          const foot = toRoom(-flightX, d / 2 + APPROACH)
          const inRoom = (q: Pt) => q.x > 0 && q.x < p.r.w && q.z > 0 && q.z < p.r.l

          if (!inRoom(foot)) {
            // The flight may start right at an opening (Canary, Embercrest): its
            // foot is then in the NEIGHBOURING room, and the walk from there to
            // the first tread must pass through one of this room's doorways.
            const footW = { x: foot.x + x0, z: foot.z + z0 }
            const floorThere = all.some(
              (u) =>
                u !== p && u.level === p.level &&
                footW.x > u.r.x - u.r.w / 2 && footW.x < u.r.x + u.r.w / 2 &&
                footW.z > u.r.z - u.r.l / 2 && footW.z < u.r.z + u.r.l / 2,
            )
            expect(floorThere, `${tag}: no floor at the foot of the stair`).toBe(true)
            const tread = toRoom(-flightX, d / 2 - 1)
            let cross: Pt | null = null
            for (let i = 0; i <= 200 && !cross; i++) {
              const q = { x: foot.x + ((tread.x - foot.x) * i) / 200, z: foot.z + ((tread.z - foot.z) * i) / 200 }
              if (inRoom(q)) cross = { x: q.x + x0, z: q.z + z0 }
            }
            const through = !!cross && groundDoors.some((o) => {
              const seg = wallSeg(p.r, o.wallId)
              return dist(lerp(seg, o.t), cross!) <= o.width / 2 && onSeg(cross!, seg, 3)
            })
            expect(through, `${tag}: the way onto the first step does not pass through a doorway`).toBe(true)
          } else {
            // each ground-level door, stepped 20cm into the room, must see the foot
            // along a straight line that never crosses the stair's footprint
            const inward: Record<string, Pt> = { w0: { x: 0, z: 1 }, w1: { x: -1, z: 0 }, w2: { x: 0, z: -1 }, w3: { x: 1, z: 0 } }
            const reaches = groundDoors.some((o) => {
              const wp = lerp(wallSeg(p.r, o.wallId), o.t)
              const n = inward[o.wallId]
              const from = { x: wp.x - x0 + n.x * 20, z: wp.z - z0 + n.z * 20 }
              for (let i = 0; i <= 100; i++) {
                const q = { x: from.x + ((foot.x - from.x) * i) / 100, z: from.z + ((foot.z - from.z) * i) / 100 }
                if (onStair(q)) return false
              }
              return true
            })
            expect(reaches, `${tag}: no ground-level door leads to the foot of the stair`).toBe(true)
          }

          // multi-storey: the top tread must land on a room floor of the storey above
          const up = all.filter((u) => u.level === p.level + 1)
          if (up.length) {
            const topLocal = model === 'staircaseU' ? toRoom(flightX, d / 2 + APPROACH) : toRoom(0, -d / 2 - APPROACH)
            const top = { x: topLocal.x + x0, z: topLocal.z + z0 }
            const landing = up.some(
              (u) =>
                Math.abs(u.elev - (p.elev + h)) <= 5 &&
                top.x > u.r.x - u.r.w / 2 && top.x < u.r.x + u.r.w / 2 &&
                top.z > u.r.z - u.r.l / 2 && top.z < u.r.z + u.r.l / 2,
            )
            expect(landing, `${tag}: the top of the stair lands on no upper-floor room`).toBe(true)
          }
        }
      }
    })

    // THE OPEN-DOORWAY RULE (docs/home-authoring-pipeline.md). Kitchens and halls
    // are almost always entered through an open doorway, not a hinged door: the
    // Pandaul kitchen 2 was first built with a wooden door + leaf onto the hall.
    // A leaf is fine where it belongs to a PRIVATE room (bedroom, bathroom, study)
    // or closes off a balcony or the outside; between a kitchen/hall and any
    // other shared space it is wrong. "Hall" = a living room on the ENTRY storey:
    // an upstairs family lounge is semi-private and often does have a door (the
    // Sky Duplex and Embercrest plans both draw one), so it is not held to this.
    it('kitchens and halls open onto shared spaces through open doorways, not doors with leaves', () => {
      const KEEPS_DOOR: string[] = ['bedroom', 'bathroom', 'office', 'balcony']
      const openPlan = (q: Placed) => q.r.type === 'kitchen' || (q.r.type === 'living' && q.level === 0)
      for (const a of all) {
        for (const o of a.r.openings) {
          if (o.kind !== 'door' || o.style === 'passage') continue
          const p = lerp(wallSeg(a.r, o.wallId), o.t)
          const y0 = a.elev + o.sill
          for (const b of all) {
            if (b === a || !WALLS.some((w) => onSeg(p, wallSeg(b.r, w)))) continue
            if (Math.min(y0 + o.height, b.elev + b.h) - Math.max(y0, b.elev) <= 1) continue
            if (!(openPlan(a) || openPlan(b)) || [a.r.type, b.r.type].some((t) => KEEPS_DOOR.includes(t))) continue
            expect.fail(`${a.r.name} ↔ ${b.r.name}: ${o.style} door with a leaf — kitchens and halls get an open doorway (style 'passage')`)
          }
        }
      }
    })

    // A door on the wrong wall still passes every test above: the twin check
    // only asks that BOTH sides agree. The Pandaul puja was first built with its
    // door on the passage side and a solid wall to the hall — consistent, wrong.
    // Reachability cannot catch "opens onto the wrong room" (the per-home
    // circulation tests below do), but it does catch a room sealed off entirely.
    it('every room is reachable on foot from an exterior door on the entry storey', () => {
      // rooms on the far side of a door — only where their wall actually stands
      // at the door's height (an upstairs room over a front door is not its far side)
      const across = (a: Placed, o: ReplicaRoom['openings'][number]): Placed[] => {
        const p = lerp(wallSeg(a.r, o.wallId), o.t)
        const y0 = a.elev + o.sill
        return all.filter(
          (b) =>
            b !== a &&
            WALLS.some((w) => onSeg(p, wallSeg(b.r, w))) &&
            Math.min(y0 + o.height, b.elev + b.h) - Math.max(y0, b.elev) > 1,
        )
      }
      const doors = (a: Placed) => a.r.openings.filter((o) => o.kind === 'door')
      // a stair climbs through the ceiling into whatever is built over its room
      // (the Sky Duplex authors no opening between storeys — the stair IS the link)
      const isStair = (f: { a: string }) => ['staircase', 'staircaseU'].includes(ARCHETYPE_MAP[f.a]?.model ?? '')
      const above = (a: Placed): Placed[] =>
        !a.r.furniture.some(isStair)
          ? []
          : all.filter(
              (b) =>
                b.level === a.level + 1 &&
                Math.min(a.r.x + a.r.w / 2, b.r.x + b.r.w / 2) - Math.max(a.r.x - a.r.w / 2, b.r.x - b.r.w / 2) > 1 &&
                Math.min(a.r.z + a.r.l / 2, b.r.z + b.r.l / 2) - Math.max(a.r.z - a.r.l / 2, b.r.z - b.r.l / 2) > 1,
            )
      const doorsTo = (a: Placed): Placed[] => [...doors(a).flatMap((o) => across(a, o)), ...above(a)]
      const exterior = (a: Placed) => a.level === 0 && doors(a).some((o) => across(a, o).length === 0)
      const seen = new Set<Placed>(all.filter(exterior))
      expect(seen.size, 'no exterior door on the entry storey').toBeGreaterThan(0)
      const queue = [...seen]
      while (queue.length) {
        for (const b of doorsTo(queue.shift()!)) {
          if (seen.has(b)) continue
          seen.add(b)
          queue.push(b)
        }
      }
      expect(all.filter((p) => !seen.has(p)).map((p) => p.r.name)).toEqual([])
    })
  })
}

describe('home catalog', () => {
  it('offers the Sky Duplex and the Canary Elysium 3BHK', () => {
    expect(HOME_MAP['sky'].levels).toHaveLength(2)
    expect(HOME_MAP['canary'].levels).toHaveLength(2)
  })

  it(`the Canary matches its unit plan: living & dining 13'1" × 24'5", double height, 3 bedrooms`, () => {
    const c = HOME_MAP['canary']
    const living = c.levels[0].rooms.find((r) => r.name === 'Living & Dining')!
    expect(Math.abs(living.w - 399)).toBeLessThanOrEqual(5) // 13'1" = 399cm
    expect(Math.abs(living.l - 744)).toBeLessThanOrEqual(20) // 24'5" = 744cm
    expect(living.wallHeight).toBe(2 * c.levels[1].elevationCm)
    const beds = c.levels.flatMap((l) => l.rooms).filter((r) => r.type === 'bedroom')
    expect(beds).toHaveLength(3)
  })

  it('the Raheja Sky Duplex matches its unit plan: printed room sizes, double-height living', () => {
    const h = HOME_MAP['sky']
    const room = (n: string) => h.levels.flatMap((l) => l.rooms).find((r) => r.name === n)!
    // metric sizes printed on the plan (w × l, cm)
    expect([room('Living').w, room('Living').l]).toEqual([320, 397.5]) // 3.15 × 3.975 (+5 grid snap)
    expect([room('Kitchen').l, room('Bedroom 1').w, room('Bedroom 1').l]).toEqual([245, 310, 372.5])
    expect([room('Bedroom 2').w, room('Bedroom 2').l]).toEqual([305, 355])
    expect([room('WFH / Study').w, room('WFH / Study').l]).toEqual([535, 245])
    expect(room('Living').wallHeight).toBe(2 * h.levels[1].elevationCm)
    expect(room('Balcony').wallHeight).toBe(2 * h.levels[1].elevationCm)
  })
})

describe('Canary circulation matches the unit plan', () => {
  const lower = HOME_MAP['canary'].levels[0].rooms
  const room = (n: string) => lower.find((r) => r.name === n)!
  const doorsOn = (r: ReplicaRoom, w: string) => r.openings.filter((o) => o.wallId === w && o.kind === 'door')

  it('the lobby has NO opening into the stair hall (solid wall on the plan)', () => {
    // stair hall's south wall (w2) faces the lobby; lobby's north wall (w0) faces the stair
    expect(doorsOn(room('Stair Hall'), 'w2')).toEqual([])
    expect(doorsOn(room('Entry Lobby'), 'w0')).toEqual([])
  })

  it('main door → lobby → living: the lobby opens east into the living room', () => {
    expect(doorsOn(room('Entry Lobby'), 'w2')).toHaveLength(1) // main door
    expect(doorsOn(room('Entry Lobby'), 'w1')).toHaveLength(1) // into the living
  })

  it('the stair is a dog-leg entered from the passage on both floors', () => {
    const stair = room('Stair Hall').furniture.find((f) => f.a === 'stair-u')!
    expect(stair).toBeDefined()
    // rot π ⇒ its entry/exit end faces -z, i.e. the passage (w0) side
    expect(stair.rot).toBeCloseTo(Math.PI)
    const upPassage = HOME_MAP['canary'].levels[1].rooms.find((r) => r.name === 'Upper Passage')!
    expect(doorsOn(room('Passage'), 'w2').some((o) => !o.bare && o.width >= 150)).toBe(true)
    expect(doorsOn(upPassage, 'w2').some((o) => !o.bare && o.width >= 150)).toBe(true)
  })
})

describe('Embercrest matches its CAD plan (flat 504, 3 BHK duplex)', () => {
  const h = HOME_MAP['embercrest']
  const [lower, upper] = h.levels.map((l) => l.rooms)
  const room = (rs: ReplicaRoom[], n: string) => rs.find((r) => r.name === n)!
  const doorsOn = (r: ReplicaRoom, w: string) => r.openings.filter((o) => o.wallId === w && o.kind === 'door')

  it('printed room sizes: living 6.50 × 3.65 (±10), kitchen & family 4.48 × 3.05, bedrooms 3.35 wide', () => {
    const living = room(lower, 'Living & Dining')
    expect(living.w).toBe(650)
    expect(Math.abs(living.l - 365)).toBeLessThanOrEqual(10)
    for (const r of [room(lower, 'Kitchen'), room(upper, 'Family Room')]) expect([r.w, r.l]).toEqual([448, 305])
    for (const r of [room(lower, 'Bedroom 1'), room(upper, 'Bedroom 2'), room(upper, 'Bedroom 3')]) expect(r.w).toBe(335)
  })

  it('3 bedrooms, a double-height living with nothing built over it', () => {
    expect([...lower, ...upper].filter((r) => r.type === 'bedroom')).toHaveLength(3)
    const living = room(lower, 'Living & Dining')
    expect(living.wallHeight).toBe(2 * h.levels[1].elevationCm)
    const lx0 = living.x - living.w / 2
    const lz0 = living.z - living.l / 2
    for (const u of upper) {
      const ox = Math.min(u.x + u.w / 2, lx0 + living.w) - Math.max(u.x - u.w / 2, lx0)
      const oz = Math.min(u.z + u.l / 2, lz0 + living.l) - Math.max(u.z - u.l / 2, lz0)
      expect(ox > 1 && oz > 1, `${u.name} sits over the void`).toBe(false)
    }
  })

  it('main door → lobby → living; the stair is entered from the corridor, not the lobby', () => {
    const lobby = room(lower, 'Lobby')
    expect(doorsOn(lobby, 'w1')).toHaveLength(1) // main door from the lift passage
    expect(doorsOn(lobby, 'w0')).toHaveLength(1) // up into the living
    const stair = room(lower, 'Stair Hall')
    expect(stair.furniture.find((f) => f.a === 'stair-u')!.rot).toBe(0) // entry end faces +z = corridor
    expect(doorsOn(stair, 'w2').length).toBeGreaterThan(0)
    for (const w of ['w0', 'w1', 'w3']) expect(doorsOn(stair, w)).toEqual([])
  })
})

describe('Pandaul matches its CAD ground-floor plan (single storey, 4 bedrooms)', () => {
  const rooms = HOME_MAP['pandaul'].levels[0].rooms
  const room = (n: string) => rooms.find((r) => r.name === n)!
  const doorsOn = (r: ReplicaRoom, w: string) => r.openings.filter((o) => o.wallId === w && o.kind === 'door')

  it('is one storey: 4 bedrooms, 2 kitchens, a hall, a puja room', () => {
    expect(HOME_MAP['pandaul'].levels).toHaveLength(1)
    expect(rooms.filter((r) => r.type === 'bedroom')).toHaveLength(4)
    expect(rooms.filter((r) => r.type === 'kitchen')).toHaveLength(2)
    expect(room('Hall').type).toBe('living')
    expect(room('Puja')).toBeDefined()
  })

  it(`printed room sizes: bedrooms 10'×12', kitchens 7'×8' and 10'×8', wash 5'×8', puja 5' wide, hall ~14' deep`, () => {
    for (const n of ['Bedroom 1', 'Bedroom 2', 'Bedroom 3', 'Bedroom 4']) expect([room(n).w, room(n).l]).toEqual([305, 366])
    expect([room('Kitchen').w, room('Kitchen').l]).toEqual([213, 244])
    expect([room('Kitchen 2').w, room('Kitchen 2').l]).toEqual([305, 244])
    expect([room('Wash').w, room('Wash').l]).toEqual([152, 244])
    expect([room('Puja').w, room('Puja').l]).toEqual([152, 154]) // 5'×6' label; see planNote
    expect(Math.abs(room('Hall').l - 427)).toBeLessThanOrEqual(30) // 14' label; runs to kitchen 2's door
    expect(Math.abs(room('Hall').w - 399)).toBeLessThanOrEqual(15) // 13'1" label; frame width wins
  })

  it('front door is the entry passage at the bottom, which opens north into the passage first', () => {
    const entry = room('Entry')
    expect(entry.type).toBe('foyer')
    // entranceSpawn takes the FIRST real door as the front door, then faces the first passage
    expect(entry.openings[0]).toMatchObject({ kind: 'door', style: 'single', wallId: 'w2' })
    expect(entry.openings.find((o) => o.style === 'passage')!.wallId).toBe('w0')
    expect(doorsOn(room('Stair'), 'w1')).toHaveLength(1) // stair entered from the entry
  })
})

describe('Pandaul circulation matches the plan', () => {
  const rooms = HOME_MAP['pandaul'].levels[0].rooms
  const room = (n: string) => rooms.find((r) => r.name === n)!
  const doorsOn = (r: ReplicaRoom, w: string) => r.openings.filter((o) => o.wallId === w && o.kind === 'door')

  it('the puja is an alcove open to the HALL, with a solid wall on the passage side', () => {
    // puja w0 faces the hall, w3 faces the passage; the passage's w1 faces the puja
    expect(doorsOn(room('Puja'), 'w0')).toHaveLength(1)
    expect(doorsOn(room('Puja'), 'w3')).toEqual([])
    expect(doorsOn(room('Passage'), 'w1')).toEqual([])
    // the hall's south wall carries the puja opening's bare twin beside the passage one
    expect(doorsOn(room('Hall'), 'w2')).toHaveLength(2)
  })
})

describe('Pandaul doors sit in the gaps of each room outline (the plan has no swing arcs)', () => {
  const rooms = HOME_MAP['pandaul'].levels[0].rooms
  const room = (n: string) => rooms.find((r) => r.name === n)!
  const doors = (n: string) => room(n).openings.filter((o) => o.kind === 'door')
  /** [wallId, end] of a room's door: 'start' / 'end' = which third of the wall,
   *  measured along the wall's own t direction (w0 +x, w1 +z, w2 −x, w3 −z). */
  const where = (n: string) =>
    doors(n).map((o) => [o.wallId, o.t < 1 / 3 ? 'start' : o.t > 2 / 3 ? 'end' : 'middle'])

  // Read gap by gap off the zoomed plan. Bedroom 4's was first put in its LEFT
  // wall, which is unbroken on the plan; kitchen 2's at the bottom of its right
  // wall instead of the top.
  it.each([
    ['Bedroom 1', [['w2', 'start']]], // bottom wall, right end
    ['Bedroom 2', [['w3', 'start']]], // left wall, bottom end
    ['Bedroom 3', [['w1', 'end']]], // right wall, bottom end
    ['Bedroom 4', [['w0', 'start']]], // TOP wall, left end — onto the passage
    ['Wash', [['w1', 'start']]], // right wall, top end
    ['Kitchen', [['w3', 'end']]], // left wall, top end
    ['Kitchen 2', [['w1', 'start']]], // right wall, TOP end — onto the hall
  ])('%s has exactly one door, in the gap drawn on the plan', (name, expected) => {
    expect(where(name as string)).toEqual(expected)
  })

  it('bedroom 4 opens onto the passage, and its wall along the entry is solid', () => {
    expect(doors('Bedroom 4').filter((o) => o.wallId === 'w3')).toEqual([])
    expect(room('Entry').openings.filter((o) => o.kind === 'door' && o.wallId === 'w1')).toEqual([])
    expect(room('Passage').openings.some((o) => o.kind === 'door' && o.wallId === 'w2' && o.style === 'single')).toBe(true)
  })

  it('the stair is open along its whole east side (a stair edge, not a wall)', () => {
    const side = room('Stair').openings.find((o) => o.kind === 'door' && o.wallId === 'w1')!
    expect(side.width).toBeGreaterThanOrEqual(room('Stair').l - 20)
  })
})
