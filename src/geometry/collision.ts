import type { Vec2, Wall, FurnitureItem } from '../types'

/**
 * §7 Collision & Snapping
 * ------------------------
 * A purely 2D footprint constraint solver in the floor plane (x, z). Heights are
 * ignored. Every furniture item is treated as an oriented bounding box (OBB) and
 * every wall as a thick segment of width `wallThickness` whose interior face sits
 * `wallThickness / 2` inward from the wall centerline (the polygon edge).
 *
 * No physics engine — just deterministic vector math:
 *  - Inside-the-room constraint via iterative per-corner normal correction
 *    (correcting only the normal component yields natural "slide along wall"
 *    behaviour, since tangential motion is never touched).
 *  - Flush wall snapping when the item's back edge is near a wall.
 *  - Soft OBB-vs-OBB overlap detection (separating-axis theorem) for warnings.
 *
 * All distances are in centimeters. Rotation is in radians about +Y, with 0
 * meaning the item faces +z (so the item's local -z axis is its "back").
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** An oriented bounding box: center, size (w along local x, d along local z), rotation (rad). */
export interface OBB {
  cx: number
  cz: number
  w: number
  d: number
  rot: number
}

export interface ResolveResult {
  /** resolved center x (cm) */
  x: number
  /** resolved center z (cm) */
  z: number
  /** possibly snapped rotation (radians) */
  rotation: number
  /** true if the item was snapped flush against a wall */
  snappedToWall: boolean
  /** ids of OTHER furniture items this one softly overlaps (warning, not blocked) */
  overlaps: string[]
}

export interface ResolveOpts {
  /** wall thickness (cm) */
  wallThickness: number
  /** cm — back edge within this distance of a wall snaps flush (default 18) */
  snapThreshold?: number
  /** deg — rotation snapped to wall orientation when snapping (default 5) */
  rotationSnapDeg?: number
}

// ---------------------------------------------------------------------------
// Small vector helpers (local; floor-plane Vec2 = {x, z})
// ---------------------------------------------------------------------------

function dot2(ax: number, az: number, bx: number, bz: number): number {
  return ax * bx + az * bz
}

/** Normalize an angle to (-PI, PI]. */
function normalizeAngle(a: number): number {
  let r = a % (Math.PI * 2)
  if (r <= -Math.PI) r += Math.PI * 2
  else if (r > Math.PI) r -= Math.PI * 2
  return r
}

// ---------------------------------------------------------------------------
// Footprint corners
// ---------------------------------------------------------------------------

/**
 * The 4 corners (cm) of an item's footprint, in floor-plane Vec2.
 *
 * Local axes (before rotation):
 *   +x = right (half-width hw = w/2)
 *   +z = forward / facing direction (half-depth hd = d/2)
 *
 * A rotation of `rot` radians about +Y maps a local offset (lx, lz) to world:
 *   wx =  lx*cos(rot) + lz*sin(rot)
 *   wz = -lx*sin(rot) + lz*cos(rot)
 *
 * This is the same convention used elsewhere in the app where rotation 0 faces
 * +z and `Wall.angle = atan2(nx, nz)` aligns a +z-facing plane to a wall normal.
 * Corner order: clockwise starting from the front-right.
 */
export function footprintCorners(
  cx: number,
  cz: number,
  w: number,
  d: number,
  rot: number,
): Vec2[] {
  const hw = w / 2
  const hd = d / 2
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  // local corner offsets: front-right, back-right, back-left, front-left
  const locals: Array<[number, number]> = [
    [hw, hd], // front-right
    [hw, -hd], // back-right
    [-hw, -hd], // back-left
    [-hw, hd], // front-left
  ]
  return locals.map(([lx, lz]) => ({
    x: cx + lx * c + lz * s,
    z: cz - lx * s + lz * c,
  }))
}

// ---------------------------------------------------------------------------
// OBB overlap (Separating Axis Theorem)
// ---------------------------------------------------------------------------

/** World-space axes (unit) of an OBB: its local +x and +z directions. */
function obbAxes(rot: number): { ux: number; uz: number; vx: number; vz: number } {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  // local +x maps to ( c, -s ); local +z maps to ( s,  c )  (see footprintCorners)
  return { ux: c, uz: -s, vx: s, vz: c }
}

/**
 * Do two OBBs overlap? Standard 2D Separating-Axis Theorem: project both boxes
 * onto each of the four candidate axes (the two face normals of each box). If a
 * gap exists on any axis the boxes are disjoint. Touching exactly counts as no
 * overlap (strict inequality), which avoids flagging flush-but-not-penetrating
 * neighbours.
 */
export function obbOverlap(a: OBB, b: OBB): boolean {
  const ca = { x: a.cx, z: a.cz }
  const cb = { x: b.cx, z: b.cz }
  const dx = cb.x - ca.x
  const dz = cb.z - ca.z

  const aa = obbAxes(a.rot)
  const ba = obbAxes(b.rot)

  const aHw = a.w / 2
  const aHd = a.d / 2
  const bHw = b.w / 2
  const bHd = b.d / 2

  // The four axes to test: A's two axes and B's two axes.
  const axes: Array<[number, number]> = [
    [aa.ux, aa.uz],
    [aa.vx, aa.vz],
    [ba.ux, ba.uz],
    [ba.vx, ba.vz],
  ]

  for (const [axx, axz] of axes) {
    // Radius of A projected onto axis = sum of |half-extent · axis| over A's axes.
    const ra =
      aHw * Math.abs(dot2(aa.ux, aa.uz, axx, axz)) +
      aHd * Math.abs(dot2(aa.vx, aa.vz, axx, axz))
    const rb =
      bHw * Math.abs(dot2(ba.ux, ba.uz, axx, axz)) +
      bHd * Math.abs(dot2(ba.vx, ba.vz, axx, axz))
    const dist = Math.abs(dot2(dx, dz, axx, axz))
    if (dist >= ra + rb) return false // separating axis found
  }
  return true
}

// ---------------------------------------------------------------------------
// Inside-polygon constraint
// ---------------------------------------------------------------------------

/**
 * Push the item fully inside the room so that every footprint corner stays on
 * the interior side of every wall and at least `halfThickness` away from the
 * wall centerline.
 *
 * Method (robust for any wall angle, incl. beveled/cut concave shapes):
 * for each wall we measure the signed distance of each corner from the wall
 * line along the wall's INWARD normal. The minimum over corners is the most
 * violating one. If that minimum is below `halfThickness`, the item has poked
 * through (or past) the inner wall face, so we translate the whole item inward
 * along that wall's normal by exactly the penetration depth. Because only the
 * normal component is corrected, motion parallel to the wall is preserved
 * (this is the "slide, don't stop dead" behaviour). Iterating a few passes lets
 * constraints from several walls (e.g. an inside corner) settle together.
 *
 * Returns the corrected center.
 */
function constrainInside(
  cx: number,
  cz: number,
  w: number,
  d: number,
  rot: number,
  walls: Wall[],
  halfThickness: number,
  passes = 6,
): { x: number; z: number } {
  let x = cx
  let z = cz
  for (let pass = 0; pass < passes; pass++) {
    let maxPenetration = 0
    let pushNx = 0
    let pushNz = 0
    const corners = footprintCorners(x, z, w, d, rot)
    for (const wall of walls) {
      // signed distance of each corner from the wall line, measured along the
      // inward normal. distance = (corner - wall.a) · n.
      let minSigned = Infinity
      for (const c of corners) {
        const signed = dot2(c.x - wall.a.x, c.z - wall.a.z, wall.nx, wall.nz)
        if (signed < minSigned) minSigned = signed
      }
      // We need every corner at least halfThickness inside the centerline.
      const penetration = halfThickness - minSigned
      if (penetration > maxPenetration) {
        maxPenetration = penetration
        pushNx = wall.nx
        pushNz = wall.nz
      }
    }
    if (maxPenetration <= 1e-6) break
    // Resolve the single worst violation this pass; remaining ones settle next pass.
    x += pushNx * maxPenetration
    z += pushNz * maxPenetration
  }
  return { x, z }
}

// ---------------------------------------------------------------------------
// Wall snapping
// ---------------------------------------------------------------------------

/**
 * Find the wall the item's back edge is closest to (along that wall's inward
 * normal), but only consider walls the back actually faces and that the item
 * overlaps in the tangential direction. Returns null when nothing is in range.
 */
function findSnapWall(
  cx: number,
  cz: number,
  w: number,
  d: number,
  rot: number,
  walls: Wall[],
  halfThickness: number,
  snapThreshold: number,
): { wall: Wall; gap: number } | null {
  // The item's back face outward direction is local -z, i.e. world ( -sin(rot)·? )
  // Local -z maps to world (-s_z): from footprintCorners, local +z -> ( s,  c ),
  // so local -z -> ( -s, -c ).
  const s = Math.sin(rot)
  const c = Math.cos(rot)
  const backDirX = -s
  const backDirZ = -c

  const corners = footprintCorners(cx, cz, w, d, rot)
  let best: { wall: Wall; gap: number } | null = null

  for (const wall of walls) {
    // The back face must point roughly opposite the wall's inward normal,
    // i.e. the back's outward direction aligns with the wall's OUTWARD normal.
    // backDir · inwardNormal should be strongly negative.
    const facing = dot2(backDirX, backDirZ, wall.nx, wall.nz)
    if (facing > -0.5) continue // not really facing this wall

    // Distance of the back face from the wall centerline = min signed distance
    // of the two back corners along the inward normal.
    let minSigned = Infinity
    let tangentMin = Infinity
    let tangentMax = -Infinity
    for (const corner of corners) {
      const signed = dot2(
        corner.x - wall.a.x,
        corner.z - wall.a.z,
        wall.nx,
        wall.nz,
      )
      if (signed < minSigned) minSigned = signed
      // tangential coordinate along the wall for overlap test
      const tang = dot2(
        corner.x - wall.a.x,
        corner.z - wall.a.z,
        wall.dirX,
        wall.dirZ,
      )
      if (tang < tangentMin) tangentMin = tang
      if (tang > tangentMax) tangentMax = tang
    }

    // Require the footprint to overlap the wall's extent tangentially, else it's
    // alongside a different wall entirely.
    if (tangentMax <= 0 || tangentMin >= wall.length) continue

    // Gap between the inner wall face and the item's back face.
    const gap = minSigned - halfThickness
    if (gap < 0) continue // already pushed inside by the inside-constraint; treat as flush-ish
    if (gap <= snapThreshold) {
      if (best === null || gap < best.gap) best = { wall, gap }
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Resolve a proposed move for a furniture item into a legal position.
 *
 * Steps:
 *  1. Start from the proposed center with the item's current rotation.
 *  2. Constrain the footprint inside the room polygon (clamp + slide along walls).
 *  3. If the back edge is within `snapThreshold` of a wall, snap rotation so the
 *     back faces that wall and translate the item flush against the inner face.
 *     Re-run the inside constraint afterwards so a snap near a corner stays legal.
 *  4. Detect soft OBB overlaps with the other items (never blocks the move).
 */
export function resolveFurniture(
  item: FurnitureItem,
  proposed: { x: number; z: number },
  walls: Wall[],
  others: FurnitureItem[],
  polygon: Vec2[],
  opts: ResolveOpts,
): ResolveResult {
  const wallThickness = opts.wallThickness
  const halfThickness = wallThickness / 2
  const snapThreshold = opts.snapThreshold ?? 18
  const rotationSnapDeg = opts.rotationSnapDeg ?? 5
  const rotationSnapRad = (rotationSnapDeg * Math.PI) / 180

  const w = item.w
  const d = item.d
  let rotation = item.rotation

  // -- Step 1 & 2: clamp the proposed center inside the room ----------------
  let { x, z } = constrainInside(
    proposed.x,
    proposed.z,
    w,
    d,
    rotation,
    walls,
    halfThickness,
  )

  // Safety net: if the resulting center somehow lands outside the polygon
  // (degenerate geometry), pull it back toward the previous valid center.
  // We sample the center point; corners are handled by constrainInside.
  if (polygon.length >= 3 && !pointInPolygonLocal({ x, z }, polygon)) {
    // Fall back to the item's prior center, which the caller guarantees legal.
    x = item.x
    z = item.z
    const reclamped = constrainInside(x, z, w, d, rotation, walls, halfThickness)
    x = reclamped.x
    z = reclamped.z
  }

  // -- Step 3: wall snapping ------------------------------------------------
  let snappedToWall = false
  const snap = findSnapWall(
    x,
    z,
    w,
    d,
    rotation,
    walls,
    halfThickness,
    snapThreshold,
  )
  if (snap) {
    const { wall, gap } = snap

    // Snap rotation: the item's back (local -z) should point along the wall's
    // OUTWARD normal, i.e. the front (local +z) points along the inward normal.
    // rotation such that local +z maps to ( sin(rot), cos(rot) ) == inward normal
    // => rot = atan2(nx, nz)  (matches Wall.angle).
    const targetRot = Math.atan2(wall.nx, wall.nz)

    // Only commit the rotation snap when we're already close to wall-parallel
    // (within rotationSnapRad of the target), so a deliberately angled item
    // isn't yanked square. The translate-flush still happens regardless.
    const rotDelta = normalizeAngle(targetRot - rotation)
    if (Math.abs(rotDelta) <= rotationSnapRad) {
      rotation = targetRot
    } else {
      // Not aligned enough to rotate-snap; still translate flush along the
      // current orientation using the measured gap.
    }

    // Translate the item flush: move it toward the wall by `gap` along the
    // wall's OUTWARD normal (negative inward normal) so the back face touches
    // the inner wall face (centerline + halfThickness).
    x -= wall.nx * gap
    z -= wall.nz * gap

    snappedToWall = true

    // Re-assert the inside constraint with the (possibly) new rotation so that
    // snapping near a concave corner can't poke a side through an adjacent wall.
    const settled = constrainInside(x, z, w, d, rotation, walls, halfThickness)
    x = settled.x
    z = settled.z
  }

  // -- Step 4: soft overlap detection (warnings only) -----------------------
  const selfObb: OBB = { cx: x, cz: z, w, d, rot: rotation }
  const overlaps: string[] = []
  for (const other of others) {
    if (other.id === item.id) continue
    const otherObb: OBB = {
      cx: other.x,
      cz: other.z,
      w: other.w,
      d: other.d,
      rot: other.rotation,
    }
    if (obbOverlap(selfObb, otherObb)) overlaps.push(other.id)
  }

  return {
    x,
    z,
    rotation: normalizeAngle(rotation),
    snappedToWall,
    overlaps,
  }
}

// ---------------------------------------------------------------------------
// Local point-in-polygon (ray casting) — mirrors geometry/walls.ts so this
// module stays self-contained and importable without circular concerns.
// ---------------------------------------------------------------------------

function pointInPolygonLocal(pt: Vec2, corners: Vec2[]): boolean {
  let inside = false
  const n = corners.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ci = corners[i]
    const cj = corners[j]
    const intersect =
      ci.z > pt.z !== cj.z > pt.z &&
      pt.x < ((cj.x - ci.x) * (pt.z - ci.z)) / (cj.z - ci.z) + ci.x
    if (intersect) inside = !inside
  }
  return inside
}
