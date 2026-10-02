/**
 * Room placement geometry: map a room's interior (local cm) into the house plane,
 * and detect SHARED WALLS between two placed rooms. Lives in geometry/ so the
 * world-transform + shared-wall math has a single home (no redundant copies).
 */
import type { Vec2 } from '../interior'
import type { Footprint, HouseRoom } from '../types'

/** Map a local interior point (cm) into world cm via the room's footprint. */
export function toWorld(p: Vec2, fp: Footprint): Vec2 {
  const r = fp.rotation || 0
  if (r === 0) return { x: p.x + fp.x, z: p.z + fp.z }
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return {
    x: fp.x + (p.x * cos - p.z * sin),
    z: fp.z + (p.x * sin + p.z * cos),
  }
}

/** The room's polygon in world cm. */
export function worldCorners(room: HouseRoom): Vec2[] {
  return room.interior.corners.map((c) => toWorld(c, room.footprint))
}

export interface WorldWall {
  index: number
  a: Vec2
  b: Vec2
  dirX: number
  dirZ: number
  length: number
}

/** A room's walls (corner edges) in world cm. */
export function worldWalls(room: HouseRoom): WorldWall[] {
  const pts = worldCorners(room)
  const n = pts.length
  const walls: WorldWall[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const length = Math.hypot(dx, dz)
    if (length < 1e-6) continue
    walls.push({ index: i, a, b, dirX: dx / length, dirZ: dz / length, length })
  }
  return walls
}

/** Perpendicular distance from point p to the infinite line through wall w. */
function distToLine(p: Vec2, w: WorldWall): number {
  // normal = (-dirZ, dirX); distance = |(p-a)·normal|
  return Math.abs((p.x - w.a.x) * -w.dirZ + (p.z - w.a.z) * w.dirX)
}

/** Signed position of point p projected onto wall w's direction, cm from w.a. */
function projectParam(p: Vec2, w: WorldWall): number {
  return (p.x - w.a.x) * w.dirX + (p.z - w.a.z) * w.dirZ
}

export interface SharedWallMatch {
  room_a_wall: number
  room_b_wall: number
  /** overlap interval expressed as t (0..1) along room A's wall */
  a_t0: number
  a_t1: number
  /** overlap length in cm */
  overlap_cm: number
}

/**
 * Find collinear, overlapping wall pairs between two placed rooms — i.e. walls
 * that physically coincide (within `tol` cm) so a connector could join them.
 * `tol` accommodates wall thickness / small placement gaps.
 */
export function findSharedWalls(
  roomA: HouseRoom,
  roomB: HouseRoom,
  opts: { tol?: number; minOverlap?: number } = {},
): SharedWallMatch[] {
  const tol = opts.tol ?? 25
  const minOverlap = opts.minOverlap ?? 30
  const wa = worldWalls(roomA)
  const wb = worldWalls(roomB)
  const matches: SharedWallMatch[] = []

  for (const a of wa) {
    for (const b of wb) {
      // collinear: both of B's endpoints lie on A's line
      if (distToLine(b.a, a) > tol || distToLine(b.b, a) > tol) continue
      // overlap of B's projection onto A with A's own [0, length]
      const s0 = projectParam(b.a, a)
      const s1 = projectParam(b.b, a)
      const lo = Math.max(0, Math.min(s0, s1))
      const hi = Math.min(a.length, Math.max(s0, s1))
      const overlap = hi - lo
      if (overlap < minOverlap) continue
      matches.push({
        room_a_wall: a.index,
        room_b_wall: b.index,
        a_t0: lo / a.length,
        a_t1: hi / a.length,
        overlap_cm: overlap,
      })
    }
  }
  // strongest overlaps first
  matches.sort((m, n) => n.overlap_cm - m.overlap_cm)
  return matches
}

/** True if the two rooms touch along at least one wall segment. */
export function areAdjacent(roomA: HouseRoom, roomB: HouseRoom, tol?: number): boolean {
  return findSharedWalls(roomA, roomB, { tol }).length > 0
}
