/**
 * House layout (Agent E, multi-room "whole house" view).
 *
 * Pure: given the session's rooms (Agent A RoomDesigns), arrange them into a
 * connected floor plan — placed ADJACENTLY in a row, sharing a wall, with a
 * DOORWAY cut between each consecutive pair so the rooms are interconnected
 * (not sealed boxes sitting next to each other).
 *
 * Coordinates are in DESIGN centimeters; `centerCm` is each room's bbox-center
 * position in the shared house plane (HouseView renders the room in a <group>
 * at centerCm/100 m, and makeFrame() centers the room on its bbox there).
 *
 * No coupling to Agent C's House model — this reuses only A's pure geometry
 * (bbox / deriveWalls). C's connector API formalizes the same idea; this is the
 * lightweight in-app layout for the overview.
 */
import { bbox, deriveWalls } from '../geometry/walls'
import { isWalkableFloor, ARCHETYPE_MAP } from '../data/archetypes'
import type { Opening, RoomDesign, Vec2, Wall } from '../types'

export interface PlacedRoom {
  design: RoomDesign
  /** bbox-center position in the house plane (world cm). */
  centerCm: { x: number; z: number }
  /** doorway openings to neighbours, added to the room's walls when rendering. */
  extraOpenings: Opening[]
  /** functional room type (drives realistic doorway rules); optional. */
  type?: string
  /** storey index (0 = ground) and its floor elevation (cm) — see houseLevels.ts */
  level: number
  elevationCm: number
}

const DOOR_WIDTH_CM = 90
const DOOR_HEIGHT_CM = 205
const ROOM_GAP_CM = 0 // touching, so the shared wall is exact
/** sill (cm) at/below which an opening reaches the floor → walkable (door); above = window (solid at floor). */
const WALKABLE_SILL_CM = 15

const TOUCH_TOL_CM = 30 // two rooms whose facing edges are within this are "adjacent"
const MIN_DOOR_OVERLAP_CM = 80 // need at least this much shared edge to fit a doorway

/** A rectangular room's bounding wall on a given side (house plane: z increases "down"). */
function edgeWall(walls: Wall[], side: 'left' | 'right' | 'top' | 'bottom'): Wall | undefined {
  if (side === 'left' || side === 'right') {
    const vertical = walls.filter((w) => Math.abs(w.dirX) < 0.25) // runs along z
    if (!vertical.length) return undefined
    return vertical.reduce((best, w) => (side === 'right' ? (w.midX > best.midX ? w : best) : w.midX < best.midX ? w : best))
  }
  const horizontal = walls.filter((w) => Math.abs(w.dirZ) < 0.25) // runs along x
  if (!horizontal.length) return undefined
  return horizontal.reduce((best, w) => (side === 'bottom' ? (w.midZ > best.midZ ? w : best) : w.midZ < best.midZ ? w : best))
}

function doorwayOn(wall: Wall, t: number, key: string): Opening {
  return {
    id: `connect_${key}`,
    kind: 'door',
    style: 'single',
    wallId: wall.id,
    t: Math.min(0.9, Math.max(0.1, t)),
    width: DOOR_WIDTH_CM,
    height: DOOR_HEIGHT_CM,
    sill: 0,
  }
}

/** Map a world-cm point near a wall to that wall's parametric t (placement = pure translation). */
function tForWorldPoint(wall: Wall, off: { x: number; z: number }, world: { x: number; z: number }): number {
  const lx = world.x - off.x
  const lz = world.z - off.z
  const dx = wall.b.x - wall.a.x
  const dz = wall.b.z - wall.a.z
  const len2 = dx * dx + dz * dz
  if (len2 < 1e-6) return 0.5
  return ((lx - wall.a.x) * dx + (lz - wall.a.z) * dz) / len2
}

/** A room to place: its design + an OPTIONAL explicit house-plane center (cm). */
export interface RoomPlacement {
  design: RoomDesign
  /** explicit bbox-center in the house plane (cm). Undefined ⇒ auto-arranged. */
  pos?: { x: number; z: number }
  /** functional room type (bedroom/bathroom/kitchen/…) for realistic doorway rules. */
  type?: string
  /** storey index (absent ⇒ 0) and floor elevation in cm (absent ⇒ 0) */
  level?: number
  elevationCm?: number
}

/**
 * Arrange rooms into a 2D floor plan (NOT a straight strip):
 *  - rooms with an explicit `pos` are placed there (drag / template);
 *  - the rest are packed into a near-square grid (⌈√n⌉ per row), touching;
 * then a doorway is cut between EVERY pair of rooms that share a wall edge
 * (vertical OR horizontal), so the whole plan is interconnected.
 */
const storey = (r: RoomPlacement) => ({ level: r.level ?? 0, elevationCm: r.elevationCm ?? 0 })

export function layoutHouse(rooms: RoomPlacement[]): PlacedRoom[] {
  const placed: PlacedRoom[] = []
  const autoCount = rooms.filter((r) => !r.pos).length
  const cols = Math.max(1, Math.ceil(Math.sqrt(autoCount || rooms.length)))

  // When SOME rooms are explicitly positioned (drag / template) and others are not,
  // start the auto-grid to the RIGHT of every positioned room so a freshly added
  // (un-positioned) room never lands on top of a positioned one.
  const positioned = rooms.filter((r) => r.pos)
  const baseX =
    positioned.length > 0 && positioned.length < rooms.length
      ? Math.max(...positioned.map((r) => r.pos!.x + bbox(r.design.corners).w / 2)) + 60
      : 0
  let col = 0
  let cursorX = baseX
  let rowZ = 0
  let rowMaxD = 0
  for (const r of rooms) {
    const bb = bbox(r.design.corners)
    if (r.pos) {
      placed.push({ design: r.design, centerCm: { x: r.pos.x, z: r.pos.z }, extraOpenings: [], type: r.type, ...storey(r) })
      continue
    }
    if (col === cols) {
      col = 0
      cursorX = baseX
      rowZ += rowMaxD + ROOM_GAP_CM
      rowMaxD = 0
    }
    placed.push({ design: r.design, centerCm: { x: cursorX + bb.w / 2, z: rowZ + bb.d / 2 }, extraOpenings: [], type: r.type, ...storey(r) })
    cursorX += bb.w + ROOM_GAP_CM
    rowMaxD = Math.max(rowMaxD, bb.d)
    col++
  }

  cutSharedDoorways(placed)
  return placed
}

/** Cut a doorway in both rooms of every pair that shares a (vertical or horizontal) wall edge. */
function cutSharedDoorways(placed: PlacedRoom[]): void {
  const info = placed.map((p) => {
    const bb = bbox(p.design.corners)
    return {
      p,
      walls: deriveWalls(p.design.corners),
      off: { x: p.centerCm.x - bb.cx, z: p.centerCm.z - bb.cz },
      box: { minX: p.centerCm.x - bb.w / 2, maxX: p.centerCm.x + bb.w / 2, minZ: p.centerCm.z - bb.d / 2, maxZ: p.centerCm.z + bb.d / 2 },
    }
  })
  let key = 0
  const connect = (
    R1: (typeof info)[number],
    s1: 'left' | 'right' | 'top' | 'bottom',
    R2: (typeof info)[number],
    s2: 'left' | 'right' | 'top' | 'bottom',
    world: { x: number; z: number },
  ) => {
    const w1 = edgeWall(R1.walls, s1)
    const w2 = edgeWall(R2.walls, s2)
    const k = key++
    if (w1) R1.p.extraOpenings.push(doorwayOn(w1, tForWorldPoint(w1, R1.off, world), `${R1.p.design.id}_${k}`))
    if (w2) R2.p.extraOpenings.push(doorwayOn(w2, tForWorldPoint(w2, R2.off, world), `${R2.p.design.id}_${k}`))
  }
  for (let i = 0; i < info.length; i++) {
    for (let j = i + 1; j < info.length; j++) {
      const A = info[i]
      const B = info[j]
      // Realism: don't connect two bedrooms (or two baths) directly — those are
      // reached from the hall/corridor, not from each other.
      const ta = A.p.type
      const tb = B.p.type
      if ((ta === 'bedroom' && tb === 'bedroom') || (ta === 'bathroom' && tb === 'bathroom')) continue
      // A design that authors ALL its circulation (listing replicas: sliders,
      // passages, wooden doors placed exactly) opts out of auto-cutting.
      if (A.p.design.autoDoorways === false || B.p.design.autoDoorways === false) continue
      // rooms on different storeys overlap/abut in plan by design — never "neighbours"
      if (A.p.level !== B.p.level) continue
      const zOverlap = Math.min(A.box.maxZ, B.box.maxZ) - Math.max(A.box.minZ, B.box.minZ)
      const xOverlap = Math.min(A.box.maxX, B.box.maxX) - Math.max(A.box.minX, B.box.minX)
      if (zOverlap > MIN_DOOR_OVERLAP_CM) {
        const cz = (Math.max(A.box.minZ, B.box.minZ) + Math.min(A.box.maxZ, B.box.maxZ)) / 2
        if (Math.abs(A.box.maxX - B.box.minX) <= TOUCH_TOL_CM) connect(A, 'right', B, 'left', { x: (A.box.maxX + B.box.minX) / 2, z: cz })
        else if (Math.abs(B.box.maxX - A.box.minX) <= TOUCH_TOL_CM) connect(B, 'right', A, 'left', { x: (B.box.maxX + A.box.minX) / 2, z: cz })
      }
      if (xOverlap > MIN_DOOR_OVERLAP_CM) {
        const cx = (Math.max(A.box.minX, B.box.minX) + Math.min(A.box.maxX, B.box.maxX)) / 2
        if (Math.abs(A.box.maxZ - B.box.minZ) <= TOUCH_TOL_CM) connect(A, 'bottom', B, 'top', { x: cx, z: (A.box.maxZ + B.box.minZ) / 2 })
        else if (Math.abs(B.box.maxZ - A.box.minZ) <= TOUCH_TOL_CM) connect(B, 'bottom', A, 'top', { x: cx, z: (B.box.maxZ + A.box.minZ) / 2 })
      }
    }
  }
}

/** Is this archetype a staircase (straight or dog-leg)? */
export const isStair = (archetypeId: string): boolean => {
  const m = ARCHETYPE_MAP[archetypeId]?.model
  return m === 'staircase' || m === 'staircaseU'
}

/** OBB footprint (cm) — matches the flythrough Colliders contract. */
export interface OBB {
  cx: number
  cz: number
  w: number
  d: number
  rot: number
}

/** Colliders for the whole house (cm), shaped like the flythrough scene contract. */
export interface HouseColliders {
  walls: Wall[]
  furniture: OBB[]
  polygon: Vec2[]
  wallThickness: number
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number }
}

/** Translate a wall (a/b/mid) by an offset; direction + normal unchanged. */
function offsetWall(w: Wall, off: { x: number; z: number }): Wall {
  return {
    ...w,
    a: { x: w.a.x + off.x, z: w.a.z + off.z },
    b: { x: w.b.x + off.x, z: w.b.z + off.z },
    midX: w.midX + off.x,
    midZ: w.midZ + off.z,
  }
}

/**
 * Split a wall into the SOLID sub-segments left after subtracting its openings
 * (doorways/windows). Each sub-segment is a finite wall collider; the opening
 * spans become walkable GAPS (the segment-aware solver skips out-of-span walls).
 */
function splitWall(w: Wall, openings: Opening[]): Wall[] {
  if (openings.length === 0) return [w]
  // opening spans in cm along the wall, clamped + merged
  const spans = openings
    .map((o) => {
      const c = o.t * w.length
      const half = o.width / 2
      return [Math.max(0, c - half), Math.min(w.length, c + half)] as [number, number]
    })
    .filter(([s0, s1]) => s1 > s0)
    .sort((p, q) => p[0] - q[0])

  const merged: [number, number][] = []
  for (const s of spans) {
    const last = merged[merged.length - 1]
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1])
    else merged.push([...s])
  }

  // solid sub-segments = [0, length] minus merged opening spans
  const solids: [number, number][] = []
  let cursor = 0
  for (const [s0, s1] of merged) {
    if (s0 - cursor > 2) solids.push([cursor, s0])
    cursor = Math.max(cursor, s1)
  }
  if (w.length - cursor > 2) solids.push([cursor, w.length])

  return solids.map(([s0, s1], i) => ({
    ...w,
    id: `${w.id}_seg${i}`,
    a: { x: w.a.x + w.dirX * s0, z: w.a.z + w.dirZ * s0 },
    b: { x: w.a.x + w.dirX * s1, z: w.a.z + w.dirZ * s1 },
    length: s1 - s0,
    midX: w.a.x + w.dirX * ((s0 + s1) / 2),
    midZ: w.a.z + w.dirZ * ((s0 + s1) / 2),
  }))
}

/**
 * Build the collision world for the WHOLE house, in the shared house-plane
 * (design cm) that HouseView renders.
 *
 * Walls are emitted as thin OBBs (not half-planes): the flythrough solver pushes
 * the walker OUT of each box, which blocks BIDIRECTIONALLY (so you can't clip a
 * shared interior wall from either room) and avoids the over-constraint of
 * stacking every room's inward half-planes. Each wall is split around its
 * openings, so DOORWAY gaps have no box and are walkable. `walls` is left empty;
 * the house perimeter polygon is the safety fallback. Frame center = bounds center.
 */
export function houseColliders(placed: PlacedRoom[]): HouseColliders {
  const b = houseBoundsCm(placed)
  const furniture: OBB[] = []
  let wallThickness = 12

  for (const p of placed) {
    const bb = bbox(p.design.corners)
    const off = { x: p.centerCm.x - bb.cx, z: p.centerCm.z - bb.cz }
    wallThickness = p.design.wallThickness
    const allOpenings = [...p.design.openings, ...p.extraOpenings]
    for (const w of deriveWalls(p.design.corners)) {
      // Only FLOOR-REACHING openings (doors / open connectors, sill ≈ 0) are
      // walkable gaps. A WINDOW has wall below its sill, so at the floor plane
      // (where the walker is) it's SOLID — you must not walk through a window.
      // A WINDOW is never walkable even at sill 0: a floor-level glass rail
      // (over a double-height void, round a balcony) is exactly that, and
      // treating it as a doorway let the walker step through the glass.
      const ops = allOpenings.filter(
        (o) => o.wallId === w.id && o.kind !== 'window' && o.sill <= WALKABLE_SILL_CM,
      )
      for (const seg of splitWall(w, ops)) {
        const s = offsetWall(seg, off)
        // thin wall box: length along the wall (local +x), thickness across it.
        furniture.push({
          cx: s.midX,
          cz: s.midZ,
          w: s.length,
          d: p.design.wallThickness,
          rot: Math.atan2(-s.dirZ, s.dirX),
        })
      }
    }
    for (const f of p.design.furniture) {
      // Flat floor coverings (rugs/carpets) are walked OVER, not into — skip them
      // as walk colliders so you don't hit an invisible wall at a rug's edge.
      if (isWalkableFloor(f.archetype, f.h)) continue
      // Stairs are walked ON (the floor follows their treads — houseLevels
      // floorHeightAt); as a collider box they made every flight impassable.
      if (isStair(f.archetype)) continue
      furniture.push({ cx: f.x + off.x, cz: f.z + off.z, w: f.w, d: f.d, rot: f.rotation })
    }
  }

  const polygon: Vec2[] = [
    { x: b.minX, z: b.minZ },
    { x: b.maxX, z: b.minZ },
    { x: b.maxX, z: b.maxZ },
    { x: b.minX, z: b.maxZ },
  ]
  return { walls: [], furniture, polygon, wallThickness, bounds: { minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ } }
}

/** Whole-house bounding box (world cm) for camera framing. */
export function houseBoundsCm(placed: PlacedRoom[]): {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  w: number
  d: number
  cx: number
  cz: number
} {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of placed) {
    const bb = bbox(p.design.corners)
    minX = Math.min(minX, p.centerCm.x - bb.w / 2)
    maxX = Math.max(maxX, p.centerCm.x + bb.w / 2)
    minZ = Math.min(minZ, p.centerCm.z - bb.d / 2)
    maxZ = Math.max(maxZ, p.centerCm.z + bb.d / 2)
  }
  if (!placed.length) {
    minX = maxX = minZ = maxZ = 0
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    w: maxX - minX,
    d: maxZ - minZ,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
  }
}
