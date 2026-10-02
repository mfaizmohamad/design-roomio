// Auto shot-planner: derive PROFESSIONAL per-room camera poses for ANY listing
// (the dynamic scenes built by buildSceneFromListing / _loadFlat, which have no
// hand-authored `shots`). Pure + framework-free (no three/React imports — only
// the ReplicaShot/RoomType/Opening TYPES), so it is unit-testable in isolation
// exactly like flatTemplates.ts.
//
// It encodes the encodable real-estate framing rulebook — the fixes for the
// four amateur tells that the current hand-authored shots exhibit:
//
//   1. LEVEL camera. target.y === cam.y on every room shot, so vertical walls
//      stay parallel (plumb) instead of keystoning. The hand-authored replica
//      shots pitch the camera (cam.y 1.45–1.55 aiming at target.y 0.6–0.95, a
//      ~14° down-tilt) which converges the verticals — the #1 amateur tell.
//   2. FOV CAP. three's PerspectiveCamera.fov is the VERTICAL fov. The replica
//      shots run 68–80° (≈14–15 mm-equiv) → gross barrel/wide distortion. We cap
//      at 65° and target ~46–58° (≈24 mm-equiv), the pro interior range.
//   3. TWO-POINT corner framing (camera backed onto a wall, offset toward a
//      corner, aimed diagonally at the opposite wall) for depth; ONE-POINT
//      (centred, straight-on) only for a symmetric hero (an island/hero wall).
//   4. A near-plane / obstruction guard: the camera is pushed off any wall or
//      foreground furniture it sits within ~0.4 m of, every emitted shot frames
//      ≥3 walls (rejecting degenerate 1-wall / shoot-out-the-doorway poses), and
//      the aim point is nudged off any door span so we never frame through a
//      doorway into the void beyond.
//
// Coordinates: rooms are given in DESIGN centimetres in the shared house plane
// (bbox-centre x,z + width w / length l), matching FlatSpec + ReplicaRoom. Shots
// come back in WORLD METRES with the house centred at the origin (world =
// (designCm − houseBoundsCentre)/100), matching how HouseView positions rooms
// (originCm = houseBoundsCm centre) and what cameraBus.applyView consumes.

import type { RoomType } from '../../multi-room/src/index'
import type { ReplicaShot } from '../data/listingFlats'

// ── tunables (the rulebook, as named constants) ──────────────────────────────

/** VERTICAL fov hard cap (three .fov). 65° ≈ 22 mm-equiv; we never emit wider. */
export const FOV_CAP = 65
/** Floor so a big room isn't shot too telephoto. 46° ≈ 26 mm-equiv. */
export const FOV_MIN = 46
/** Near-plane / obstruction clearance: push the camera off anything within this. */
export const NEAR_CLEAR_CM = 40 // ≈0.4 m
/** Standard eye height (dry rooms): chest-height, the pro real-estate default. */
export const EYE_STANDARD_M = 1.32
/** Kitchen/bath work at counter + 0.4 m so the counter plane reads well. */
const COUNTER_H_M = 0.95
export const EYE_WET_M = clamp(COUNTER_H_M + 0.4, 1.25, 1.45) // 1.35
/** Landscape aspect (width/height) the planner frames for — 3:2 gallery cards. */
export const DEFAULT_ASPECT = 1.5
/** Assumed ceiling height for vertical framing. */
const CEIL_M = 2.6
/** Two-point corner bias magnitude (fraction off wall centre). Gentle so ≥3
 *  walls stay in frame at a moderate fov. */
const BIAS = 0.1
/** Aim point inset from the faced wall's far corner (cm). */
const TGT_INSET_CM = 28

/**
 * Camera stand-off (cm) from the wall it backs onto, scaled to room depth: back
 * CLOSE to the wall in a shallow room (so both side walls spread into frame → ≥3
 * walls) but never nearer than the clearance floor, and never absurdly deep.
 */
function camDepthFor(depthDim: number): number {
  return clamp(depthDim * 0.22, NEAR_CLEAR_CM, 95)
}

// ── public input/output types ────────────────────────────────────────────────

export type WallId = 'w0' | 'w1' | 'w2' | 'w3'

/** An opening as the planner needs it (subset of Opening): door/window on a wall. */
export interface PlannerOpening {
  kind: 'door' | 'window'
  wallId: string
  t: number
  width: number // cm
  sill?: number // cm
}

/** A furniture footprint in ROOM-LOCAL cm (0..w, 0..l), like ReplicaFurniture. */
export interface PlannerFurniture {
  x: number
  z: number
  w?: number // cm
  d?: number // cm
  rot?: number // rad
}

/** A room to frame — house-plane bbox-centre + size, optional doors/furniture. */
export interface PlannerRoom {
  name: string
  type: RoomType
  w: number // cm
  l: number // cm
  x: number // house-plane bbox-centre (cm)
  z: number
  openings?: PlannerOpening[]
  furniture?: PlannerFurniture[]
}

/** House→world frame: the design-cm point that maps to the world origin. */
export interface HouseFrameCm {
  cx: number
  cz: number
}

export interface PlanOptions {
  /** Hero room (living / primary bedroom / island kitchen) → an extra shot and a
   *  leading one-point composition. */
  isHero?: boolean
  /** House→world centre. Defaults to the room's own centre (single-room framing). */
  frame?: HouseFrameCm
  /** Render aspect (width/height) the fov is sized for. Default 3:2. */
  aspect?: number
  /** Override the per-type shot count. */
  count?: number
}

// ── small geometry helpers ────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
function deg(rad: number): number {
  return (rad * 180) / Math.PI
}
function rad(d: number): number {
  return (d * Math.PI) / 180
}

interface Box {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

function roomBox(r: PlannerRoom): Box & { cx: number; cz: number } {
  return {
    minX: r.x - r.w / 2,
    maxX: r.x + r.w / 2,
    minZ: r.z - r.l / 2,
    maxZ: r.z + r.l / 2,
    cx: r.x,
    cz: r.z,
  }
}

interface WallSeg {
  id: WallId
  ax: number
  az: number
  bx: number
  bz: number
  nx: number // inward normal
  nz: number
}

/** The four bounding walls in house-plane cm, following the ReplicaRoom
 *  convention: w0 back (z=min, +x), w1 right (x=max, +z), w2 front (z=max, -x),
 *  w3 left (x=min, -z); inward normals point into the room. */
function wallSegs(r: PlannerRoom): WallSeg[] {
  const b = roomBox(r)
  return [
    { id: 'w0', ax: b.minX, az: b.minZ, bx: b.maxX, bz: b.minZ, nx: 0, nz: 1 },
    { id: 'w1', ax: b.maxX, az: b.minZ, bx: b.maxX, bz: b.maxZ, nx: -1, nz: 0 },
    { id: 'w2', ax: b.maxX, az: b.maxZ, bx: b.minX, bz: b.maxZ, nx: 0, nz: -1 },
    { id: 'w3', ax: b.minX, az: b.maxZ, bx: b.minX, bz: b.minZ, nx: 1, nz: 0 },
  ]
}

const OPPOSITE: Record<WallId, WallId> = { w0: 'w2', w2: 'w0', w1: 'w3', w3: 'w1' }
const IS_HORIZONTAL = (id: WallId) => id === 'w0' || id === 'w2' // runs along x

/** Wall length (cm) along its span. */
function wallLen(r: PlannerRoom, id: WallId): number {
  return IS_HORIZONTAL(id) ? r.w : r.l
}

/** Cross coordinate (x for horizontal walls, z for vertical) of an opening's
 *  centre, in house-plane cm, honouring each wall's a→b run direction. */
function openingCross(r: PlannerRoom, id: WallId, o: PlannerOpening): number {
  const c = o.t * wallLen(r, id)
  const b = roomBox(r)
  switch (id) {
    case 'w0':
      return b.minX + c // a=(minX,minZ), +x
    case 'w1':
      return b.minZ + c // a=(maxX,minZ), +z
    case 'w2':
      return b.maxX - c // a=(maxX,maxZ), -x
    default:
      return b.maxZ - c // w3: a=(minX,maxZ), -z
  }
}

/** Door spans on a wall as [lo,hi] in that wall's cross coordinate (cm). */
function doorSpans(r: PlannerRoom, id: WallId): Array<[number, number]> {
  return (r.openings ?? [])
    .filter((o) => o.wallId === id && o.kind === 'door')
    .map((o) => {
      const c = openingCross(r, id, o)
      return [c - o.width / 2, c + o.width / 2] as [number, number]
    })
}

/** Footprint AABBs (house-plane cm) of the room's furniture (rotation swaps w/d). */
function furnitureBoxes(r: PlannerRoom): Box[] {
  const b = roomBox(r)
  return (r.furniture ?? []).map((f) => {
    const fw = f.w ?? 60
    const fd = f.d ?? 60
    const swapped = Math.abs(Math.sin(f.rot ?? 0)) > 0.5
    const hw = (swapped ? fd : fw) / 2
    const hd = (swapped ? fw : fd) / 2
    const hx = b.minX + f.x
    const hz = b.minZ + f.z
    return { minX: hx - hw, maxX: hx + hw, minZ: hz - hd, maxZ: hz + hd }
  })
}

/** Euclidean distance from a point to an AABB (0 if inside). */
function distToBox(px: number, pz: number, box: Box): number {
  const dx = Math.max(box.minX - px, 0, px - box.maxX)
  const dz = Math.max(box.minZ - pz, 0, pz - box.maxZ)
  return Math.hypot(dx, dz)
}

/** Area-weighted centroid of the room's furniture (house-plane cm), or null. */
function furnitureCentroid(r: PlannerRoom): { x: number; z: number } | null {
  const boxes = furnitureBoxes(r)
  if (!boxes.length) return null
  let ax = 0
  let az = 0
  let aw = 0
  for (const b of boxes) {
    const w = (b.maxX - b.minX) * (b.maxZ - b.minZ)
    ax += ((b.minX + b.maxX) / 2) * w
    az += ((b.minZ + b.maxZ) / 2) * w
    aw += w
  }
  return aw > 0 ? { x: ax / aw, z: az / aw } : null
}

/** Clearance (cm) from a point to the nearest bounding wall (inside a rect room). */
function wallClearance(r: PlannerRoom, px: number, pz: number): number {
  const b = roomBox(r)
  return Math.min(px - b.minX, b.maxX - px, pz - b.minZ, b.maxZ - pz)
}

// ── the guard: push a pose clear of walls + furniture ─────────────────────────

/**
 * Push a camera point TOWARD `toward` (the room centre) until it clears every
 * wall and furniture footprint by NEAR_CLEAR_CM — or until it reaches the centre
 * (a room too cramped to fully clear still gets the best available pose). Pure;
 * exported so the guard can be unit-tested directly.
 */
export function nudgeClearOfObstructions(
  pt: { x: number; z: number },
  toward: { x: number; z: number },
  room: PlannerRoom,
): { x: number; z: number } {
  const boxes = furnitureBoxes(room)
  let x = pt.x
  let z = pt.z
  const dx = toward.x - x
  const dz = toward.z - z
  const dlen = Math.hypot(dx, dz)
  if (dlen < 1e-6) return { x, z }
  const ux = dx / dlen
  const uz = dz / dlen
  const STEP = 6 // cm
  for (let i = 0; i < 120; i++) {
    const wc = wallClearance(room, x, z)
    const fc = boxes.length ? Math.min(...boxes.map((b) => distToBox(x, z, b))) : Infinity
    if (wc >= NEAR_CLEAR_CM && fc >= NEAR_CLEAR_CM) break
    const remain = Math.hypot(toward.x - x, toward.z - z)
    if (remain <= STEP) {
      x = toward.x
      z = toward.z
      break
    }
    x += ux * STEP
    z += uz * STEP
  }
  return { x, z }
}

// ── visibility (frustum) ──────────────────────────────────────────────────────

/**
 * Which bounding walls are (partly) inside the LEVEL camera's horizontal
 * frustum. A rect-room interior camera always sees the inner face of any wall in
 * front of it within the horizontal fov, so this is a clean "≥3 walls" test.
 */
export function visibleWalls(
  room: PlannerRoom,
  cam: { x: number; z: number },
  target: { x: number; z: number },
  fovVDeg: number,
  aspect: number,
): WallId[] {
  let vx = target.x - cam.x
  let vz = target.z - cam.z
  const vlen = Math.hypot(vx, vz) || 1
  vx /= vlen
  vz /= vlen
  const halfV = rad(fovVDeg) / 2
  const halfH = Math.atan(Math.tan(halfV) * aspect)
  const out: WallId[] = []
  for (const w of wallSegs(room)) {
    let seen = false
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const px = w.ax + (w.bx - w.ax) * t
      const pz = w.az + (w.bz - w.az) * t
      let ex = px - cam.x
      let ez = pz - cam.z
      const el = Math.hypot(ex, ez)
      if (el < 1e-3) continue
      ex /= el
      ez /= el
      const dot = ex * vx + ez * vz
      if (dot <= 0) continue // behind the camera
      if (Math.acos(clamp(dot, -1, 1)) <= halfH) {
        seen = true
        break
      }
    }
    if (seen) out.push(w.id)
  }
  return out
}

// ── pose composition ───────────────────────────────────────────────────────────

/** Move a target's cross coordinate off any door span on the faced wall, so the
 *  aim never looks straight through a doorway. Returns the adjusted point. */
function aimOffDoors(room: PlannerRoom, faceId: WallId, tgt: { x: number; z: number }): { x: number; z: number } {
  const spans = doorSpans(room, faceId)
  if (!spans.length) return tgt
  const horiz = IS_HORIZONTAL(faceId)
  let c = horiz ? tgt.x : tgt.z
  const [lo, hi] = horiz ? [roomBox(room).minX, roomBox(room).maxX] : [roomBox(room).minZ, roomBox(room).maxZ]
  const inset = 30
  for (let iter = 0; iter < spans.length + 2; iter++) {
    const hit = spans.find(([s0, s1]) => c > s0 - 15 && c < s1 + 15)
    if (!hit) break
    // step to whichever solid edge stays in bounds and is nearer.
    const left = hit[0] - 25
    const right = hit[1] + 25
    const leftOk = left >= lo + inset
    const rightOk = right <= hi - inset
    if (leftOk && (!rightOk || Math.abs(left - c) <= Math.abs(right - c))) c = left
    else if (rightOk) c = right
    else break // wall is essentially all doorway — leave it
  }
  c = clamp(c, lo + inset, hi - inset)
  return horiz ? { x: c, z: tgt.z } : { x: tgt.x, z: c }
}

/** Raw two/one-point pose (house-plane cm): camera backed onto OPPOSITE(faceId),
 *  offset toward a corner by `bias`, aimed diagonally across at `faceId`. */
function rawPose(room: PlannerRoom, faceId: WallId, bias: number): { cam: { x: number; z: number }; tgt: { x: number; z: number } } {
  const b = roomBox(room)
  const horiz = IS_HORIZONTAL(faceId)
  const depthDim = horiz ? room.l : room.w
  const camDepth = camDepthFor(depthDim)
  const p = 0.5 - bias * BIAS // camera along-wall fraction
  const q = 0.5 + bias * BIAS // target along-wall fraction (diagonal)
  let cam: { x: number; z: number }
  let tgt: { x: number; z: number }
  switch (faceId) {
    case 'w2': // face front (z=max); back onto w0
      cam = { x: lerp(b.minX, b.maxX, p), z: b.minZ + camDepth }
      tgt = { x: lerp(b.minX, b.maxX, q), z: b.maxZ - TGT_INSET_CM }
      break
    case 'w0': // face back (z=min); back onto w2
      cam = { x: lerp(b.minX, b.maxX, p), z: b.maxZ - camDepth }
      tgt = { x: lerp(b.minX, b.maxX, q), z: b.minZ + TGT_INSET_CM }
      break
    case 'w1': // face right (x=max); back onto w3
      cam = { x: b.minX + camDepth, z: lerp(b.minZ, b.maxZ, p) }
      tgt = { x: b.maxX - TGT_INSET_CM, z: lerp(b.minZ, b.maxZ, q) }
      break
    default: // w3: face left (x=min); back onto w1
      cam = { x: b.maxX - camDepth, z: lerp(b.minZ, b.maxZ, p) }
      tgt = { x: b.minX + TGT_INSET_CM, z: lerp(b.minZ, b.maxZ, q) }
  }
  return { cam, tgt: aimOffDoors(room, faceId, tgt) }
}

/** Base vertical fov to frame the ceiling height across the look distance. */
function baseFov(room: PlannerRoom, faceId: WallId, eyeM: number): number {
  const depthDim = IS_HORIZONTAL(faceId) ? room.l : room.w
  const camDepth = camDepthFor(depthDim)
  const dist = Math.max(1.1, (depthDim - camDepth) / 100)
  const halfSpan = Math.max(CEIL_M - eyeM, eyeM) * 1.12 // fit the taller side of the wall
  return clamp(deg(2 * Math.atan(halfSpan / dist)), FOV_MIN, FOV_CAP)
}

/** House-plane cm → world metres (level: same eye y for cam + target). */
function toWorld(x: number, z: number, eyeM: number, frame: HouseFrameCm): [number, number, number] {
  return [(x - frame.cx) / 100, eyeM, (z - frame.cz) / 100]
}

/**
 * Build ONE shot facing `faceId`. Self-heals to ≥3 visible walls: first relaxes
 * the corner bias toward centre, then widens the fov toward the cap — so every
 * emitted shot clears the guard while never exceeding FOV_CAP or tilting.
 */
function composeShot(
  room: PlannerRoom,
  faceId: WallId,
  startBias: number,
  eyeM: number,
  aspect: number,
  frame: HouseFrameCm,
  name: string,
): ReplicaShot {
  const center = { x: room.x, z: room.z }
  const bf = baseFov(room, faceId, eyeM)
  let best: { cam: { x: number; z: number }; tgt: { x: number; z: number }; fov: number; vis: number } | null = null
  for (const bmul of [1, 0.5, 0]) {
    const { cam, tgt } = rawPose(room, faceId, startBias * bmul)
    const camC = nudgeClearOfObstructions(cam, center, room)
    let fov = bf
    let vis = visibleWalls(room, camC, tgt, fov, aspect).length
    while (vis < 3 && fov < FOV_CAP) {
      fov = Math.min(FOV_CAP, fov + 2)
      vis = visibleWalls(room, camC, tgt, fov, aspect).length
    }
    if (!best || vis > best.vis) best = { cam: camC, tgt, fov, vis }
    if (vis >= 3) break
  }
  const { cam, tgt, fov } = best!
  return {
    name,
    photo: 0, // reassigned round-robin in planFlatShots
    mode: 'house',
    room: room.name,
    cam: toWorld(cam.x, cam.z, eyeM, frame),
    target: toWorld(tgt.x, tgt.z, eyeM, frame),
    fov: Math.round(fov),
  }
}

// ── face-wall ranking ──────────────────────────────────────────────────────────

/** Score a wall as a "look-at" target: prefer framing a window, looking down the
 *  room's LONG axis, and avoiding walls dominated by a door/passage (void). */
function faceScore(room: PlannerRoom, id: WallId): number {
  const ops = (room.openings ?? []).filter((o) => o.wallId === id)
  const L = wallLen(room, id)
  let s = 0
  if (ops.some((o) => o.kind === 'window')) s += 2
  const doorFrac = ops.filter((o) => o.kind === 'door').reduce((m, o) => Math.max(m, o.width / L), 0)
  s -= doorFrac * 4
  // Prefer looking DOWN the room's long axis (more depth, and — in a shallow
  // room — the near side walls stay close enough to keep ≥3 in frame). Facing a
  // horizontal wall (w0/w2) means looking along Z.
  const looksAlongZ = IS_HORIZONTAL(id)
  const longAxisIsZ = room.l >= room.w
  if (looksAlongZ === longAxisIsZ) s += 1.2
  // Frame the FURNISHED side: bonus for facing the wall the furniture sits nearer
  // (so beds/sofas/counters are in shot, not behind the camera against a bare wall).
  const cen = furnitureCentroid(room)
  if (cen) {
    const b = roomBox(room)
    const distToFace =
      id === 'w0' ? cen.z - b.minZ : id === 'w2' ? b.maxZ - cen.z : id === 'w1' ? b.maxX - cen.x : cen.x - b.minX
    s += (1 - clamp(distToFace / (IS_HORIZONTAL(id) ? room.l : room.w), 0, 1)) * 1.6
  }
  return s
}

/** Walls ranked best→worst to face, stable tie-break (front, back, right, left). */
function rankedFaces(room: PlannerRoom): WallId[] {
  const order: WallId[] = ['w2', 'w0', 'w1', 'w3']
  return order
    .map((id, i) => ({ id, s: faceScore(room, id), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((e) => e.id)
}

// ── shot counts ────────────────────────────────────────────────────────────────

/** Shots per room type: 2–3 for living/kitchen/primary-bed, 2 for bed/bath. */
export function shotCount(type: RoomType, isHero: boolean): number {
  switch (type) {
    case 'living':
      return 3
    case 'kitchen':
      return isHero ? 3 : 2
    case 'bedroom':
      return isHero ? 3 : 2
    case 'bathroom':
      return 2
    case 'dining':
    case 'office':
      return 2
    case 'foyer':
    case 'hallway':
    case 'balcony':
      return 1
    default:
      return 2
  }
}

function eyeHeightM(type: RoomType): number {
  return type === 'kitchen' || type === 'bathroom' ? EYE_WET_M : EYE_STANDARD_M
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// ── planShots (per room) ────────────────────────────────────────────────────────

/**
 * Professional camera poses for ONE room. Every shot is LEVEL (target.y ===
 * cam.y), fov ≤ FOV_CAP, frames ≥3 walls, and is nudged clear of walls/furniture.
 * Two-point corner framing by default; a leading one-point shot for a hero room.
 */
export function planShots(room: PlannerRoom, opts: PlanOptions = {}): ReplicaShot[] {
  const frame = opts.frame ?? { cx: room.x, cz: room.z }
  const aspect = opts.aspect ?? DEFAULT_ASPECT
  const eyeM = eyeHeightM(room.type)
  const n = opts.count ?? shotCount(room.type, !!opts.isHero)
  const faces = rankedFaces(room)
  const sl = slug(room.name)

  // Composition plan: hero leads with a one-point (centred) hero wall; the rest
  // are two-point corner shots on distinct walls, alternating the corner bias.
  const plan: Array<{ face: WallId; bias: number }> = []
  if (opts.isHero) plan.push({ face: faces[0], bias: 0 })
  else plan.push({ face: faces[0], bias: 1 })
  plan.push({ face: faces[1 % faces.length], bias: -1 })
  plan.push({ face: faces[2 % faces.length], bias: 1 })
  plan.push({ face: faces[3 % faces.length], bias: -1 })

  const shots: ReplicaShot[] = []
  for (let i = 0; i < n; i++) {
    const { face, bias } = plan[i % plan.length]
    shots.push(composeShot(room, face, bias, eyeM, aspect, frame, `${sl}-${i + 1}`))
  }
  return shots
}

// ── planFlatShots (whole flat) ───────────────────────────────────────────────────

/** House→world frame (bounds centre) for a set of house-plane rooms. */
export function houseFrame(rooms: PlannerRoom[]): HouseFrameCm {
  if (!rooms.length) return { cx: 0, cz: 0 }
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const r of rooms) {
    const b = roomBox(r)
    minX = Math.min(minX, b.minX)
    maxX = Math.max(maxX, b.maxX)
    minZ = Math.min(minZ, b.minZ)
    maxZ = Math.max(maxZ, b.maxZ)
  }
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 }
}

/** An elevated 3/4 establishing view of the WHOLE flat (house mode renders it
 *  roofless from outside, like the template cards). This contextual overview is
 *  intentionally NOT level — the plumb-vertical rule governs the per-room cards. */
function planOverview(rooms: PlannerRoom[], frame: HouseFrameCm, aspect: number): ReplicaShot {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const r of rooms) {
    const b = roomBox(r)
    minX = Math.min(minX, b.minX)
    maxX = Math.max(maxX, b.maxX)
    minZ = Math.min(minZ, b.minZ)
    maxZ = Math.max(maxZ, b.maxZ)
  }
  const halfW = (maxX - minX) / 200 // metres
  const halfD = (maxZ - minZ) / 200
  const R = Math.max(halfW, halfD, 2)
  void aspect
  return {
    name: 'overview',
    photo: 0,
    mode: 'house',
    cam: [halfW + R * 0.55, R * 1.15 + 1.6, -(halfD + R * 0.55)],
    target: [0, 0.9, 0],
    fov: 52,
  }
}

/**
 * Plan cameras for a whole dynamic flat: per-room shots (hero = living + the
 * largest bedroom) plus one whole-flat overview. Rooms are in house-plane cm;
 * shots come back in world metres centred on the flat. Photo indices are a
 * round-robin so the QA sheet pairs each render with a listing photo.
 */
export function planFlatShots(
  rooms: PlannerRoom[],
  opts: { aspect?: number } = {},
): ReplicaShot[] {
  const frame = houseFrame(rooms)
  const aspect = opts.aspect ?? DEFAULT_ASPECT
  const beds = rooms.filter((r) => r.type === 'bedroom')
  const primaryBed = beds.length ? beds.reduce((a, b) => (b.w * b.l > a.w * a.l ? b : a)).name : null

  const out: ReplicaShot[] = []
  for (const room of rooms) {
    const isHero = room.type === 'living' || (room.type === 'bedroom' && room.name === primaryBed)
    out.push(...planShots(room, { isHero, frame, aspect }))
  }
  out.push(planOverview(rooms, frame, aspect))
  out.forEach((s, i) => (s.photo = i))
  return out
}

// ── analysis (for tests + diagnostics) ────────────────────────────────────────

export interface ShotAnalysis {
  camHouse: { x: number; z: number }
  targetHouse: { x: number; z: number }
  level: boolean
  visibleWalls: WallId[]
  visibleWallCount: number
  minWallClearCm: number
  minFurnitureClearCm: number
  throughDoorway: boolean
}

/** Re-derive a shot's house-plane geometry + guard metrics for verification. */
export function analyzeShot(
  room: PlannerRoom,
  shot: ReplicaShot,
  frame: HouseFrameCm,
  aspect: number = DEFAULT_ASPECT,
): ShotAnalysis {
  const camHouse = { x: shot.cam[0] * 100 + frame.cx, z: shot.cam[2] * 100 + frame.cz }
  const targetHouse = { x: shot.target[0] * 100 + frame.cx, z: shot.target[2] * 100 + frame.cz }
  const boxes = furnitureBoxes(room)
  const minFurn = boxes.length ? Math.min(...boxes.map((b) => distToBox(camHouse.x, camHouse.z, b))) : Infinity
  const vis = visibleWalls(room, camHouse, targetHouse, shot.fov, aspect)

  // faced wall = the bounding wall nearest the aim point; through-doorway = the
  // aim's cross coordinate lands in one of that wall's door spans.
  const b = roomBox(room)
  const faceDist: Array<[WallId, number]> = [
    ['w0', Math.abs(targetHouse.z - b.minZ)],
    ['w2', Math.abs(targetHouse.z - b.maxZ)],
    ['w1', Math.abs(targetHouse.x - b.maxX)],
    ['w3', Math.abs(targetHouse.x - b.minX)],
  ]
  const faced = faceDist.sort((p, q) => p[1] - q[1])[0][0]
  const cross = IS_HORIZONTAL(faced) ? targetHouse.x : targetHouse.z
  const throughDoorway = doorSpans(room, faced).some(([s0, s1]) => cross > s0 && cross < s1)

  return {
    camHouse,
    targetHouse,
    level: shot.cam[1] === shot.target[1],
    visibleWalls: vis,
    visibleWallCount: vis.length,
    minWallClearCm: wallClearance(room, camHouse.x, camHouse.z),
    minFurnitureClearCm: minFurn,
    throughDoorway,
  }
}
