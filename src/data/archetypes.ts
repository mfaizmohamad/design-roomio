import type { FurnitureCategory } from '../types'
import rawCatalog from './archetypes.catalog.json'

// Furniture archetypes are built from parametric primitives (see three/Furniture3D.tsx)
// — clean topology, one editable color per piece, resizable within clamped bounds.
// This realizes the §6 "in-house parametric" path with zero external assets.
//
// The corpus itself lives in archetypes.catalog.json so it is one-file-extensible
// (add an entry → it shows up in the catalog and the detection contract). Every
// entry carries REAL-WORLD min/max dimensions (cm) as resize guardrails.

export type ModelKind =
  | 'sofa'
  | 'sectional'
  | 'bed'
  | 'table'
  | 'roundTable'
  | 'chair'
  | 'officeChair'
  | 'cabinet'
  | 'openShelf'
  | 'rug'
  | 'lamp'
  | 'plant'
  | 'box'
  // extended kinds
  | 'tv'
  | 'desk'
  | 'ottoman'
  | 'stool'
  | 'bench'
  | 'mirror'
  // kitchen / bathroom fixtures
  | 'counter'
  | 'toilet'
  | 'shower'
  | 'vanity'
  | 'bathtub'
  | 'tubFreestanding'
  | 'jacuzzi'
  | 'island'
  | 'stove'
  | 'fridge'
  | 'rangeHood'
  | 'washer'
  | 'fan'
  | 'curtain'
  | 'ladderShelf'
  | 'ac'
  // double-height / duplex pieces (Sky Duplex genre)
  | 'staircase'
  | 'staircaseU'
  | 'mezzanine'
  | 'chandelier'
  | 'jali'

/**
 * How a piece occupies space vertically:
 *  - 'floor'   default — sits on the floor and takes part in footprint collision.
 *  - 'wall'    hangs on a wall (TV, mirror, floating shelf): rendered at a wall
 *              height (or resting on a console below it), and EXEMPT from
 *              footprint collision so it can sit above floor furniture.
 *  - 'surface' sits on top of another piece (table lamp): elevated onto the
 *              surface beneath it and exempt from footprint collision.
 */
export type Mount = 'floor' | 'wall' | 'surface'

export interface Archetype {
  id: string
  category: FurnitureCategory
  name: string
  icon: string
  model: ModelKind
  w: number // cm (local x)
  d: number // cm (local z)
  h: number // cm
  min: [number, number, number]
  max: [number, number, number]
  color: string
  lockH?: boolean // height not resizable (rugs)
  mount: Mount
}

interface RawArchetype {
  id: string
  category: string
  name: string
  icon: string
  model: string
  w: number
  d: number
  h: number
  min: [number, number, number]
  max: [number, number, number]
  color: string
  lockH?: boolean
  mount?: string
}

const MODEL_KINDS: ModelKind[] = [
  'sofa', 'sectional', 'bed', 'table', 'roundTable', 'chair', 'officeChair',
  'cabinet', 'openShelf', 'rug', 'lamp', 'plant', 'box',
  'tv', 'desk', 'ottoman', 'stool', 'bench', 'mirror',
  'counter', 'toilet', 'shower', 'vanity', 'bathtub', 'tubFreestanding',
  'jacuzzi', 'island', 'stove', 'fridge', 'rangeHood', 'washer', 'fan',
  'curtain', 'ladderShelf', 'ac', 'staircase', 'staircaseU', 'mezzanine', 'chandelier', 'jali',
]
const CATEGORIES: FurnitureCategory[] = ['sofa', 'bed', 'table', 'chair', 'storage', 'kitchen', 'bathroom', 'decor', 'misc']
const MOUNTS: Mount[] = ['floor', 'wall', 'surface']

/** Validate + normalize a raw catalog entry into a typed Archetype (defensive). */
function normalize(r: RawArchetype): Archetype {
  const model = (MODEL_KINDS as string[]).includes(r.model) ? (r.model as ModelKind) : 'box'
  const category = (CATEGORIES as string[]).includes(r.category) ? (r.category as FurnitureCategory) : 'misc'
  // guarantee min <= default <= max on every axis
  const clampAxis = (def: number, lo: number, hi: number): [number, number, number] => {
    const mn = Math.min(lo, def)
    const mx = Math.max(hi, def)
    return [mn, def, mx]
  }
  const [minW, , maxW] = clampAxis(r.w, r.min[0], r.max[0])
  const [minD, , maxD] = clampAxis(r.d, r.min[1], r.max[1])
  const [minH, , maxH] = clampAxis(r.h, r.min[2], r.max[2])
  return {
    id: r.id,
    category,
    name: r.name,
    icon: r.icon,
    model,
    w: r.w,
    d: r.d,
    h: r.h,
    min: [minW, minD, minH],
    max: [maxW, maxD, maxH],
    color: r.color,
    ...(r.lockH ? { lockH: true } : {}),
    mount: (MOUNTS as string[]).includes(r.mount ?? '') ? (r.mount as Mount) : 'floor',
  }
}

export const ARCHETYPES: Archetype[] = (rawCatalog as RawArchetype[]).map(normalize)

export const ARCHETYPE_MAP: Record<string, Archetype> = Object.fromEntries(
  ARCHETYPES.map((a) => [a.id, a]),
)

/** Mount class for an archetype id ('floor' for unknown ids). */
export function mountOf(id: string): Mount {
  return ARCHETYPE_MAP[id]?.mount ?? 'floor'
}

/** True for pieces that hang on a wall or sit on a surface (exempt from footprint collision). */
export function isMounted(id: string): boolean {
  return mountOf(id) !== 'floor'
}

/**
 * cm — floor pieces at or below this height are flat floor COVERINGS (rugs,
 * carpets, mats) you physically step onto, not obstacles you walk into. The
 * catalog has a wide gap here — rugs are 1.5 cm, the next-lowest furniture is
 * 20 cm — so this threshold separates coverings from real furniture cleanly
 * while still catching any future flat mat added to the catalog.
 */
export const WALKABLE_FLOOR_MAX_H = 10

/**
 * True for a flat floor covering (rug / carpet / mat) that a first-person
 * walker should pass OVER rather than collide with. Keyed on the live item
 * height when supplied (a resized piece is judged by its actual height), with
 * the archetype's `rug` model as a definitive fallback so a mis-sized rug is
 * still treated as walkable. Wall/surface-mounted pieces are never coverings.
 */
export function isWalkableFloor(id: string, h?: number): boolean {
  const a = ARCHETYPE_MAP[id]
  if (a && a.mount !== 'floor') return false
  if (a?.model === 'rug') return true
  const height = h ?? a?.h
  return typeof height === 'number' && height <= WALKABLE_FLOOR_MAX_H
}

/**
 * Furniture categories in display order. `icon` + `tint` drive the big, image-like
 * category tiles in the Furnish catalogue (identifying imagery + a soft per-category
 * wash), so users pick a topic visually instead of scrolling every piece.
 */
export const CATEGORY_ORDER: { id: FurnitureCategory; label: string; icon: string; tint: string }[] = [
  { id: 'sofa', label: 'Sofas', icon: '🛋️', tint: '#e9edf2' },
  { id: 'bed', label: 'Beds', icon: '🛏️', tint: '#f1ece3' },
  { id: 'table', label: 'Tables', icon: '🍽️', tint: '#efe9df' },
  { id: 'chair', label: 'Chairs', icon: '🪑', tint: '#e9eee9' },
  { id: 'storage', label: 'Storage', icon: '🗄️', tint: '#edeae2' },
  { id: 'kitchen', label: 'Kitchen', icon: '🍳', tint: '#f0ebe3' },
  { id: 'bathroom', label: 'Bathroom', icon: '🛁', tint: '#e7edf1' },
  { id: 'decor', label: 'Decor', icon: '🪴', tint: '#e9efe8' },
  { id: 'misc', label: 'Other', icon: '📦', tint: '#efece6' },
]
