import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { pointOnWall } from '../geometry/walls'
import type { Frame } from './coords'
import type { Opening, Wall } from '../types'

/**
 * Architectural trim (skirting / baseboards + door-and-window casing + optional
 * slim cornice) for a room. This is the cheap-geometry finish that stops every
 * wall/floor and opening junction reading as an untextured CG box.
 *
 * COST INVARIANT — one merged mesh, one draw call PER ROOM regardless of how many
 * segments a room has (dozens of skirting runs + casing boards + a cornice all
 * collapse into a single BufferGeometry). We keep exactly ONE unit box profile
 * (module-level, see `unitProfile`) and stamp it per segment via a cheap CPU
 * clone+applyMatrix4, then `mergeGeometries` into one groupless geometry that a
 * single material paints. So trim adds ~1 draw call & one small buffer per room,
 * NOT a geometry+material per segment (the app already runs ~1000 unique
 * geometries — this must not scale with the segment count).
 *
 * Everything is authored in centimetres in the wall's (u = along a→b, v = height
 * above floor) frame, then placed into the room's frame-local world metres — the
 * SAME `frame.toWorld` the floor/walls use — so <RoomTrim> drops into BOTH the
 * single-room (Room.tsx) and whole-house (HouseView RoomShell) sites unchanged
 * and the two views never diverge.
 */

// ── profile dimensions (cm) ───────────────────────────────────────────────────
const SKIRT_H = 10 // skirting board height up the wall
const SKIRT_PROUD = 2 // how far it stands out from the wall face into the room
const SKIRT_SINK = 2 // bottom sunk below the floor plane so its base edge is hidden
const CASING_W = 6.5 // architrave board width around an opening
const CASING_PROUD = 1.6 // architrave stand-off from the wall face
const CORNICE_H = 6 // slim cornice height down from the ceiling
const CORNICE_PROUD = 2.4
// EMBED: how far the BACK of a trim board sits INSIDE the wall. A hair of overlap
// (never a coincident coplanar face) is what keeps trim from z-fighting the wall.
const EMBED = 0.6

/** Default painted-MDF off-white — matches the door/window frame paint. */
export const TRIM_PAINT = '#f2efe7'

/**
 * A single trim board, described purely in the wall's (u, v) frame + an inward
 * offset. No THREE types here so the planner stays a pure, unit-testable function.
 */
export interface TrimSeg {
  kind: 'skirt' | 'casing' | 'cornice'
  wallId: string
  uCm: number // centre along the wall (cm from corner a)
  vCm: number // centre height above the floor (cm)
  lenU: number // length along the wall (cm)
  lenV: number // vertical extent (cm)
  depthCm: number // thickness normal to the wall = proud + embed (cm)
  insetCm: number // centre offset inward from the wall centreline (cm)
}

interface Interval {
  a: number
  b: number
}

export interface TrimOptions {
  cornice?: boolean
}

function mergeIntervals(ivs: Interval[]): Interval[] {
  const sorted = ivs.filter((i) => i.b > i.a).sort((x, y) => x.a - y.a)
  const out: Interval[] = []
  for (const iv of sorted) {
    const last = out[out.length - 1]
    if (last && iv.a <= last.b + 0.1) last.b = Math.max(last.b, iv.b)
    else out.push({ a: iv.a, b: iv.b })
  }
  return out
}

/** Runs of [0,L] NOT covered by `gaps` (with sub-1cm slivers dropped). */
function complementRuns(L: number, gaps: Interval[]): Interval[] {
  const merged = mergeIntervals(gaps)
  const runs: Interval[] = []
  let cursor = 0
  for (const g of merged) {
    const a = Math.max(0, g.a)
    const b = Math.min(L, g.b)
    if (a > cursor) runs.push({ a: cursor, b: a })
    cursor = Math.max(cursor, b)
  }
  if (cursor < L) runs.push({ a: cursor, b: L })
  return runs.filter((r) => r.b - r.a > 1)
}

/**
 * Plan every trim board for one room. PURE (no THREE / no DOM) so a test can
 * assert the skirting is genuinely gapped at door thresholds and the casing
 * never intrudes into an opening.
 *
 * @param walls          the room's wall segments
 * @param holeOpenings   EVERY opening that cuts a hole (incl. auto-cut connect
 *                       doorways) — used to break the skirting/cornice runs
 * @param frameOpenings  openings that get a cased architrave (framed, non-bare)
 */
export function planRoomTrim(
  walls: Wall[],
  holeOpenings: Opening[],
  frameOpenings: Opening[],
  wallHeight: number,
  wallThickness: number,
  opts: TrimOptions = {},
): TrimSeg[] {
  const cornice = opts.cornice ?? true
  const segs: TrimSeg[] = []
  const half = wallThickness / 2

  const skirtInset = half + (SKIRT_PROUD - EMBED) / 2
  const skirtDepth = SKIRT_PROUD + EMBED
  const corniceInset = half + (CORNICE_PROUD - EMBED) / 2
  const corniceDepth = CORNICE_PROUD + EMBED
  const casingInset = half + (CASING_PROUD - EMBED) / 2
  const casingDepth = CASING_PROUD + EMBED

  for (const wall of walls) {
    const L = wall.length
    if (L < 1) continue
    const holes = holeOpenings.filter((o) => o.wallId === wall.id)

    // ── skirting: runs along the base, GAPPED where an opening reaches the floor
    //    (doors/sliders/passages, and any glazing whose sill dips into the band).
    //    The gap clears the casing legs too so the skirting butts into the jamb. ──
    const floorGaps = holes
      .filter((o) => o.sill < SKIRT_H + 1)
      .map((o) => {
        const u = o.t * L
        const w = o.width / 2 + CASING_W
        return { a: u - w, b: u + w }
      })
    const cornerExt = half + SKIRT_PROUD
    for (const run of complementRuns(L, floorGaps)) {
      const a = run.a <= 0.5 ? -cornerExt : run.a // extend into the corner mitre
      const b = run.b >= L - 0.5 ? L + cornerExt : run.b
      segs.push({
        kind: 'skirt',
        wallId: wall.id,
        uCm: (a + b) / 2,
        vCm: (SKIRT_H - SKIRT_SINK) / 2,
        lenU: b - a,
        lenV: SKIRT_H + SKIRT_SINK,
        depthCm: skirtDepth,
        insetCm: skirtInset,
      })
    }

    // ── cornice: slim run along the wall/ceiling junction, gapped only where an
    //    opening's head reaches into the cornice band (tall passages / railings). ──
    if (cornice && wallHeight > CORNICE_H + 20) {
      const topGaps = holes
        .filter((o) => o.sill + o.height > wallHeight - CORNICE_H - 1)
        .map((o) => {
          const u = o.t * L
          const w = o.width / 2 + 2
          return { a: u - w, b: u + w }
        })
      const cExt = half + CORNICE_PROUD
      for (const run of complementRuns(L, topGaps)) {
        const a = run.a <= 0.5 ? -cExt : run.a
        const b = run.b >= L - 0.5 ? L + cExt : run.b
        segs.push({
          kind: 'cornice',
          wallId: wall.id,
          uCm: (a + b) / 2,
          vCm: wallHeight - CORNICE_H / 2,
          lenU: b - a,
          lenV: CORNICE_H,
          depthCm: corniceDepth,
          insetCm: corniceInset,
        })
      }
    }

    // ── casing / architrave: a frame OUTSIDE each opening perimeter (never into
    //    the clear opening — legs sit beyond uMin/uMax, head above the head). ──
    for (const o of frameOpenings) {
      if (o.wallId !== wall.id) continue
      // A near-full-wall opening (glass railing / open edge) reads wrong cased.
      if (o.width > 0.85 * L) continue
      const u = o.t * L
      const hw = o.width / 2
      const uMin = u - hw
      const uMax = u + hw
      const top = o.sill + o.height
      const legBottom = o.kind === 'window' ? o.sill : 0
      const legTop = Math.min(top, wallHeight - 0.5)
      const legLen = legTop - legBottom
      if (legLen > 5) {
        const legV = (legBottom + legTop) / 2
        segs.push({ kind: 'casing', wallId: wall.id, uCm: uMin - CASING_W / 2, vCm: legV, lenU: CASING_W, lenV: legLen, depthCm: casingDepth, insetCm: casingInset })
        segs.push({ kind: 'casing', wallId: wall.id, uCm: uMax + CASING_W / 2, vCm: legV, lenU: CASING_W, lenV: legLen, depthCm: casingDepth, insetCm: casingInset })
      }
      // head casing (skipped if it would poke through the ceiling)
      if (top + CASING_W <= wallHeight - 0.5) {
        segs.push({ kind: 'casing', wallId: wall.id, uCm: u, vCm: top + CASING_W / 2, lenU: o.width + 2 * CASING_W, lenV: CASING_W, depthCm: casingDepth, insetCm: casingInset })
      }
      // apron/stool below a window (doors meet the floor → no bottom casing)
      if (o.kind === 'window' && o.sill > CASING_W + 1) {
        segs.push({ kind: 'casing', wallId: wall.id, uCm: u, vCm: o.sill - CASING_W / 2, lenU: o.width + 2 * CASING_W, lenV: CASING_W, depthCm: casingDepth, insetCm: casingInset })
      }
    }
  }

  return segs
}

// ── geometry ──────────────────────────────────────────────────────────────────
// ONE shared unit box profile, stamped per segment. Lazily created so the module
// stays import-safe in a non-DOM env; the counter proves the profile is a true
// singleton (never re-allocated per segment or per room) for the test.
let _unit: THREE.BoxGeometry | null = null
let _unitCreations = 0
function unitProfile(): THREE.BoxGeometry {
  if (!_unit) {
    _unit = new THREE.BoxGeometry(1, 1, 1)
    _unitCreations++
  }
  return _unit
}

/** Test/introspection hook — the shared profile must be created exactly ONCE. */
export function _trimStats() {
  return { unitCreations: _unitCreations }
}

/**
 * Merge every planned segment into ONE frame-local geometry (metres). Stamps the
 * shared unit box with a per-segment T·R·S matrix: local +x runs along the wall,
 * +y is up, +z is the inward wall normal (a right-handed basis → correct winding
 * after the non-uniform scale). Returns null when a room has no trim.
 */
export function buildTrimGeometry(segs: TrimSeg[], walls: Wall[], frame: Frame): THREE.BufferGeometry | null {
  if (!segs.length) return null
  const wallById = new Map(walls.map((w) => [w.id, w]))
  const unit = unitProfile()
  const parts: THREE.BufferGeometry[] = []

  const xAxis = new THREE.Vector3()
  const yAxis = new THREE.Vector3(0, 1, 0)
  const zAxis = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const pos = new THREE.Vector3()

  for (const s of segs) {
    const wall = wallById.get(s.wallId)
    if (!wall) continue
    const L = wall.length
    const p = pointOnWall(wall, s.uCm / L)
    const [wx, wz] = frame.toWorld(p.x, p.z)
    const inset = s.insetCm / 100
    // inward normal (unit) → +z of the board; +x = yAxis × zAxis (along the wall)
    zAxis.set(wall.nx, 0, wall.nz)
    xAxis.set(wall.nz, 0, -wall.nx)
    scale.set(s.lenU / 100, s.lenV / 100, s.depthCm / 100)
    pos.set(wx + wall.nx * inset, s.vCm / 100, wz + wall.nz * inset)

    const m = new THREE.Matrix4()
    m.makeBasis(xAxis, yAxis, zAxis)
    m.scale(scale)
    m.setPosition(pos)
    parts.push(unit.clone().applyMatrix4(m))
  }

  if (!parts.length) return null
  const merged = mergeGeometries(parts, false)
  // The per-segment clones were only scratch to feed the merge — free their CPU
  // buffers now; the single merged geometry is what actually renders.
  for (const p of parts) p.dispose()
  return merged
}

/**
 * Room trim. Drop into BOTH render sites (single-room Room.tsx and whole-house
 * HouseView RoomShell) with the same room-local `frame`.
 *
 * ONE merged geometry PER WALL (each wall's skirting + casing + cornice collapse
 * to a single buffer) so the trim can ride the SAME open-dollhouse cull the walls
 * use — hiding a wall's trim whenever its wall is hidden, instead of leaving it
 * floating in the cut-away room. All wall meshes share ONE material and the ONE
 * unit profile, so cost scales with the wall count (like the walls themselves),
 * never with the segment count.
 *
 * Callers MUST pass stable (memoised) `walls` / `holeOpenings` / `frameOpenings`
 * references — the geometry is rebuilt only when one of them changes.
 */
export function RoomTrim({
  walls,
  frame,
  wallHeight,
  wallThickness,
  holeOpenings,
  frameOpenings,
  color = TRIM_PAINT,
  cornice = true,
}: {
  walls: Wall[]
  frame: Frame
  wallHeight: number
  wallThickness: number
  holeOpenings: Opening[]
  frameOpenings: Opening[]
  color?: string
  cornice?: boolean
}) {
  const groupRef = useRef<THREE.Group>(null)
  const meshRefs = useRef<(THREE.Mesh | null)[]>([])

  // One shared material for every wall's trim mesh (paintable white/wood).
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 }), [color])
  useEffect(() => () => material.dispose(), [material])

  const wallTrims = useMemo(() => {
    const segs = planRoomTrim(walls, holeOpenings, frameOpenings, wallHeight, wallThickness, { cornice })
    const out: { wall: Wall; geom: THREE.BufferGeometry }[] = []
    for (const wall of walls) {
      const geom = buildTrimGeometry(
        segs.filter((s) => s.wallId === wall.id),
        walls,
        frame,
      )
      if (geom) out.push({ wall, geom })
    }
    return out
  }, [walls, holeOpenings, frameOpenings, wallHeight, wallThickness, frame, cornice])

  // Free the merged buffers when the room re-plans / unmounts.
  useEffect(() => () => wallTrims.forEach((wt) => wt.geom.dispose()), [wallTrims])

  // Open-dollhouse cull: hide a wall's trim when the wall's interior face points
  // away from the camera — mirrors the wall cull in Room.tsx / HouseView so trim
  // never floats in the cut-away view. matrixWorld folds in the whole-house room
  // offset generically (identity in single-room).
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame((state) => {
    const g = groupRef.current
    if (!g) return
    g.updateWorldMatrix(true, false)
    const cx = state.camera.position.x
    const cz = state.camera.position.z
    for (let i = 0; i < wallTrims.length; i++) {
      const mesh = meshRefs.current[i]
      if (!mesh) continue
      const w = wallTrims[i].wall
      const [mx, mz] = frame.toWorld(w.midX, w.midZ)
      v.set(mx, 0, mz).applyMatrix4(g.matrixWorld)
      mesh.visible = w.nx * (cx - v.x) + w.nz * (cz - v.z) > -0.05
    }
  })

  if (!wallTrims.length) return null
  return (
    <group ref={groupRef}>
      {wallTrims.map((wt, i) => (
        <mesh
          key={wt.wall.id}
          ref={(el) => (meshRefs.current[i] = el)}
          geometry={wt.geom}
          material={material}
          receiveShadow
        />
      ))}
    </group>
  )
}
