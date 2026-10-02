import type { Vec2, Wall, Bounds, Frame } from '../contract/sceneContract'

/**
 * Pure floor-plane geometry helpers, in DESIGN centimeters.
 *
 * These are faithful ports (not imports) of the front-end's
 * src/geometry/walls.ts + src/three/coords.ts, kept here so the engine has no
 * build coupling to Agent A's tree. Conventions match exactly:
 *   - x = right, z = depth/forward (cm)
 *   - inward wall normal points toward the polygon centroid
 *   - world space = meters, room centered on its bbox center
 */

export function polygonCentroid(corners: Vec2[]): Vec2 {
  let x = 0
  let z = 0
  for (const c of corners) {
    x += c.x
    z += c.z
  }
  return { x: x / corners.length, z: z / corners.length }
}

export function bbox(corners: Vec2[]): Bounds & { w: number; d: number; cx: number; cz: number } {
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (const c of corners) {
    if (c.x < minX) minX = c.x
    if (c.z < minZ) minZ = c.z
    if (c.x > maxX) maxX = c.x
    if (c.z > maxZ) maxZ = c.z
  }
  return { minX, minZ, maxX, maxZ, w: maxX - minX, d: maxZ - minZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 }
}

/** Derive wall segments from an ordered corner polygon (inward normal → centroid). */
export function deriveWalls(corners: Vec2[]): Wall[] {
  const n = corners.length
  const c = polygonCentroid(corners)
  const walls: Wall[] = []
  for (let i = 0; i < n; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % n]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const length = Math.hypot(dx, dz)
    if (length < 1e-6) continue
    const dirX = dx / length
    const dirZ = dz / length
    let nx = -dirZ
    let nz = dirX
    const midX = (a.x + b.x) / 2
    const midZ = (a.z + b.z) / 2
    if (nx * (c.x - midX) + nz * (c.z - midZ) < 0) {
      nx = -nx
      nz = -nz
    }
    walls.push({ id: `w${i}`, a, b, length, dirX, dirZ, nx, nz })
  }
  return walls
}

/** Point-in-polygon (ray casting); point & corners in cm. */
export function pointInPolygon(pt: Vec2, corners: Vec2[]): boolean {
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

/** The 4 footprint corners (cm) of an OBB. Matches src/geometry/collision.ts. */
export function footprintCorners(cx: number, cz: number, w: number, d: number, rot: number): Vec2[] {
  const hw = w / 2
  const hd = d / 2
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  const locals: Array<[number, number]> = [
    [hw, hd],
    [hw, -hd],
    [-hw, -hd],
    [-hw, hd],
  ]
  return locals.map(([lx, lz]) => ({ x: cx + lx * c + lz * s, z: cz - lx * s + lz * c }))
}

/** cm(design) <-> m(world) frame, identical to src/three/coords.ts makeFrame. */
export function makeFrame(corners: Vec2[]): Frame & {
  toWorld: (x: number, z: number) => [number, number]
  fromWorld: (wx: number, wz: number) => [number, number]
} {
  const b = bbox(corners)
  return {
    cx: b.cx,
    cz: b.cz,
    toWorld: (x: number, z: number) => [(x - b.cx) / 100, (z - b.cz) / 100],
    fromWorld: (wx: number, wz: number) => [wx * 100 + b.cx, wz * 100 + b.cz],
  }
}
