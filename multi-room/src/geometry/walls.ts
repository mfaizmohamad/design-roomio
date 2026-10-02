/**
 * Wall + opening geometry, PORTED READ-ONLY from Agent A's src/geometry/walls.ts.
 *
 * This is the single most important reuse for connectors: a connector is
 * mechanically an Opening cut into a SHARED WALL, and `buildWallParts` already
 * subtracts rectangular holes for openings (sill/height aware). Agent C derives
 * connector openings and feeds them through this exact same path so the opening
 * is cut identically in BOTH rooms — we do NOT reinvent wall-cutting.
 *
 * Canonical source: src/geometry/walls.ts (Agent A). Never edited there.
 * Last synced @ 2026-06-30.
 */
import type { Vec2, Wall, Opening } from '../interior'

export function polygonCentroid(corners: Vec2[]): Vec2 {
  let x = 0
  let z = 0
  for (const c of corners) {
    x += c.x
    z += c.z
  }
  return { x: x / corners.length, z: z / corners.length }
}

export interface BBox {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  w: number
  d: number
  cx: number
  cz: number
}

export function bbox(corners: Vec2[]): BBox {
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
  return {
    minX,
    minZ,
    maxX,
    maxZ,
    w: maxX - minX,
    d: maxZ - minZ,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
  }
}

/** Signed area (shoelace). Positive => counter-clockwise in x/z. */
export function signedArea(corners: Vec2[]): number {
  let a = 0
  const n = corners.length
  for (let i = 0; i < n; i++) {
    const c = corners[i]
    const d = corners[(i + 1) % n]
    a += c.x * d.z - d.x * c.z
  }
  return a / 2
}

/**
 * Derive wall segments from an ordered corner polygon.
 * Inward normal is oriented toward the polygon centroid for robustness on
 * concave shapes (L/T/U).
 */
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
    const towardCx = c.x - midX
    const towardCz = c.z - midZ
    if (nx * towardCx + nz * towardCz < 0) {
      nx = -nx
      nz = -nz
    }
    const angle = Math.atan2(nx, nz)
    walls.push({ id: `w${i}`, index: i, a, b, length, dirX, dirZ, nx, nz, midX, midZ, angle })
  }
  return walls
}

/** Point on wall at parametric t (0..1) along a->b. */
export function pointOnWall(w: Wall, t: number): Vec2 {
  return {
    x: w.a.x + (w.b.x - w.a.x) * t,
    z: w.a.z + (w.b.z - w.a.z) * t,
  }
}

/** Is the polygon axis-aligned & rectilinear (all walls horizontal or vertical)? */
export function isRectilinear(walls: Wall[]): boolean {
  return walls.every((w) => Math.abs(w.dirX) < 1e-3 || Math.abs(w.dirZ) < 1e-3)
}

export interface WallPart {
  uCenter: number
  vCenter: number
  lenU: number
  lenV: number
}

/**
 * Decompose a wall into solid boxes, leaving rectangular holes for each opening.
 * (Verbatim from Agent A — this is what "cuts the opening" in a wall.)
 */
export function buildWallParts(
  wall: Wall,
  openings: Opening[],
  wallHeight: number,
  thickness: number,
): WallPart[] {
  const L = wall.length
  const ext = thickness / 2
  const parts: WallPart[] = []

  const ivs = openings
    .map((o) => {
      const u = o.t * L
      const half = o.width / 2
      return {
        uMin: Math.max(0, u - half),
        uMax: Math.min(L, u + half),
        vBottom: Math.max(0, o.sill),
        vTop: Math.min(wallHeight, o.sill + o.height),
      }
    })
    .filter((i) => i.uMax > i.uMin)
    .sort((a, b) => a.uMin - b.uMin)

  const merged: { uMin: number; uMax: number }[] = []
  for (const i of ivs) {
    const last = merged[merged.length - 1]
    if (last && i.uMin <= last.uMax + 0.1) last.uMax = Math.max(last.uMax, i.uMax)
    else merged.push({ uMin: i.uMin, uMax: i.uMax })
  }

  let cursor = 0
  const pushStrip = (a: number, b: number) => {
    if (b - a < 0.1) return
    const start = a <= 0.1 ? -ext : a
    const end = b >= L - 0.1 ? L + ext : b
    parts.push({ uCenter: (start + end) / 2, lenU: end - start, vCenter: wallHeight / 2, lenV: wallHeight })
  }
  for (const m of merged) {
    pushStrip(cursor, m.uMin)
    cursor = m.uMax
  }
  pushStrip(cursor, L)

  for (const i of ivs) {
    const w = i.uMax - i.uMin
    const uc = (i.uMin + i.uMax) / 2
    if (wallHeight - i.vTop > 0.1) {
      parts.push({ uCenter: uc, lenU: w, vCenter: (i.vTop + wallHeight) / 2, lenV: wallHeight - i.vTop })
    }
    if (i.vBottom > 0.1) {
      parts.push({ uCenter: uc, lenU: w, vCenter: i.vBottom / 2, lenV: i.vBottom })
    }
  }
  return parts
}

/** Point-in-polygon test (ray casting), point & corners in cm. */
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
