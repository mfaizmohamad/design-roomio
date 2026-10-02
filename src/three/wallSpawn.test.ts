import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, newDesign } from '../store'
import { ARCHETYPE_MAP } from '../data/archetypes'
import {
  elevationCm,
  distToNearestWallCm,
  WALL_ATTACH_THRESHOLD_CM,
} from './mount'
import { obbOverlap } from '../geometry/collision'
import { placementWarnings } from '../suggestions/engine'
import type { FurnitureItem, Wall } from '../types'

// ───────────────────────────────────────────────────────────────────────────
// WIZ-06 — wall-mounted pieces added from the catalog must spawn ATTACHED to a
// wall (free span at mount height, clear of openings and other wall pieces),
// never floating mid-room. Floor / surface pieces keep the interior spawn.
// The default rect room is 600×400 cm, wallThickness 12 (interior point 300,200).
// ───────────────────────────────────────────────────────────────────────────

function freshRoom() {
  useStore.getState().loadDesign(newDesign('rect'))
  useStore.setState({ interacting: false })
}

function item(id: string): FurnitureItem {
  const f = useStore.getState().design.furniture.find((x) => x.id === id)
  expect(f).toBeDefined()
  return f as FurnitureItem
}

/** The wall whose centerline is closest to the item's center. */
function nearestWall(f: FurnitureItem): Wall {
  const walls = useStore.getState().walls
  let best = walls[0]
  let bestD = Infinity
  for (const w of walls) {
    const abx = w.b.x - w.a.x
    const abz = w.b.z - w.a.z
    const len2 = abx * abx + abz * abz || 1
    let t = ((f.x - w.a.x) * abx + (f.z - w.a.z) * abz) / len2
    t = Math.max(0, Math.min(1, t))
    const d = Math.hypot(f.x - (w.a.x + t * abx), f.z - (w.a.z + t * abz))
    if (d < bestD) {
      bestD = d
      best = w
    }
  }
  return best
}

/** Signed distance from wall centerline and coordinate along the wall. */
function wallCoords(f: FurnitureItem, w: Wall) {
  return {
    sd: (f.x - w.a.x) * w.nx + (f.z - w.a.z) * w.nz,
    tang: (f.x - w.a.x) * w.dirX + (f.z - w.a.z) * w.dirZ,
  }
}

function angleDiff(a: number, b: number): number {
  let r = (a - b) % (Math.PI * 2)
  if (r <= -Math.PI) r += Math.PI * 2
  else if (r > Math.PI) r -= Math.PI * 2
  return Math.abs(r)
}

/** Assert the piece is mounted flush on a wall, facing into the room. */
function expectFlushOnWall(f: FurnitureItem) {
  const st = useStore.getState()
  const dist = distToNearestWallCm(f.x, f.z, st.design.corners)
  // flush = wallThickness/2 + depth/2 (+ tiny epsilon)
  expect(dist).toBeLessThanOrEqual(st.design.wallThickness / 2 + f.d / 2 + 2)
  const w = nearestWall(f)
  expect(angleDiff(f.rotation, Math.atan2(w.nx, w.nz))).toBeLessThan(1e-6)
}

beforeEach(freshRoom)

describe('wall-mount spawn (WIZ-06)', () => {
  it('a catalog-added TV spawns flush on a wall at TV height with no placement warning', () => {
    const id = useStore.getState().addFurnitureCentered('decor-tv')
    const tv = item(id)
    expectFlushOnWall(tv)
    // hangs at the design-standard height (center ≈107cm), not on the floor
    const st = useStore.getState()
    const elev = elevationCm(tv, st.design.furniture, st.design.corners)
    expect(Math.round(elev + tv.h / 2)).toBe(107)
    // the advisory must NOT fire for a freshly added TV
    expect(placementWarnings(st.design)).toHaveLength(0)
  })

  it('a wall mirror and a wall shelf also spawn attached to a wall', () => {
    const mirrorId = useStore.getState().addFurnitureCentered('decor-mirror')
    const shelfId = useStore.getState().addFurnitureCentered('storage-wall-shelf')
    const mirror = item(mirrorId)
    const shelf = item(shelfId)
    expectFlushOnWall(mirror)
    expectFlushOnWall(shelf)
    const st = useStore.getState()
    expect(elevationCm(mirror, st.design.furniture, st.design.corners)).toBe(0) // leans from floor
    expect(elevationCm(shelf, st.design.furniture, st.design.corners)).toBe(130)
    expect(placementWarnings(st.design)).toHaveLength(0)
  })

  it('a chandelier is the exception: it spawns mid-room, hanging, with no warning', () => {
    const id = useStore.getState().addFurnitureCentered('decor-chandelier')
    const c = item(id)
    const st = useStore.getState()
    expect(distToNearestWallCm(c.x, c.z, st.design.corners)).toBeGreaterThan(WALL_ATTACH_THRESHOLD_CM)
    expect(elevationCm(c, st.design.furniture, st.design.corners)).toBe(245)
    expect(placementWarnings(st.design)).toHaveLength(0)
  })

  it('spawn avoids door/window holes on the chosen wall', () => {
    const st = useStore.getState()
    // doors on both near walls (w0 / w2), centered — the TV must land beside them
    st.addOpening('single', st.walls[0].id, 0.5)
    useStore.getState().addOpening('single', useStore.getState().walls[2].id, 0.5)
    const id = useStore.getState().addFurnitureCentered('decor-tv')
    const tv = item(id)
    expectFlushOnWall(tv)
    const wall = nearestWall(tv)
    const { tang } = wallCoords(tv, wall)
    const design = useStore.getState().design
    for (const o of design.openings) {
      if (o.wallId !== wall.id) continue
      // TV band [~71, ~143] overlaps a door's [0, 205] → must not intersect its span
      const u = o.t * wall.length
      const disjoint =
        tang + tv.w / 2 <= u - o.width / 2 || tang - tv.w / 2 >= u + o.width / 2
      expect(disjoint).toBe(true)
    }
    expect(placementWarnings(design)).toHaveLength(0)
  })

  it('a second TV mounts without overlapping the first', () => {
    const id1 = useStore.getState().addFurnitureCentered('decor-tv')
    const id2 = useStore.getState().addFurnitureCentered('decor-tv')
    const tv1 = item(id1)
    const tv2 = item(id2)
    expectFlushOnWall(tv1)
    expectFlushOnWall(tv2)
    expect(
      obbOverlap(
        { cx: tv1.x, cz: tv1.z, w: tv1.w, d: tv1.d, rot: tv1.rotation },
        { cx: tv2.x, cz: tv2.z, w: tv2.w, d: tv2.d, rot: tv2.rotation },
      ),
    ).toBe(false)
    expect(placementWarnings(useStore.getState().design)).toHaveLength(0)
  })

  it('spawn avoids tall furniture standing against the wall, but a low console is fine', () => {
    // wardrobe (201cm) against the middle of the north wall — blocks the TV band
    useStore.getState().addFurniture('storage-wardrobe', 300, 36, 0)
    const id = useStore.getState().addFurnitureCentered('decor-tv')
    const tv = item(id)
    expectFlushOnWall(tv)
    const wardrobe = useStore
      .getState()
      .design.furniture.find((f) => f.archetype === 'storage-wardrobe') as FurnitureItem
    expect(
      obbOverlap(
        { cx: tv.x, cz: tv.z, w: tv.w, d: tv.d, rot: tv.rotation },
        { cx: wardrobe.x, cz: wardrobe.z, w: wardrobe.w, d: wardrobe.d, rot: wardrobe.rotation },
      ),
    ).toBe(false)
  })

  it('curtains spawn centered over a window when one exists', () => {
    const st = useStore.getState()
    st.addOpening('windowDouble', st.walls[1].id, 0.5) // east wall (x=600), u=200
    const id = useStore.getState().addFurnitureCentered('decor-curtain')
    const curtain = item(id)
    const wall = nearestWall(curtain)
    expect(wall.id).toBe('w1')
    const { tang } = wallCoords(curtain, wall)
    expect(tang).toBeCloseTo(0.5 * wall.length, 0) // centered on the window
  })

  it('fully-glazed walls → floor-standing fallback near a wall, warning fires', () => {
    const st = useStore.getState()
    for (const w of st.walls) useStore.getState().addOpening('windowDouble', w.id, 0.5)
    // stretch every window to the wall's max width → no free span anywhere
    for (const o of useStore.getState().design.openings) {
      useStore.getState().updateOpening(o.id, { width: 10000 })
    }
    const id = useStore.getState().addFurnitureCentered('decor-tv')
    const tv = item(id)
    const s2 = useStore.getState()
    const dist = distToNearestWallCm(tv.x, tv.z, s2.design.corners)
    // near a wall, but recognizably NOT mounted (beyond the attach threshold)
    expect(dist).toBeGreaterThan(WALL_ATTACH_THRESHOLD_CM)
    expect(dist).toBeLessThan(130)
    // floor-standing (pedestal on the floor), not floating mid-air
    expect(elevationCm(tv, s2.design.furniture, s2.design.corners)).toBe(0)
    // the advisory takes over with its one-tap "Move to wall"
    expect(placementWarnings(s2.design).map((w) => w.itemId)).toContain(id)
  })

  it('snapToWall on a wall piece avoids openings (one-tap "Move to wall")', () => {
    const st = useStore.getState()
    st.addOpening('single', st.walls[0].id, 0.5)
    useStore.getState().addOpening('single', useStore.getState().walls[2].id, 0.5)
    const id = useStore.getState().addFurniture('decor-tv', 300, 200, 0) // stranded mid-room
    useStore.getState().snapToWall(id)
    const tv = item(id)
    expectFlushOnWall(tv)
    const wall = nearestWall(tv)
    const { tang } = wallCoords(tv, wall)
    for (const o of useStore.getState().design.openings) {
      if (o.wallId !== wall.id) continue
      const u = o.t * wall.length
      const disjoint =
        tang + tv.w / 2 <= u - o.width / 2 || tang - tv.w / 2 >= u + o.width / 2
      expect(disjoint).toBe(true)
    }
    expect(placementWarnings(useStore.getState().design)).toHaveLength(0)
  })
})

describe('floor / surface pieces keep the interior spawn', () => {
  it('a sofa still spawns at the staggered interior point, not on a wall', () => {
    const id = useStore.getState().addFurnitureCentered('sofa-3')
    const sofa = item(id)
    // first add in an empty room: interior point (300,200) staggered by (-40,-40)
    expect(sofa.x).toBeCloseTo(260, 3)
    expect(sofa.z).toBeCloseTo(160, 3)
  })

  it('a table lamp (surface piece) still spawns at the interior point', () => {
    const id = useStore.getState().addFurnitureCentered('decor-lamp-table')
    const lamp = item(id)
    expect(lamp.x).toBeCloseTo(260, 3)
    expect(lamp.z).toBeCloseTo(160, 3)
    // nothing beneath it → floor level
    const s2 = useStore.getState()
    expect(elevationCm(lamp, s2.design.furniture, s2.design.corners)).toBe(0)
  })

  it('a TV dragged onto a console still rests on it (surface behavior intact)', () => {
    useStore.getState().addFurniture('storage-media', 300, 300, 0)
    const id = useStore.getState().addFurnitureCentered('decor-tv')
    // simulate dragging the wall-mounted TV onto the console
    useStore.getState().updateFurniture(id, { x: 300, z: 300 })
    const tv = item(id)
    const s2 = useStore.getState()
    const consoleH = ARCHETYPE_MAP['storage-media'].h
    expect(elevationCm(tv, s2.design.furniture, s2.design.corners)).toBe(consoleH)
    // resting on a surface is legitimate → no warning even mid-room
    expect(placementWarnings(s2.design)).toHaveLength(0)
  })
})
