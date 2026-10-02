import type { RoomDesign, FurnitureItem, Vec2, RoomType, ShapeId } from '../types'
import { ARCHETYPE_MAP } from './archetypes'
import { DEFAULT_WALL_COLOR, DEFAULT_FLOOR, FLOOR_MAP } from './materials'
import rawPersonas from './personas.json'
import { DEG2RAD } from '../../shared/lib/math'
import { defaultOpenings } from './defaultOpenings'

// ───────────────────────────────────────────────────────────────────────────
// Persona room presets — the "Start from a style that's you" entry point.
//
// Each preset is assembled from elements that RECUR across real Pinterest pins
// for its aesthetic (see pinterest_sources for provenance). Presets are loaded
// into the editor as a normal, fully-editable RoomDesign — a head start, not a
// lock-in. They use only ids from the existing archetype corpus; genre items we
// don't model yet are flagged in `asset_requests` (logged to roomio.txt).
// ───────────────────────────────────────────────────────────────────────────

export type PersonaType = 'life_stage' | 'interest' | 'aesthetic'

interface RawPlacedItem {
  archetype_id: string
  x: number
  z: number
  rot_deg: number
  color?: string
  w?: number
  d?: number
  h?: number
}

export interface PersonaPreset {
  genre_id: string
  display_name: string
  persona_type: PersonaType
  emoji: string
  blurb: string
  style_note: string
  room: { shape: ShapeId; width_cm: number; length_cm: number }
  room_type: RoomType
  materials: { wall_color: string; floor: string }
  placed_items: RawPlacedItem[]
  pinterest_sources: string[]
  asset_requests: string[]
}

export const PERSONAS: PersonaPreset[] = rawPersonas as PersonaPreset[]

export const PERSONA_MAP: Record<string, PersonaPreset> = Object.fromEntries(
  PERSONAS.map((p) => [p.genre_id, p]),
)

function uid(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
  } catch {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
  }
}

/** Rectangular footprint from width × length, origin at (0,0). */
function rectCorners(width: number, length: number): Vec2[] {
  return [
    { x: 0, z: 0 },
    { x: width, z: 0 },
    { x: width, z: length },
    { x: 0, z: length },
  ]
}

/** Resolve one placed item into a real FurnitureItem, clamping to corpus bounds. */
function toFurnitureItem(raw: RawPlacedItem): FurnitureItem | null {
  const a = ARCHETYPE_MAP[raw.archetype_id]
  if (!a) return null
  const clamp = (v: number | undefined, def: number, lo: number, hi: number) =>
    v == null ? def : Math.max(lo, Math.min(hi, v))
  return {
    id: uid('f'),
    archetype: a.id,
    category: a.category,
    name: a.name,
    x: raw.x,
    z: raw.z,
    rotation: (raw.rot_deg ?? 0) * DEG2RAD,
    w: clamp(raw.w, a.w, a.min[0], a.max[0]),
    d: clamp(raw.d, a.d, a.min[1], a.max[1]),
    h: clamp(raw.h, a.h, a.min[2], a.max[2]),
    color: raw.color ?? a.color,
  }
}

/** Build a fresh, fully-editable RoomDesign from a persona preset. */
export function toRoomDesign(preset: PersonaPreset): RoomDesign {
  const now = Date.now()
  const wall = preset.materials.wall_color || DEFAULT_WALL_COLOR
  const floor = FLOOR_MAP[preset.materials.floor] ? preset.materials.floor : DEFAULT_FLOOR
  const furniture = preset.placed_items
    .map(toFurnitureItem)
    .filter((f): f is FurnitureItem => f !== null)
  const corners = rectCorners(preset.room.width_cm, preset.room.length_cm)
  return {
    id: uid('room'),
    name: preset.display_name,
    unit: 'ft',
    shape: preset.room.shape ?? 'rect',
    corners,
    wallHeight: 270,
    wallThickness: 12,
    // Every genre ships with a default door + window(s) instead of a sealed box.
    openings: defaultOpenings(corners),
    materials: { wallColor: wall, floorTexture: floor },
    furniture,
    roomType: preset.room_type,
    personaGenre: preset.genre_id,
    createdAt: now,
    updatedAt: now,
  }
}
