import type { Colliders, Vec2, Wall, OBB } from '../contract/sceneContract'
import { footprintCorners, pointInPolygon } from './geometry'

/**
 * First-person walk collision, in DESIGN centimeters.
 *
 * The walker is modelled as a vertical circle of `radius` cm in the floor
 * plane (heights ignored, like the app's furniture solver). Two constraints,
 * applied to a PROPOSED center and resolved to a legal center:
 *
 *  1) Stay inside the room: every wall requires the walker's center to be at
 *     least (wallThickness/2 + radius) inside the wall centerline, measured
 *     along the wall's inward normal. This is the same inward-normal correction
 *     the front-end uses in geometry/collision.ts `constrainInside`, adapted
 *     from an OBB's worst corner to a circle (corner = center, margin = radius).
 *     Correcting only the normal component preserves tangential motion, so you
 *     "slide along the wall" instead of stopping dead.
 *
 *  2) Don't pass through furniture: each furniture OBB is inflated by `radius`
 *     and the walker is pushed out to the nearest face if it penetrates
 *     (circle-vs-OBB minimum-translation resolution in the box's local frame).
 *
 * Deterministic vector math, no physics engine. Iterating a few passes lets
 * multiple constraints (a corner, a sofa shoved against a wall) settle together.
 */

export interface WalkCollisionOpts {
  /** walker body radius in cm (default 18 ≈ shoulder half-width) */
  radius?: number
  /** solver passes (default 4) */
  passes?: number
}

function clampToWalls(
  cx: number,
  cz: number,
  walls: Wall[],
  margin: number,
): { x: number; z: number } {
  let x = cx
  let z = cz
  // One worst-violation correction per pass (mirrors constrainInside).
  for (let pass = 0; pass < 6; pass++) {
    let maxPen = 0
    let nx = 0
    let nz = 0
    for (const w of walls) {
      const signed = (x - w.a.x) * w.nx + (z - w.a.z) * w.nz
      const pen = margin - signed
      if (pen > maxPen) {
        maxPen = pen
        nx = w.nx
        nz = w.nz
      }
    }
    if (maxPen <= 1e-6) break
    x += nx * maxPen
    z += nz * maxPen
  }
  return { x, z }
}

/** Push a point out of one OBB inflated by `radius`. Returns corrected point. */
function pushOutOfObb(
  x: number,
  z: number,
  obb: OBB,
  radius: number,
): { x: number; z: number; pushed: boolean } {
  const c = Math.cos(obb.rot)
  const s = Math.sin(obb.rot)
  // World offset from box center.
  const dx = x - obb.cx
  const dz = z - obb.cz
  // Project into the box's local axes. From footprintCorners, local +x maps to
  // world (c, -s) and local +z maps to world (s, c); so to go world->local we
  // dot with those axes.
  const lx = dx * c + dz * -s
  const lz = dx * s + dz * c
  const hw = obb.w / 2 + radius
  const hd = obb.d / 2 + radius
  // Closest point on the inflated box to the walker, in local space.
  const clampedX = Math.max(-hw, Math.min(hw, lx))
  const clampedZ = Math.max(-hd, Math.min(hd, lz))
  const insideX = lx === clampedX
  const insideZ = lz === clampedZ

  if (insideX && insideZ) {
    // Center is INSIDE the inflated box → push out along the least-penetrating
    // local axis (minimum translation).
    const penX = hw - Math.abs(lx)
    const penZ = hd - Math.abs(lz)
    let nlx = 0
    let nlz = 0
    if (penX < penZ) nlx = lx >= 0 ? penX : -penX
    else nlz = lz >= 0 ? penZ : -penZ
    const nlxFinal = lx + nlx
    const nlzFinal = lz + nlz
    // local -> world: world = lx*(c,-s)... inverse of above (rotation transpose)
    return {
      x: obb.cx + nlxFinal * c + nlzFinal * s,
      z: obb.cz + nlxFinal * -s + nlzFinal * c,
      pushed: true,
    }
  }

  // Center is outside the box; nearest point is (clampedX, clampedZ). If within
  // radius (i.e. the inflation already accounts for radius, so distance to the
  // *un-inflated* face < radius), the clamp landed on the boundary and we need
  // to move out to the inflated boundary along the separation direction.
  const sepX = lx - clampedX
  const sepZ = lz - clampedZ
  const distSq = sepX * sepX + sepZ * sepZ
  // Because we inflated by radius, any positive separation already clears it.
  if (distSq > 1e-9) return { x, z, pushed: false }
  // Degenerate (exactly on the inflated corner/edge): nudge along local normal.
  return { x, z, pushed: false }
}

/**
 * Resolve a proposed walker center (cm) into a legal one.
 * `prev` is the last legal center, used as a safety fallback if the proposed
 * point lands outside the polygon entirely (e.g. tunneling on a huge step).
 */
export function resolveWalk(
  prev: Vec2,
  proposed: Vec2,
  colliders: Colliders,
  opts: WalkCollisionOpts = {},
): Vec2 {
  const radius = opts.radius ?? 18
  const passes = opts.passes ?? 4
  const margin = colliders.wallThickness / 2 + radius

  let x = proposed.x
  let z = proposed.z

  // Push out of furniture FIRST, then clamp to walls LAST each pass. Wall
  // containment is the HARD constraint (never leave the room); furniture is
  // softer (matches the app's own solver, where overlaps are warnings). So in
  // a degenerate squeeze — e.g. a piece parked a body-width from a corner —
  // the walker grazes the furniture rather than clipping through the wall.
  for (let pass = 0; pass < passes; pass++) {
    for (const obb of colliders.furniture) {
      const r = pushOutOfObb(x, z, obb, radius)
      x = r.x
      z = r.z
    }
    const wall = clampToWalls(x, z, colliders.walls, margin)
    x = wall.x
    z = wall.z
  }

  // Safety net: if we somehow ended outside the polygon, fall back to prev.
  if (colliders.polygon.length >= 3 && !pointInPolygon({ x, z }, colliders.polygon)) {
    return clampInside(prev, colliders, margin)
  }
  return { x, z }
}

function clampInside(p: Vec2, colliders: Colliders, margin: number): Vec2 {
  const r = clampToWalls(p.x, p.z, colliders.walls, margin)
  return { x: r.x, z: r.z }
}

/** Convenience: does a point (cm) collide with any furniture footprint? (tests) */
export function pointInAnyFurniture(p: Vec2, furniture: OBB[]): boolean {
  for (const obb of furniture) {
    const c = Math.cos(obb.rot)
    const s = Math.sin(obb.rot)
    const dx = p.x - obb.cx
    const dz = p.z - obb.cz
    const lx = dx * c + dz * -s
    const lz = dx * s + dz * c
    if (Math.abs(lx) <= obb.w / 2 && Math.abs(lz) <= obb.d / 2) return true
  }
  return false
}

/** Footprint corners re-export for tests/visualization. */
export { footprintCorners }
