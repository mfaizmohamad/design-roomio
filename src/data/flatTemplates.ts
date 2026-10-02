// Flat templates + per-room-type design defaults (PURE data + geometry — no store/React/three, so
// it's unit-testable and a single source of truth). Consumed by src/three/houseSession.ts.
//
// Research-grounded (Indian NBC-2016 minimums + typical builder plans + interior-flooring norms):
//  - WET rooms (kitchen/bath) use TILE, never wood; bathrooms get a distinctive BLUE tile.
//  - DRY rooms (living/bedroom/dining/office) use warm wood; foyer gets premium marble.
//  - Each room gets type-appropriate STARTER FURNITURE so it reads as its function on sight.
// Every floor id indexes src/data/materials.ts FLOOR_TEXTURES; every archetype id is a real id in
// src/data/archetypes.catalog.json (pinned by flatTemplates.test.ts).

import type { Vec2, Opening } from '../types'
import type { RoomType } from '../../multi-room/src/index'
import { bbox, deriveWalls, pointOnWall } from '../geometry/walls'
import { ARCHETYPE_MAP } from './archetypes'

/** Distinctive per-room-type floor (FLOOR_TEXTURES id) + wall (hex) so each room reads distinctly. */
export const DESIGN_DEFAULTS: Partial<Record<RoomType, { floor: string; wall: string }>> = {
  living: { floor: 'natural-oak', wall: '#d6c6a8' },
  bedroom: { floor: 'light-oak', wall: '#e8cdbf' },
  kitchen: { floor: 'sand-tile', wall: '#f4f1ea' },
  bathroom: { floor: 'blue-tile', wall: '#bcd0d6' },
  dining: { floor: 'walnut', wall: '#9a8167' },
  foyer: { floor: 'marble-tile', wall: '#f4f1ea' },
  hallway: { floor: 'sand-tile', wall: '#f4f1ea' },
  office: { floor: 'grey-wood', wall: '#d6c6a8' },
  balcony: { floor: 'terracotta-tile', wall: '#8fa07a' },
}

/** Wall/corner seed anchors (cm) inside a room bbox. addFurniture()'s §7 solver snaps flush +
 *  resolves collisions, so these just distribute pieces to the right regions. */
export type Anchor =
  | 'back' | 'front' | 'left' | 'right' | 'center'
  | 'back-left' | 'back-right' | 'front-left' | 'front-right'
  | 'near-back' | 'near-front' | 'near-left' | 'near-right'

export function anchorPos(b: ReturnType<typeof bbox>, a: Anchor, inset = 45): { x: number; z: number } {
  const nearX = b.minX + inset, farX = b.maxX - inset
  const nearZ = b.minZ + inset, farZ = b.maxZ - inset
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2
  switch (a) {
    case 'back': return { x: cx, z: nearZ }
    case 'front': return { x: cx, z: farZ }
    case 'left': return { x: nearX, z: cz }
    case 'right': return { x: farX, z: cz }
    case 'back-left': return { x: nearX, z: nearZ }
    case 'back-right': return { x: farX, z: nearZ }
    case 'front-left': return { x: nearX, z: farZ }
    case 'front-right': return { x: farX, z: farZ }
    case 'near-back': return { x: cx, z: cz - 65 }
    case 'near-front': return { x: cx, z: cz + 65 }
    case 'near-left': return { x: cx - 65, z: cz }
    case 'near-right': return { x: cx + 65, z: cz }
    default: return { x: cx, z: cz }
  }
}

// ---------------------------------------------------------------------------
// Orientation + door-awareness (why the defaults now look like a real designer placed them):
//  - `face` gives each piece an intended FACING so wall pieces back onto their wall instead of
//    facing it (the old bug — a sofa at `front` sat with its front against the wall). rotation 0
//    faces +Z, so a piece backing onto the +Z (front) wall faces -Z, etc.
//  - doors: placement nudges any piece out of a ~95 cm clear zone in front of every door, so a sofa
//    / mirror / bed never lands on a doorway (which never happens in a real home).

/** Which way a piece FACES. 'in' = back onto its anchor's wall, face into the room (the default for
 *  wall pieces). 'center' = face the room centre (chairs around a table, an accent chair at the sofa). */
export type Face = '+z' | '-z' | '+x' | '-x' | 'center' | 'in'

const FACE_ROT: Record<'+z' | '-z' | '+x' | '-x', number> = {
  '+z': 0,
  '-z': Math.PI,
  '+x': Math.PI / 2,
  '-x': (3 * Math.PI) / 2,
}

/** The face-into-the-room direction for a wall-hugging piece at anchor `at`. */
function faceInFor(at: Anchor): '+z' | '-z' | '+x' | '-x' {
  switch (at) {
    case 'back': case 'back-left': case 'back-right': case 'near-back': return '+z'
    case 'front': case 'front-left': case 'front-right': case 'near-front': return '-z'
    case 'left': case 'near-left': return '+x'
    case 'right': case 'near-right': return '-x'
    default: return '+z' // center → symmetric pieces (rug/table); rotation barely matters
  }
}

/** Rotation (rad about +Y; 0 faces +Z, matching the app/§7-solver convention) for a plan piece. */
export function rotationFor(face: Face | undefined, at: Anchor, pos: Vec2, center: Vec2): number {
  const f = face ?? 'in'
  if (f === 'center') return Math.atan2(center.x - pos.x, center.z - pos.z) // +z-forward: atan2(dx, dz)
  if (f === 'in') return FACE_ROT[faceInFor(at)]
  return FACE_ROT[f]
}

// Clear zone kept in front of every doorway so nothing blocks it (cm), + a lateral margin.
const DOOR_CLEAR_DEPTH = 95
const DOOR_SIDE_MARGIN = 18

// `axis` = the along-the-wall axis; a blocking piece slides along IT (not into the wall) to clear.
// Optional: only door keep-out boxes carry an axis; a piece footprint is a plain AABB (no wall axis).
interface Box { minX: number; maxX: number; minZ: number; maxZ: number; axis?: 'x' | 'z' }

/** Axis-aligned keep-out boxes in front of each DOOR. Flat rooms are rectangles, so their walls are
 *  axis-aligned and these boxes are clean AABBs. */
function doorKeepOuts(corners: Vec2[], doors: Opening[]): Box[] {
  if (!doors.length) return []
  const walls = deriveWalls(corners)
  const out: Box[] = []
  for (const o of doors) {
    if (o.kind !== 'door') continue
    const w = walls.find((ww) => ww.id === o.wallId)
    if (!w) continue
    const c = pointOnWall(w, o.t) // door centre on the wall (local cm)
    const halfSpan = o.width / 2 + DOOR_SIDE_MARGIN
    // rectangle: door span along the wall direction, extruded inward along the wall normal.
    const ax = c.x - w.dirX * halfSpan, az = c.z - w.dirZ * halfSpan
    const bx = c.x + w.dirX * halfSpan, bz = c.z + w.dirZ * halfSpan
    const cxi = bx + w.nx * DOOR_CLEAR_DEPTH, czi = bz + w.nz * DOOR_CLEAR_DEPTH
    const dxi = ax + w.nx * DOOR_CLEAR_DEPTH, dzi = az + w.nz * DOOR_CLEAR_DEPTH
    out.push({
      minX: Math.min(ax, bx, cxi, dxi), maxX: Math.max(ax, bx, cxi, dxi),
      minZ: Math.min(az, bz, czi, dzi), maxZ: Math.max(az, bz, czi, dzi),
      axis: Math.abs(w.dirX) >= Math.abs(w.dirZ) ? 'x' : 'z',
    })
  }
  return out
}

/** Footprint AABB of a piece (its rotation swaps w/d at the quarter-turns). */
function footprint(archetype: string, x: number, z: number, rot: number): Box {
  const a = ARCHETYPE_MAP[archetype]
  const w = a?.w ?? 60, d = a?.d ?? 60
  const swapped = Math.abs(Math.sin(rot)) > 0.5 // ~90°/270° → w runs along z
  const hw = (swapped ? d : w) / 2
  const hd = (swapped ? w : d) / 2
  return { minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd }
}

/** Slide a piece out of any door clear-zone (along the axis of least penetration), clamped inside. */
function nudgeClearOfDoors(archetype: string, x: number, z: number, rot: number, keepOuts: Box[], b: ReturnType<typeof bbox>): Vec2 {
  let px = x, pz = z
  for (let iter = 0; iter < 5; iter++) {
    let moved = false
    for (const k of keepOuts) {
      const fp = footprint(archetype, px, pz, rot)
      const ox = Math.min(fp.maxX, k.maxX) - Math.max(fp.minX, k.minX)
      const oz = Math.min(fp.maxZ, k.maxZ) - Math.max(fp.minZ, k.minZ)
      if (ox > 0 && oz > 0) {
        // Slide ALONG the door's wall (never into it) so a wall-hugging piece steps aside, not back.
        if (k.axis === 'x') {
          const kcx = (k.minX + k.maxX) / 2
          px += (px >= kcx ? 1 : -1) * (ox + 3)
        } else {
          const kcz = (k.minZ + k.maxZ) / 2
          pz += (pz >= kcz ? 1 : -1) * (oz + 3)
        }
        moved = true
      }
    }
    if (!moved) break
  }
  const inset = 28
  return {
    x: Math.max(b.minX + inset, Math.min(b.maxX - inset, px)),
    z: Math.max(b.minZ + inset, Math.min(b.maxZ - inset, pz)),
  }
}

/** Per-type starter furniture (real catalog ids). Ordered so floor pieces (rug) land first; wall/
 *  surface pieces (tv, hood, mirror, table lamp) auto-mount via mount.ts. */
export const FURNITURE_PLAN: Partial<Record<RoomType, Array<{ a: string; at: Anchor; face?: Face }>>> = {
  // Living: media wall on the exterior BACK (-Z) wall; sofa backs onto the FRONT (+Z) wall facing
  // the TV (its back to the wall), anchored front-RIGHT so it never spans the mid-front doorway;
  // coffee table + accent chair close the conversation zone; arc lamp in the door-free back corner.
  living: [
    { a: 'decor-rug-large', at: 'center', face: 'center' },
    { a: 'storage-tv', at: 'back', face: '+z' },
    { a: 'decor-tv', at: 'back', face: '+z' },
    { a: 'sofa-3', at: 'front-right', face: '-z' },
    { a: 'table-coffee', at: 'near-right', face: 'center' },
    { a: 'chair-accent', at: 'near-left', face: 'center' },
    { a: 'decor-lamp-arc', at: 'back-left', face: 'in' },
  ],
  // Bedroom: bed headboard centered on the exterior FRONT (+Z) wall (off the -Z door wall), nightstands
  // flanking it; wardrobe cornered on a side wall clear of the door swing; dresser + mirror opposite.
  bedroom: [
    { a: 'decor-rug', at: 'center', face: '+z' },
    { a: 'bed-queen', at: 'front', face: '-z' },
    { a: 'storage-nightstand', at: 'front-left', face: '-z' },
    { a: 'storage-nightstand', at: 'front-right', face: '-z' },
    { a: 'decor-lamp-table', at: 'front-left', face: '-z' },
    { a: 'storage-wardrobe', at: 'back-left', face: '+x' },
    { a: 'storage-dresser', at: 'right', face: '-x' },
    { a: 'decor-mirror', at: 'right', face: '-x' },
  ],
  // Kitchen: sink→stove→fridge work triangle along the exterior right (+X) + back (-Z) walls (an L),
  // hood over the stove; the interior front (+Z) wall + its doorway approach left completely open.
  kitchen: [
    { a: 'kitchen-counter', at: 'right', face: '-x' },
    { a: 'kitchen-sink', at: 'front-right', face: '-x' },
    { a: 'kitchen-stove', at: 'back-right', face: '+z' },
    { a: 'kitchen-hood', at: 'back-right', face: '+z' },
    { a: 'kitchen-fridge', at: 'back-right', face: '+z' },
  ],
  // Bathroom: vanity + mirror paired on one wall; toilet turned side-on (never facing the door);
  // walk-in shower boxed into the far corner; a clear lane from the door stays open.
  bathroom: [
    { a: 'bath-vanity', at: 'front-left', face: '-z' },
    { a: 'decor-mirror', at: 'front-left', face: '-z' },
    { a: 'bath-toilet', at: 'back-right', face: '-x' },
    { a: 'bath-shower', at: 'front-right', face: '-x' },
  ],
  // Dining: table centered with four chairs tucked in facing it; only corner pieces (chest + plant)
  // so nothing spans a wall midpoint where doorways get cut.
  dining: [
    { a: 'decor-rug-round', at: 'center', face: 'in' },
    { a: 'table-dining', at: 'center', face: 'center' },
    { a: 'chair-dining', at: 'near-back', face: 'center' },
    { a: 'chair-dining', at: 'near-front', face: 'center' },
    { a: 'chair-dining', at: 'near-left', face: 'center' },
    { a: 'chair-dining', at: 'near-right', face: 'center' },
    { a: 'storage-chest', at: 'back-left', face: '+z' },
    { a: 'decor-plant', at: 'back-right', face: 'in' },
  ],
  // Foyer: console + mirror + shoe cabinet hugged into the back corners, a bench opposite — all clear
  // of the entry door and any mid-wall passage.
  foyer: [
    { a: 'table-hall', at: 'back-left', face: '+z' },
    { a: 'decor-mirror', at: 'back-left', face: '+z' },
    { a: 'decor-lamp-table', at: 'back-left', face: '+z' },
    { a: 'storage-shoe', at: 'back-right', face: '+z' },
    { a: 'bench-entry', at: 'front-left', face: '-z' },
    { a: 'decor-plant', at: 'front-right', face: 'center' },
  ],
  // Office: desk on a side wall with the chair on the room side; bookcase + filing in the corners;
  // an accent chair + plant — the back-wall door region kept clear.
  office: [
    { a: 'decor-rug', at: 'center', face: 'in' },
    { a: 'desk-office', at: 'right', face: 'in' },
    { a: 'chair-office', at: 'near-right', face: '+x' },
    { a: 'storage-bookcase', at: 'front-right', face: 'in' },
    { a: 'storage-filing', at: 'back-right', face: 'in' },
    { a: 'chair-accent', at: 'front-left', face: 'center' },
    { a: 'decor-plant', at: 'left', face: 'in' },
  ],
  // Balcony (utility): lounge chair + side table along the exterior rail, washing machine in the back
  // corner, a plant — compact and clear of the access door.
  balcony: [
    { a: 'chair-lounge', at: 'front-right', face: 'center' },
    { a: 'table-side', at: 'right', face: 'in' },
    { a: 'kitchen-washer', at: 'back-right', face: 'in' },
    { a: 'decor-plant', at: 'front', face: 'in' },
  ],
  // hallway: intentionally empty (a narrow circulation corridor)
}

/**
 * Type-appropriate starter furniture for a room, as {archetype, x, z, rotation} in design cm/rad.
 * Each piece carries an intended FACING (back-to-wall for wall pieces) and is nudged clear of any
 * door in `doors` (pass the room's door openings). addFurniture() then snaps each flush via the §7
 * solver, keeping the supplied rotation. Unknown types → []. Never throws.
 */
export function defaultFurnitureFor(
  type: RoomType,
  corners: Vec2[],
  doors: Opening[] = [],
): Array<{ archetype: string; x: number; z: number; rotation: number }> {
  const plan = FURNITURE_PLAN[type]
  if (!plan) return []
  const b = bbox(corners)
  const center: Vec2 = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }
  const keepOuts = doorKeepOuts(corners, doors)
  return plan.map((p) => {
    const pos = anchorPos(b, p.at)
    const rotation = rotationFor(p.face, p.at, pos, center)
    const placed = keepOuts.length ? nudgeClearOfDoors(p.a, pos.x, pos.z, rotation, keepOuts, b) : pos
    return { archetype: p.a, x: placed.x, z: placed.z, rotation }
  })
}

export type FlatSpec = Array<{ name: string; type: RoomType; w: number; l: number; x: number; z: number }>

/**
 * 1BHK (~460 sq ft carpet). Tiles a 660×720 cm rectangle: left column = Living over Bedroom; right
 * column = Kitchen / Foyer / Bathroom / Utility stacked on a shared plumbing wall.
 */
export const FLAT_1BHK: FlatSpec = [
  { name: 'Living Room', type: 'living', w: 380, l: 400, x: 190, z: 200 },
  { name: 'Bedroom', type: 'bedroom', w: 380, l: 320, x: 190, z: 560 },
  { name: 'Kitchen', type: 'kitchen', w: 280, l: 250, x: 520, z: 125 },
  { name: 'Foyer', type: 'foyer', w: 280, l: 150, x: 520, z: 325 },
  { name: 'Bathroom', type: 'bathroom', w: 280, l: 150, x: 520, z: 475 },
  { name: 'Utility Balcony', type: 'balcony', w: 280, l: 170, x: 520, z: 635 },
]

/**
 * 2BHK (~800 sq ft carpet). Tiles a 900×1120 cm rectangle: public front (Living | Kitchen+Dining |
 * Balcony), a full-width hallway spine, then two bedrooms each with an attached bath at the rear.
 */
export const FLAT_2BHK: FlatSpec = [
  { name: 'Living Room', type: 'living', w: 520, l: 460, x: 260, z: 230 },
  { name: 'Kitchen', type: 'kitchen', w: 260, l: 230, x: 650, z: 115 },
  { name: 'Dining', type: 'dining', w: 260, l: 230, x: 650, z: 345 },
  { name: 'Balcony', type: 'balcony', w: 120, l: 460, x: 840, z: 230 },
  { name: 'Hallway', type: 'hallway', w: 900, l: 120, x: 450, z: 520 },
  { name: 'Master Bedroom', type: 'bedroom', w: 450, l: 370, x: 225, z: 765 },
  { name: 'Bedroom 2', type: 'bedroom', w: 450, l: 370, x: 675, z: 765 },
  { name: 'Master Bath', type: 'bathroom', w: 450, l: 170, x: 225, z: 1035 },
  { name: 'Common Bath', type: 'bathroom', w: 450, l: 170, x: 675, z: 1035 },
]

/**
 * 3BHK (~1250 sq ft carpet). Tiles a 1080×1200 cm rectangle: public front (Living | Kitchen/Dining |
 * Foyer), a full-width hallway spine, then a private rear wing (3 bedrooms + 2 baths).
 */
export const FLAT_3BHK: FlatSpec = [
  { name: 'Living Room', type: 'living', w: 520, l: 460, x: 260, z: 230 },
  { name: 'Kitchen', type: 'kitchen', w: 280, l: 230, x: 660, z: 115 },
  { name: 'Dining', type: 'dining', w: 280, l: 230, x: 660, z: 345 },
  { name: 'Foyer', type: 'foyer', w: 280, l: 460, x: 940, z: 230 },
  { name: 'Hallway', type: 'hallway', w: 1080, l: 120, x: 540, z: 520 },
  { name: 'Master Bedroom', type: 'bedroom', w: 430, l: 420, x: 215, z: 790 },
  { name: 'Bedroom 2', type: 'bedroom', w: 330, l: 420, x: 595, z: 790 },
  { name: 'Bedroom 3', type: 'bedroom', w: 320, l: 620, x: 920, z: 890 },
  { name: 'Master Bath', type: 'bathroom', w: 430, l: 200, x: 215, z: 1100 },
  { name: 'Common Bath', type: 'bathroom', w: 330, l: 200, x: 595, z: 1100 },
]

/**
 * Studio / 1RK (~350 sq ft carpet). Tiles a 500×450 cm rectangle: one live-in
 * room (bed + storage) down the left, a compact kitchen over a bathroom on the
 * right — the smallest honest "room + kitchen + bath" unit. Used for 1RK/studio
 * and any other room-kitchen ("*RK") listing.
 */
export const FLAT_STUDIO: FlatSpec = [
  { name: 'Studio Room', type: 'bedroom', w: 320, l: 450, x: 160, z: 225 },
  { name: 'Kitchen', type: 'kitchen', w: 180, l: 224, x: 410, z: 112 },
  { name: 'Bathroom', type: 'bathroom', w: 180, l: 226, x: 410, z: 337 },
]

// ---------------------------------------------------------------------------
// Listing → FlatSpec (the dynamic-scene unlock). A scraped listing carries a
// free-text `bhk` (e.g. "2BHK", "1RK", "3RK") that is often null, so we pick a
// furnished template from the bhk field, then the post text, then a gentle
// rent tier — never throwing, always returning a real, furnishable FlatSpec.

/** Structural subset of a scraped FlatListing needed to choose a template. */
export interface ListingSceneInput {
  bhk?: string | null
  rent?: number | null
  text?: string | null
}

type FlatKind = 'studio' | '1bhk' | '2bhk' | '3bhk'

const KIND_SPEC: Record<FlatKind, FlatSpec> = {
  studio: FLAT_STUDIO,
  '1bhk': FLAT_1BHK,
  '2bhk': FLAT_2BHK,
  '3bhk': FLAT_3BHK,
}

/** Map the (upper-cased, space-stripped) bhk field to a template kind, or null. */
function kindFromBhk(bhk: string): FlatKind | null {
  if (!bhk) return null
  // "*RK" (room-kitchen, no separate hall — 1RK/2RK/3RK/studio) → the studio unit.
  if (bhk.includes('RK') || bhk.includes('STUDIO')) return 'studio'
  if (bhk.startsWith('1')) return '1bhk'
  if (bhk.startsWith('2')) return '2bhk'
  if (/^[3-9]/.test(bhk)) return '3bhk' // 3BHK, 4BHK, … → the largest template we have
  return null
}

/** Best-effort read of the flat size from the post text when `bhk` is missing. */
function kindFromText(text: string): FlatKind | null {
  const t = text.toLowerCase()
  if (/\bstudio\b/.test(t) || /\d\s*rk\b/.test(t) || /room\s*kitchen/.test(t)) return 'studio'
  if (/\b[3-9]\s*bhk\b/.test(t) || /\b[3-9]\s*bed\s*room/.test(t)) return '3bhk'
  if (/\b2\s*bhk\b/.test(t) || /\b2\s*bed\s*room/.test(t)) return '2bhk'
  if (/\b1\s*bhk\b/.test(t) || /\b1\s*bed\s*room/.test(t)) return '1bhk'
  return null
}

/**
 * Choose a furnished flat template for a scraped listing (the dynamic-scene
 * fallback for the 32/36 listings with no hand-authored replica). Precedence:
 * explicit `bhk` field → keywords in the post text → a gentle rent tier →
 * default 1BHK. Pure + total (never throws); replica short-circuiting lives in
 * houseSession.loadDynamicListing, NOT here.
 */
export function buildSceneFromListing(listing: ListingSceneInput): FlatSpec {
  const bhk = (listing.bhk ?? '').toUpperCase().replace(/\s+/g, '')
  const kind =
    kindFromBhk(bhk) ??
    kindFromText(listing.text ?? '') ??
    rentTier(listing.rent ?? null)
  return KIND_SPEC[kind]
}

/** Weakest signal: infer size from monthly rent (Indian metro ranges). Defaults 1BHK. */
function rentTier(rent: number | null): FlatKind {
  if (rent == null) return '1bhk'
  if (rent >= 70000) return '3bhk'
  if (rent >= 45000) return '2bhk'
  return '1bhk'
}

// ---------------------------------------------------------------------------
// Inferred-finish overlay (Track B3). An OFFLINE classical-CV batch
// (scripts/infer-listing-scene.mjs) reads a listing's photos and emits a
// confidence-gated per-listing finish (FLOOR_TEXTURES id + wall hex) into
// src/data/inferredScenes.json; the loader (src/data/inferredScenes.ts) validates
// + gates it. `applyInferredFinish` overlays those finishes on a template room's
// defaults so a dynamic scene LOOKS like its listing photos — but ONLY for the
// rooms where it's a safe, meaningful win. It NEVER touches geometry (VLMs give
// labels, not dimensions) and NEVER runs for a hand-authored replica (that path
// short-circuits earlier). A listing with no photos / no inference / low
// confidence keeps the template defaults verbatim (metadata-only always renders).

/** A validated, confidence-gated finish for one listing (fields present only
 *  above the confidence threshold). Both are optional → graceful degradation. */
export interface InferredFinish {
  /** A FLOOR_TEXTURES id (validated against materials.ts by the loader). */
  floorTexture?: string
  /** A wall paint hex (#rrggbb). */
  wallColor?: string
}

// Rooms whose TEMPLATE floor is warm wood — exactly where an inferred tile/marble/
// concrete floor is the visible correction for a typical Indian flat. Wet rooms
// (kitchen/bath) keep their functional tile; foyer/hallway keep their marble/tile.
const FLOOR_OVERRIDE_TYPES = new Set<RoomType>(['living', 'bedroom', 'dining', 'office'])
// Dry rooms take the inferred wall paint; wet rooms/balcony keep their tint.
const WALL_OVERRIDE_TYPES = new Set<RoomType>(['living', 'bedroom', 'dining', 'office', 'foyer', 'hallway'])

/**
 * Overlay an inferred finish on a room's template defaults. Pure + total: returns
 * `base` unchanged when there's no finish, when the field is absent (low
 * confidence), or when the room type isn't eligible for that override.
 */
export function applyInferredFinish(
  type: RoomType,
  base: { wall: string; floor: string },
  finish?: InferredFinish | null,
): { wall: string; floor: string } {
  if (!finish) return base
  let { wall, floor } = base
  if (finish.floorTexture && FLOOR_OVERRIDE_TYPES.has(type)) floor = finish.floorTexture
  if (finish.wallColor && WALL_OVERRIDE_TYPES.has(type)) wall = finish.wallColor
  return { wall, floor }
}
