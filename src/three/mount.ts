import type { FurnitureItem, Opening, Vec2, Wall } from '../types'
import { ARCHETYPE_MAP, mountOf } from '../data/archetypes'
import { footprintCorners } from '../geometry/collision'

// ───────────────────────────────────────────────────────────────────────────
// Vertical placement (stacking / wall-mounting) + wall-spawn placement.
//
// Floor items sit at y=0. Wall items (TV, mirror, floating shelf) and surface
// items (table lamp) are lifted: onto a piece of furniture beneath them when one
// is there (e.g. a TV resting on a media console, a lamp on a side table), else
// to a sensible wall height. Numbers come from interior-design standards
// (TV center ≈107cm, gallery/art center ≈145cm, floating shelf ≈130cm).
//
// `findWallSpawn` picks the spot a freshly-added wall piece should occupy:
// the nearest wall with a free span at the piece's mount height, avoiding
// door/window holes, other wall pieces and tall furniture against the wall.
// ───────────────────────────────────────────────────────────────────────────

const TV_CENTER_CM = 107
const WALL_SHELF_BASE_CM = 130
const FAN_CEILING_CM = 268 // canopy at a ~270cm ceiling (fan hangs below)
const GEYSER_BASE_CM = 185 // wall-hung water heater, near the ceiling
const CURTAIN_TOP_CM = 228 // rod just above the window lintel
const AC_BASE_CM = 218 // split-AC indoor unit near the ceiling
// Double-height (duplex) pieces. The gallery slab's underside sits where a real
// duplex's upper floor does (~2.8m), so a default `stair-floating` (h=310) lands
// its top tread flush with the mezzanine deck. Change one and the stair stops
// meeting the gallery.
const MEZZANINE_BASE_CM = 280
// Lowest crystal of the cascade chandelier: clears a standing head / dining table
// under it. The drop (item.h) then rises toward a ~5.6m double-height ceiling.
const CHANDELIER_BASE_CM = 245
const MAX_SUPPORT_CM = 95 // don't try to stack onto a wardrobe / tall shelf

/**
 * cm — a wall-mounted piece whose center is farther than this from every wall
 * is "floating" mid-room. Shared by the placement-warning advisory (suggestions
 * engine) and by `elevationCm`, which floor-stands such a piece instead of
 * hanging it in mid-air.
 */
export const WALL_ATTACH_THRESHOLD_CM = 70

/** Wall-mount models that hang at a fixed height regardless of walls/support. */
const FIXED_HEIGHT_MODELS = new Set(['fan', 'curtain', 'ac', 'mezzanine', 'chandelier'])

/**
 * Pieces that hang from the CEILING, so being mid-room is their correct place,
 * not a mis-placement. The "isn't against a wall" advisory must skip these, or
 * every chandelier over a dining table is flagged as broken.
 */
export function isCeilingHung(archetypeId: string): boolean {
  const m = ARCHETYPE_MAP[archetypeId]?.model
  return m === 'fan' || m === 'chandelier'
}

/** Is world point (x,z) inside item's rotated footprint? (cm) */
function pointInFootprint(item: FurnitureItem, x: number, z: number): boolean {
  const dx = x - item.x
  const dz = z - item.z
  const c = Math.cos(item.rotation)
  const s = Math.sin(item.rotation)
  // inverse of the footprint mapping (see geometry/collision.ts):
  // local = R^T · delta
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  return Math.abs(lx) <= item.w / 2 && Math.abs(lz) <= item.d / 2
}

/**
 * Top height (cm) of the tallest floor piece directly beneath (x,z) that could
 * act as a surface (a table/console/cabinet up to MAX_SUPPORT_CM). 0 if none.
 */
function supportHeightAt(furniture: FurnitureItem[], x: number, z: number, selfId: string): number {
  let top = 0
  for (const f of furniture) {
    if (f.id === selfId) continue
    if (mountOf(f.archetype) !== 'floor') continue
    if (f.h < 25 || f.h > MAX_SUPPORT_CM) continue // too low (rug) or too tall to stack on
    if (!pointInFootprint(f, x, z)) continue
    if (f.h > top) top = f.h
  }
  return top
}

/** True if a piece is resting on a surface beneath it (e.g. a TV on a console). */
export function restsOnSurface(item: FurnitureItem, furniture: FurnitureItem[]): boolean {
  return supportHeightAt(furniture, item.x, item.z, item.id) > 0
}

/**
 * Mounted pieces (wall/surface) currently resting on `host` — i.e. their center
 * sits within the host's footprint and the host is a stackable surface. Used to
 * carry a lamp/TV along when its table/console is moved or rotated.
 */
export function dependentsOf(host: FurnitureItem, furniture: FurnitureItem[]): FurnitureItem[] {
  if (mountOf(host.archetype) !== 'floor') return []
  if (host.h < 25 || host.h > MAX_SUPPORT_CM) return []
  return furniture.filter(
    (f) => f.id !== host.id && mountOf(f.archetype) !== 'floor' && pointInFootprint(host, f.x, f.z),
  )
}

/**
 * Design-standard floor-to-base height (cm) a wall piece hangs at when mounted
 * on a wall with nothing beneath it. Ceiling-referenced pieces (fan / curtain /
 * split AC) are included so callers can reason about the vertical band any
 * mounted piece occupies on a wall.
 */
export function wallMountElevationCm(item: Pick<FurnitureItem, 'archetype' | 'h'>): number {
  const a = ARCHETYPE_MAP[item.archetype]
  // Ceiling-hung: the fan's canopy is its local y=0, so it hangs downward from
  // just below the ceiling regardless of what's underneath it.
  if (a?.model === 'fan') return FAN_CEILING_CM - item.h
  // Curtains hang from a rod above the window lintel; AC sits near the ceiling.
  if (a?.model === 'curtain') return Math.max(0, CURTAIN_TOP_CM - item.h)
  if (a?.model === 'ac') return AC_BASE_CM
  if (a?.model === 'mezzanine') return MEZZANINE_BASE_CM
  if (a?.model === 'chandelier') return CHANDELIER_BASE_CM
  if (a?.model === 'tv') return Math.max(40, TV_CENTER_CM - item.h / 2)
  if (item.archetype === 'storage-wall-shelf') return WALL_SHELF_BASE_CM
  if (item.archetype === 'bath-geyser') return GEYSER_BASE_CM
  return 0 // mirrors etc. lean against the wall from the floor
}

/** Distance (cm) from a segment ab to point (px, pz). */
function distToSegmentCm(px: number, pz: number, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x
  const abz = b.z - a.z
  const len2 = abx * abx + abz * abz || 1
  let t = ((px - a.x) * abx + (pz - a.z) * abz) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (a.x + t * abx), pz - (a.z + t * abz))
}

/** Distance (cm) from point (x, z) to the nearest edge of the room polygon. */
export function distToNearestWallCm(x: number, z: number, corners: Vec2[]): number {
  let best = Infinity
  for (let i = 0; i < corners.length; i++) {
    best = Math.min(best, distToSegmentCm(x, z, corners[i], corners[(i + 1) % corners.length]))
  }
  return best
}

/**
 * Floor-to-base elevation (cm) for an item, accounting for what sits beneath it.
 *  - floor   → 0
 *  - surface → rests on the piece below (lamp on a table); 0 if nothing there
 *  - wall    → rests on the piece below (TV on a console); else a wall height
 *              (TVs centered ~107cm, floating shelves ~130cm, mirrors lean from floor)
 *
 * When the room polygon is supplied (`corners`), a wall piece that is nowhere
 * near a wall (beyond WALL_ATTACH_THRESHOLD_CM) and has no support beneath it
 * stands on the floor instead of floating mid-air — a TV rests on its pedestal
 * stand, a shelf sits on the floor — until it is moved to a wall. Omitting
 * `corners` keeps the legacy hang-at-wall-height behavior.
 */
export function elevationCm(
  item: FurnitureItem,
  furniture: FurnitureItem[],
  corners?: Vec2[],
): number {
  const mount = mountOf(item.archetype)
  if (mount === 'floor') return 0

  const a = ARCHETYPE_MAP[item.archetype]
  // Ceiling-referenced pieces hang at their height regardless of walls/support.
  // Without the mezzanine/chandelier here, a mid-room chandelier (or a gallery whose
  // deep deck puts its centre >70cm off the wall) would fall to the floor.
  if (a && FIXED_HEIGHT_MODELS.has(a.model)) {
    return wallMountElevationCm(item)
  }

  const support = supportHeightAt(furniture, item.x, item.z, item.id)
  if (mount === 'surface') return support
  // wall:
  if (support > 0) return support // resting on a console / credenza
  if (
    corners &&
    corners.length >= 3 &&
    distToNearestWallCm(item.x, item.z, corners) > WALL_ATTACH_THRESHOLD_CM
  ) {
    return 0 // mid-room with nothing beneath: stand on the floor, don't float
  }
  return wallMountElevationCm(item)
}

// ───────────────────────────────────────────────────────────────────────────
// Wall-spawn placement for wall-mounted pieces (TV / mirror / shelf / …).
// ───────────────────────────────────────────────────────────────────────────

/** cm of breathing room kept to openings, neighbours and wall ends. */
const SIDE_CLEAR_CM = 4
/** cm of slack in the vertical band-overlap test (touching ≠ overlapping). */
const V_CLEAR_CM = 2

interface Interval {
  min: number
  max: number
}

/** Do two vertical bands genuinely overlap (more than a V_CLEAR_CM touch)? */
function bandsOverlap(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMin < bMax - V_CLEAR_CM && bMin < aMax - V_CLEAR_CM
}

/**
 * Tangential intervals (cm along the wall, from wall.a) that a new wall piece
 * occupying vertical band [vMin, vMax] may NOT overlap on this wall:
 *  - door/window holes whose vertical extent crosses the band (skippable for
 *    curtains, which legitimately cover windows),
 *  - other wall pieces already mounted on this wall at an overlapping height,
 *  - tall floor furniture standing against the wall that reaches into the band.
 */
function blockedIntervalsOnWall(
  wall: Wall,
  piece: FurnitureItem,
  vMin: number,
  vMax: number,
  openings: Opening[],
  furniture: FurnitureItem[],
  halfThickness: number,
  ignoreOpenings: boolean,
): Interval[] {
  const out: Interval[] = []
  const L = wall.length

  if (!ignoreOpenings) {
    for (const o of openings) {
      if (o.wallId !== wall.id) continue
      if (!bandsOverlap(vMin, vMax, o.sill, o.sill + o.height)) continue
      const u = o.t * L
      out.push({ min: u - o.width / 2 - SIDE_CLEAR_CM, max: u + o.width / 2 + SIDE_CLEAR_CM })
    }
  }

  for (const f of furniture) {
    if (f.id === piece.id) continue
    const m = mountOf(f.archetype)
    if (m === 'wall') {
      // mounted on THIS wall? its center sits just inside the wall face
      const sd = (f.x - wall.a.x) * wall.nx + (f.z - wall.a.z) * wall.nz
      if (sd < 0 || sd > halfThickness + f.d + 15) continue
      const base = elevationCm(f, furniture)
      if (!bandsOverlap(vMin, vMax, base, base + f.h)) continue
      const tang = (f.x - wall.a.x) * wall.dirX + (f.z - wall.a.z) * wall.dirZ
      if (tang + f.w / 2 < 0 || tang - f.w / 2 > L) continue
      out.push({ min: tang - f.w / 2 - SIDE_CLEAR_CM, max: tang + f.w / 2 + SIDE_CLEAR_CM })
    } else if (m === 'floor') {
      // tall furniture against the wall (wardrobe, bookcase) blocks the band;
      // low pieces (consoles, credenzas) don't — the new piece hangs above them.
      if (f.h <= vMin + V_CLEAR_CM) continue
      const cs = footprintCorners(f.x, f.z, f.w, f.d, f.rotation)
      let sdMin = Infinity
      let tMin = Infinity
      let tMax = -Infinity
      for (const c of cs) {
        const sd = (c.x - wall.a.x) * wall.nx + (c.z - wall.a.z) * wall.nz
        const t = (c.x - wall.a.x) * wall.dirX + (c.z - wall.a.z) * wall.dirZ
        if (sd < sdMin) sdMin = sd
        if (t < tMin) tMin = t
        if (t > tMax) tMax = t
      }
      // would it intrude into the depth band the new piece occupies at the wall?
      if (sdMin > halfThickness + piece.d + SIDE_CLEAR_CM) continue
      if (tMax < 0 || tMin > L) continue
      out.push({ min: tMin - SIDE_CLEAR_CM, max: tMax + SIDE_CLEAR_CM })
    }
  }
  return out
}

/** Free tangential spans on [SIDE_CLEAR, L−SIDE_CLEAR] at least `need` cm wide. */
function freeSpans(L: number, need: number, blocked: Interval[]): Interval[] {
  const lo = SIDE_CLEAR_CM
  const hi = L - SIDE_CLEAR_CM
  if (hi - lo < need) return []
  const clamped = blocked
    .map((b) => ({ min: Math.max(lo, b.min), max: Math.min(hi, b.max) }))
    .filter((b) => b.max > b.min)
    .sort((a, b) => a.min - b.min)
  const spans: Interval[] = []
  let cursor = lo
  for (const b of clamped) {
    if (b.min - cursor >= need) spans.push({ min: cursor, max: b.min })
    cursor = Math.max(cursor, b.max)
  }
  if (hi - cursor >= need) spans.push({ min: cursor, max: hi })
  return spans
}

export interface WallSpawnSpot {
  x: number
  z: number
  /** facing into the room, back against the wall */
  rotation: number
  wallId: string
}

/**
 * Where should a freshly-added wall-mounted piece go? The nearest wall (to
 * `preferPoint`, usually the room's interior point) that has a free span wide
 * enough at the piece's mount height — never over a door/window hole, another
 * wall piece, or tall furniture standing against the wall. Within the chosen
 * wall the piece is centered on the widest free span. Curtains are special:
 * they belong OVER windows, so the widest window is tried first.
 *
 * Returns null when no wall can take the piece (e.g. all walls are glass).
 */
export function findWallSpawn(
  piece: FurnitureItem,
  walls: Wall[],
  openings: Opening[],
  furniture: FurnitureItem[],
  opts: { wallThickness: number; preferPoint?: Vec2 },
): WallSpawnSpot | null {
  if (!walls.length) return null
  const halfT = opts.wallThickness / 2
  const vMin = wallMountElevationCm(piece)
  const vMax = vMin + piece.h
  const isCurtain = ARCHETYPE_MAP[piece.archetype]?.model === 'curtain'
  const prefer = opts.preferPoint ?? { x: piece.x, z: piece.z }

  const placeAt = (wall: Wall, u: number): WallSpawnSpot => {
    const inset = halfT + piece.d / 2 + 0.5
    return {
      x: wall.a.x + wall.dirX * u + wall.nx * inset,
      z: wall.a.z + wall.dirZ * u + wall.nz * inset,
      rotation: Math.atan2(wall.nx, wall.nz),
      wallId: wall.id,
    }
  }

  // Curtains: center on the widest window whose wall can take them.
  if (isCurtain) {
    const windows = openings
      .filter((o) => o.kind === 'window')
      .sort((a, b) => b.width - a.width)
    for (const win of windows) {
      const wall = walls.find((w) => w.id === win.wallId)
      if (!wall) continue
      const uMin = SIDE_CLEAR_CM + piece.w / 2
      const uMax = wall.length - SIDE_CLEAR_CM - piece.w / 2
      if (uMax < uMin) continue // curtain wider than the wall
      const u = Math.max(uMin, Math.min(uMax, win.t * wall.length))
      const blocked = blockedIntervalsOnWall(
        wall, piece, vMin, vMax, openings, furniture, halfT, true,
      )
      const clear = !blocked.some((b) => u + piece.w / 2 > b.min && u - piece.w / 2 < b.max)
      if (clear) return placeAt(wall, u)
    }
  }

  const ranked = [...walls].sort(
    (w1, w2) =>
      distToSegmentCm(prefer.x, prefer.z, w1.a, w1.b) -
      distToSegmentCm(prefer.x, prefer.z, w2.a, w2.b),
  )
  for (const wall of ranked) {
    const blocked = blockedIntervalsOnWall(
      wall, piece, vMin, vMax, openings, furniture, halfT, isCurtain,
    )
    const spans = freeSpans(wall.length, piece.w, blocked)
    if (!spans.length) continue
    let best = spans[0]
    for (const s of spans) if (s.max - s.min > best.max - best.min) best = s
    return placeAt(wall, (best.min + best.max) / 2)
  }
  return null
}

/**
 * Fallback when no wall can take the piece (every span blocked by openings):
 * stand it on the floor near the closest wall, just OUTSIDE the attach
 * threshold — so `elevationCm` floor-stands it and the placement-warning
 * advisory (with its one-tap "Move to wall") fires to hand control back to
 * the user.
 */
export function floorFallbackSpawn(
  piece: FurnitureItem,
  walls: Wall[],
  preferPoint: Vec2,
  _wallThickness: number,
): { x: number; z: number; rotation: number } | null {
  if (!walls.length) return null
  let best = walls[0]
  let bestDist = Infinity
  for (const w of walls) {
    const d = distToSegmentCm(preferPoint.x, preferPoint.z, w.a, w.b)
    if (d < bestDist) {
      bestDist = d
      best = w
    }
  }
  const tang = (preferPoint.x - best.a.x) * best.dirX + (preferPoint.z - best.a.z) * best.dirZ
  const u = Math.max(piece.w / 2, Math.min(best.length - piece.w / 2, tang))
  // center distance from the wall centerline must exceed the attach threshold
  const standoff = WALL_ATTACH_THRESHOLD_CM + piece.d / 2 + 12
  return {
    x: best.a.x + best.dirX * u + best.nx * standoff,
    z: best.a.z + best.dirZ * u + best.nz * standoff,
    rotation: Math.atan2(best.nx, best.nz), // face the room, back to the wall
  }
}
