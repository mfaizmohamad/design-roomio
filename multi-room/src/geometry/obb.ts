/**
 * Oriented bounding boxes for furniture, PORTED READ-ONLY from Agent A's
 * src/geometry/collision.ts. Single home for OBB math used by swing-overlap
 * detection (no redundant copies). Convention matches A exactly so our warnings
 * agree with A's furniture orientation:
 *   rotation 0 faces +z; local→world: wx = lx·cos + lz·sin, wz = -lx·sin + lz·cos.
 */
import type { Vec2, FurnitureItem } from '../interior'

export interface OBB {
  cx: number
  cz: number
  w: number // local x extent
  d: number // local z extent
  rot: number
}

export function obbOf(f: FurnitureItem): OBB {
  return { cx: f.x, cz: f.z, w: f.w, d: f.d, rot: f.rotation }
}

/** The 4 footprint corners (cm), clockwise from front-right (verbatim from A). */
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

export function obbCorners(o: OBB): Vec2[] {
  return footprintCorners(o.cx, o.cz, o.w, o.d, o.rot)
}

/** Is a world point inside the OBB? (inverse of A's local→world transform). */
export function pointInObb(p: Vec2, o: OBB): boolean {
  const dx = p.x - o.cx
  const dz = p.z - o.cz
  const c = Math.cos(o.rot)
  const s = Math.sin(o.rot)
  // inverse of [[c, s], [-s, c]] is [[c, -s], [s, c]]
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  return Math.abs(lx) <= o.w / 2 + 1e-6 && Math.abs(lz) <= o.d / 2 + 1e-6
}

function dot2(ax: number, az: number, bx: number, bz: number): number {
  return ax * bx + az * bz
}

/** World-space unit axes of an OBB: its local +x and +z directions (verbatim from A). */
export function obbAxes(rot: number): { ux: number; uz: number; vx: number; vz: number } {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return { ux: c, uz: -s, vx: s, vz: c }
}

/** Do two OBBs overlap? 2D Separating-Axis Theorem (verbatim from A's collision.ts). */
export function obbOverlap(a: OBB, b: OBB): boolean {
  const dx = b.cx - a.cx
  const dz = b.cz - a.cz
  const aa = obbAxes(a.rot)
  const ba = obbAxes(b.rot)
  const aHw = a.w / 2
  const aHd = a.d / 2
  const bHw = b.w / 2
  const bHd = b.d / 2
  const axes: Array<[number, number]> = [
    [aa.ux, aa.uz],
    [aa.vx, aa.vz],
    [ba.ux, ba.uz],
    [ba.vx, ba.vz],
  ]
  for (const [axx, axz] of axes) {
    const ra = aHw * Math.abs(dot2(aa.ux, aa.uz, axx, axz)) + aHd * Math.abs(dot2(aa.vx, aa.vz, axx, axz))
    const rb = bHw * Math.abs(dot2(ba.ux, ba.uz, axx, axz)) + bHd * Math.abs(dot2(ba.vx, ba.vz, axx, axz))
    const dist = Math.abs(dot2(dx, dz, axx, axz))
    if (dist >= ra + rb) return false
  }
  return true
}

/** Do segments p1p2 and p3p4 intersect? (standard orientation test). */
export function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
  const d1 = d(p3, p4, p1)
  const d2 = d(p3, p4, p2)
  const d3 = d(p1, p2, p3)
  const d4 = d(p1, p2, p4)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  return false
}

/** Does segment p1p2 cross or lie inside the OBB? */
export function segmentIntersectsObb(p1: Vec2, p2: Vec2, o: OBB): boolean {
  if (pointInObb(p1, o) || pointInObb(p2, o)) return true
  const c = obbCorners(o)
  for (let i = 0; i < 4; i++) {
    if (segmentsIntersect(p1, p2, c[i], c[(i + 1) % 4])) return true
  }
  return false
}
