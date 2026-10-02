/**
 * Storeys for the house session — the ONE place that decides which rooms a view
 * sees and at what height. Every consumer (3D house view, 2D plan, flythrough
 * colliders, collider debug) goes through these helpers, so a house of any
 * number of levels behaves the same everywhere.
 *
 * Model: a RoomEntry carries `level` (index, 0 = ground; absent ⇒ 0, so every
 * pre-existing single-storey flat is unchanged). The session's `levels` array
 * describes each index (label + floor elevation). Rooms on different levels may
 * overlap in plan — that is the point — so anything planar (doorway cutting,
 * drag/resize overlap push, the 2D plan, walk colliders) is scoped to ONE level.
 */
import type { RoomDesign, FurnitureItem } from '../types'
import { isStair, type RoomPlacement, type PlacedRoom } from './houseLayout'
import { ARCHETYPE_MAP } from '../data/archetypes'
import { bbox } from '../geometry/walls'
import type { LevelFilter } from './houseViewMode'

export interface HouseLevel {
  /** short user-facing name, e.g. 'Ground floor' */
  label: string
  /** finished-floor height of this storey above the ground floor (cm) */
  elevationCm: number
}

/** A room's storey index (absent ⇒ ground). */
export const levelOf = (r: { level?: number }): number => r.level ?? 0

/** Floor elevation (cm) of a storey; an undescribed level sits on the ground. */
export const elevationOfLevel = (levels: HouseLevel[], level: number): number => levels[level]?.elevationCm ?? 0

/** The single storey a PLANAR surface works on (2D plan, walk colliders): the
 *  isolated level, or — when every level is shown — the active room's level. */
export const focusLevel = (filter: LevelFilter, activeLevel: number): number =>
  filter === 'all' ? activeLevel : filter

/**
 * The placements the 3D house view draws: the isolated storey (or every storey)
 * and, when `roomIds` is non-empty, only those rooms (matched on design.id,
 * which equals the session room id). An id that matches nothing is ignored.
 */
export function visiblePlacements<T extends { level: number; design: { id: string } }>(
  placed: T[],
  filter: LevelFilter,
  roomIds: readonly string[] = [],
): T[] {
  const ids = new Set(roomIds)
  return placed.filter((p) => (filter === 'all' || p.level === filter) && (ids.size === 0 || ids.has(p.design.id)))
}

interface SessionLike {
  rooms: Array<{ id: string; design: RoomDesign; pos?: { x: number; z: number }; type: string; level?: number }>
  activeId: string | null
  levels: HouseLevel[]
}

/**
 * Room placements for layoutHouse, with the live editor design merged in for
 * the active room and each room's level + elevation attached.
 * `only`: keep a single storey (planar consumers); omit to keep every storey.
 */
export function placementsFor(s: SessionLike, live: RoomDesign, only?: number): RoomPlacement[] {
  return s.rooms
    .filter((r) => only === undefined || levelOf(r) === only)
    .map((r) => ({
      design: r.id === s.activeId ? live : r.design,
      pos: r.pos,
      type: r.type,
      level: levelOf(r),
      elevationCm: elevationOfLevel(s.levels, levelOf(r)),
    }))
}

/** Storey of the active room (0 when none). */
export function activeLevel(s: SessionLike): number {
  const r = s.rooms.find((x) => x.id === s.activeId)
  return r ? levelOf(r) : 0
}

// ───────────────────────────────────────────────────────────────────────────
// Walking between storeys (first-person flythrough)
// ───────────────────────────────────────────────────────────────────────────

/** Within this many cm below a storey's floor you count as ON that storey — so
 *  the upper storey's walls take over for the last steps of a flight. */
const STOREY_SNAP_CM = 60
/** Openings/walls must reach this far above a storey's floor to matter on it. */
const WALKABLE_SILL_CM = 15
const ROOM_EDGE_TOL_CM = 3
const STAIR_APRON_CM = 40

/** Storey index the walker is on at floor height `floorCm`. */
export function levelAtFloor(levels: HouseLevel[], floorCm: number): number {
  let lvl = 0
  levels.forEach((l, i) => {
    if (l.elevationCm <= floorCm + STOREY_SNAP_CM) lvl = i
  })
  return lvl
}

/**
 * Collider placements for the storey at `floorCm`: that storey's rooms, plus
 * every LOWER room tall enough to reach into it (a double-height hall or
 * stairwell). Those tall rooms keep only the openings that exist at this
 * storey, re-based to its floor — so the upstairs door onto a stairwell is a
 * gap, while the ground-floor doorway beneath it is not — and none of their
 * furniture (it stands on the floor below).
 */
export function storeyColliderPlacements(s: SessionLike, live: RoomDesign, floorCm: number): RoomPlacement[] {
  const level = levelAtFloor(s.levels, floorCm)
  const base = elevationOfLevel(s.levels, level)
  const out: RoomPlacement[] = []
  for (const p of placementsFor(s, live)) {
    const lv = p.level ?? 0
    const elev = p.elevationCm ?? 0
    if (lv === level) {
      out.push(p)
    } else if (lv < level && elev + p.design.wallHeight > base + WALKABLE_SILL_CM) {
      const openings = p.design.openings
        .filter((o) => elev + o.sill + o.height > base + WALKABLE_SILL_CM)
        .map((o) => ({ ...o, sill: Math.max(0, elev + o.sill - base) }))
      out.push({ ...p, design: { ...p.design, openings, furniture: [] } })
    }
  }
  return out
}

/**
 * Height (cm above the item's floor) of a stair's walking surface at a point in
 * its LOCAL frame (cm, centred; front = +z), or null if off the stair. Mirrors
 * the tread geometry in Furniture3D (buildStaircase / buildStaircaseU).
 */
export function stairSurfaceCm(f: Pick<FurnitureItem, 'archetype' | 'w' | 'd' | 'h'>, lx: number, lz: number): number | null {
  if (Math.abs(lx) > f.w / 2 || Math.abs(lz) > f.d / 2) return null
  const model = ARCHETYPE_MAP[f.archetype]?.model
  if (model === 'staircase') {
    // straight flight: 0 at the front edge, h at the back
    return (f.h * (f.d / 2 - lz)) / f.d
  }
  if (model === 'staircaseU') {
    const wall = 8
    const fw = Math.max(30, (f.w - wall) / 2)
    const land = Math.min(fw, f.d * 0.45)
    const run = f.d - land
    if (lz < -f.d / 2 + land) return f.h / 2 // half-landing
    const s = (f.d / 2 - lz) / run // 0 at the front → 1 at the landing
    return lx < 0 ? (s * f.h) / 2 : f.h - (s * f.h) / 2 // flight A (−x) climbs, B returns
  }
  return null
}

/**
 * Floor height (cm above the ground floor) under plan point (x, z), choosing
 * among everything walkable there — each storey's room floor and any stair
 * surface — the one nearest `currentFloorCm`. null when nothing is underfoot
 * (outside every room, e.g. beyond a glass rail over a void).
 */
export function floorHeightAt(placed: PlacedRoom[], x: number, z: number, currentFloorCm: number): number | null {
  let best: number | null = null
  const consider = (h: number) => {
    if (best === null || Math.abs(h - currentFloorCm) < Math.abs(best - currentFloorCm)) best = h
  }
  for (const p of placed) {
    const bb = bbox(p.design.corners)
    const ox = p.centerCm.x - bb.cx
    const oz = p.centerCm.z - bb.cz
    // A stair REPLACES its own room's floor where it stands — offering both let
    // "nearest to where you are" keep choosing the floor, so you never climbed.
    let stair: number | null = null
    for (const f of p.design.furniture) {
      if (!isStair(f.archetype)) continue
      // world → stair-local (inverse of the Y rotation the renderer applies)
      const ux = x - (f.x + ox)
      const uz = z - (f.z + oz)
      const c = Math.cos(f.rotation)
      const sn = Math.sin(f.rotation)
      const h = stairSurfaceCm(f, ux * c - uz * sn, ux * sn + uz * c)
      if (h !== null && (stair === null || Math.abs(p.elevationCm + h - currentFloorCm) < Math.abs(stair - currentFloorCm))) {
        stair = p.elevationCm + h
      }
    }
    if (stair !== null) {
      consider(stair)
      continue
    }
    // Just beyond a flight's end, its end height is walkable too (an APRON):
    // the top tread rarely meets the upper floor edge exactly (the furniture
    // placer can nudge a stair back, and walls take thickness), and in that seam
    // the only floor below is the storey beneath — a refused step, i.e. stuck at
    // the top. Offered ALONGSIDE the room floor (not replacing it), so on the
    // ground floor in front of a stair you still stand on the ground.
    for (const f of p.design.furniture) {
      if (!isStair(f.archetype)) continue
      const ux = x - (f.x + ox)
      const uz = z - (f.z + oz)
      const c = Math.cos(f.rotation)
      const sn = Math.sin(f.rotation)
      const lx = ux * c - uz * sn
      const lz = ux * sn + uz * c
      if (Math.abs(lx) > f.w / 2) continue
      if (lz > f.d / 2 && lz <= f.d / 2 + STAIR_APRON_CM) {
        const h = stairSurfaceCm(f, lx, f.d / 2) // front end: foot of A / top of B
        if (h !== null) consider(p.elevationCm + h)
      } else if (lz < -f.d / 2 && lz >= -f.d / 2 - STAIR_APRON_CM && ARCHETYPE_MAP[f.archetype]?.model === 'staircase') {
        consider(p.elevationCm + f.h) // a straight flight tops out at its back end
      }
    }
    // +ROOM_EDGE_TOL: rooms butt exactly, but centres rounded to whole cm (drag)
    // can open a hairline seam; without slack a doorway there reads as "no
    // floor" and the walker is refused passage
    if (Math.abs(x - p.centerCm.x) <= bb.w / 2 + ROOM_EDGE_TOL_CM && Math.abs(z - p.centerCm.z) <= bb.d / 2 + ROOM_EDGE_TOL_CM) {
      consider(p.elevationCm)
    }
  }
  return best
}
