/**
 * Door swing arcs (C4). A hinged/double door's leaf sweeps a quarter-circle that
 * must clear fixtures (AC7). We compute the swept sector in the INTO-room's local
 * cm space (where its furniture lives) and test it against furniture OBBs and
 * other door arcs. Open connectors (no swing) have no arc.
 */
import type { Vec2 } from '../interior'
import type { Connector, House } from '../types'
import { connectorInfo } from '../data/connectorTypes'
import { deriveWalls, pointOnWall } from './walls'
import { obbOf, obbCorners, pointInObb, segmentIntersectsObb, type OBB } from './obb'
import { connectorOpenings } from '../connectors'
import { getRoom } from '../house'

export interface SwingLeaf {
  hinge: Vec2
  /** unit vector along the wall (closed-leaf direction) */
  closedDir: Vec2
  /** unit inward normal (open-leaf direction, into the room) */
  openDir: Vec2
  radius: number // cm (leaf length)
}

export interface SwingArc {
  connector_id: string
  into_room: string
  wallIndex: number
  leaves: SwingLeaf[]
}

const SWEEP_STEPS = 8

function cross(a: Vec2, b: Vec2): number {
  return a.x * b.z - a.z * b.x
}

function rotate(v: Vec2, ang: number): Vec2 {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  return { x: v.x * c - v.z * s, z: v.x * s + v.z * c }
}

function unit(x: number, z: number): Vec2 {
  const m = Math.hypot(x, z) || 1
  return { x: x / m, z: z / m }
}

/**
 * Build the swing arc for a connector, in the into-room's local space.
 * Returns null for open connectors (swing === null).
 */
export function swingArc(connector: Connector, house: House): SwingArc | null {
  if (!connector.swing) return null
  const intoId = connector.swing.into_room
  const room = getRoom(house, intoId)
  if (!room) return null

  // Which wall index belongs to the into-room?
  const wallIndex =
    intoId === connector.between[0] ? connector.shared_wall.room_a_wall : connector.shared_wall.room_b_wall
  const walls = deriveWalls(room.interior.corners)
  const wall = walls.find((w) => w.index === wallIndex)
  if (!wall) return null

  // The opening's local t in THIS room (connectorOpenings already projects it).
  const [oa, ob] = connectorOpenings(connector, house)
  const localOpening = oa.room_id === intoId ? oa.opening : ob.opening
  const L = wall.length
  const uCenter = localOpening.t * L
  const half = localOpening.width / 2
  const u0 = Math.max(0, uCenter - half)
  const u1 = Math.min(L, uCenter + half)

  const p0 = pointOnWall(wall, u0 / L)
  const p1 = pointOnWall(wall, u1 / L)
  const along = unit(wall.b.x - wall.a.x, wall.b.z - wall.a.z) // a→b
  const inward: Vec2 = { x: wall.nx, z: wall.nz }
  const width = u1 - u0

  const info = connectorInfo(connector.type)
  const leaves: SwingLeaf[] = []
  if (connector.type === 'double') {
    // two leaves, hinged at each end, each swings inward
    leaves.push({ hinge: p0, closedDir: along, openDir: inward, radius: width / 2 })
    leaves.push({ hinge: p1, closedDir: { x: -along.x, z: -along.z }, openDir: inward, radius: width / 2 })
  } else {
    // single leaf; hinge side per swing.hinge
    const hingeAtP0 = connector.swing.hinge === 'left'
    const hinge = hingeAtP0 ? p0 : p1
    const closedDir = hingeAtP0 ? along : { x: -along.x, z: -along.z }
    leaves.push({ hinge, closedDir, openDir: inward, radius: width })
  }
  void info
  return { connector_id: connector.connector_id, into_room: intoId, wallIndex, leaves }
}

/** Is direction `d` inside the 90° sweep from closedDir to openDir? */
function inSweep(leaf: SwingLeaf, d: Vec2): boolean {
  const sign = Math.sign(cross(leaf.closedDir, leaf.openDir)) || 1
  const eps = -1e-6
  return cross(leaf.closedDir, d) * sign >= eps && cross(d, leaf.openDir) * sign >= eps
}

/** Does a single swept leaf overlap an OBB? (conservative sector–OBB test). */
export function leafHitsObb(leaf: SwingLeaf, o: OBB): boolean {
  if (pointInObb(leaf.hinge, o)) return true

  const sign = Math.sign(cross(leaf.closedDir, leaf.openDir)) || 1
  const end = { x: leaf.hinge.x + leaf.radius * leaf.openDir.x, z: leaf.hinge.z + leaf.radius * leaf.openDir.z }
  const startEnd = {
    x: leaf.hinge.x + leaf.radius * leaf.closedDir.x,
    z: leaf.hinge.z + leaf.radius * leaf.closedDir.z,
  }
  // radial edges of the sector
  if (segmentIntersectsObb(leaf.hinge, startEnd, o)) return true
  if (segmentIntersectsObb(leaf.hinge, end, o)) return true

  // arc samples (at full + mid radius)
  for (let k = 0; k <= SWEEP_STEPS; k++) {
    const ang = ((Math.PI / 2) * k) / SWEEP_STEPS
    const dir = rotate(leaf.closedDir, sign * ang)
    for (const r of [leaf.radius, leaf.radius * 0.6]) {
      if (pointInObb({ x: leaf.hinge.x + r * dir.x, z: leaf.hinge.z + r * dir.z }, o)) return true
    }
  }

  // any OBB corner inside the sector
  for (const c of obbCorners(o)) {
    const v = { x: c.x - leaf.hinge.x, z: c.z - leaf.hinge.z }
    const len = Math.hypot(v.x, v.z)
    if (len <= leaf.radius && inSweep(leaf, { x: v.x / (len || 1), z: v.z / (len || 1) })) return true
  }
  return false
}

export interface SwingHit {
  connector_id: string
  furniture_id: string
  furniture_name: string
}

/**
 * Furniture in the into-room that the door swing overlaps (AC7). Empty when the
 * arc is clear or the connector is open (no swing).
 */
export function swingHitsFurniture(connector: Connector, house: House): SwingHit[] {
  const arc = swingArc(connector, house)
  if (!arc) return []
  const room = getRoom(house, arc.into_room)
  if (!room) return []
  const hits: SwingHit[] = []
  for (const f of room.interior.furniture ?? []) {
    const o = obbOf(f)
    if (arc.leaves.some((leaf) => leafHitsObb(leaf, o))) {
      hits.push({ connector_id: connector.connector_id, furniture_id: f.id, furniture_name: f.name })
    }
  }
  return hits
}
