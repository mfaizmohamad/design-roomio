/**
 * Read-only structural MIRRORS of the slices the save envelope composes.
 *
 * The envelope is the union of three agents' models:
 *   - house    → Agent C  (multi-room/src/types.ts `House`, which embeds A's RoomDesign)
 *   - lighting → Agent E  (shared/lighting_schema.json `LightingState`)
 *   - (interiors live INSIDE house.rooms[].interior — Agent A's RoomDesign, verbatim)
 *
 * Following the team's zero-build-coupling convention (B/C/E each mirror one
 * another's types read-only rather than importing across packages), these are
 * structural copies — enough to migrate, round-trip, and drive exports. The
 * SOURCES OF TRUTH remain:
 *   - RoomDesign   → src/types.ts                 (Agent A)
 *   - House        → multi-room/src/types.ts      (Agent C)
 *   - LightingState→ shared/lighting_schema.json  (Agent E)
 *
 * The envelope treats `lighting` as an OPAQUE pass-through object: persistence
 * stores whatever E hands it and returns it byte-for-byte (E confirms its slice
 * round-trips). We only structurally type the parts exports actually read
 * (house geometry + furniture for floor-plan / shopping-list).
 */

// ── Interior (Agent A's RoomDesign — the fields persistence + exports rely on) ──

export interface Vec2 {
  x: number
  z: number
}

export interface Opening {
  id: string
  kind: 'door' | 'window'
  style: string
  wallId: string
  t: number
  width: number
  height: number
  sill: number
}

export interface FurnitureItem {
  id: string
  archetype: string
  category: string
  name: string
  x: number
  z: number
  rotation: number
  w: number
  d: number
  h: number
  color: string
  locked?: boolean
}

export interface RoomDesign {
  id: string
  name: string
  unit: string
  shape: string
  corners: Vec2[]
  wallHeight: number
  wallThickness: number
  openings: Opening[]
  materials: { wallColor: string; floorTexture: string }
  furniture: FurnitureItem[]
  view?: { cam: [number, number, number]; target: [number, number, number] }
  roomType?: string
  personaGenre?: string
  createdAt: number
  updatedAt: number
  // additive fields tolerated (forward-compat)
  [k: string]: unknown
}

// ── House (Agent C — wraps each room's interior) ──

export interface Footprint {
  shape: 'rectangular' | 'polygon'
  x: number
  z: number
  rotation: number
  w: number
  l: number
}

export type HouseRoomType =
  | 'bedroom'
  | 'living'
  | 'kitchen'
  | 'bathroom'
  | 'dining'
  | 'office'
  | 'foyer'
  | 'hallway'

export interface HouseRoom {
  room_id: string
  type: HouseRoomType
  footprint: Footprint
  interior: RoomDesign
  [k: string]: unknown
}

export interface Connector {
  connector_id: string
  type: string
  between: [string, string]
  shared_wall: { room_a_wall: number; room_b_wall: number }
  position_along_wall: number
  width_cm: number
  swing: { into_room: string; hinge: 'left' | 'right' } | null
  [k: string]: unknown
}

export const HOUSE_SCHEMA_VERSION = '1.0' as const

export interface House {
  schema_version: typeof HOUSE_SCHEMA_VERSION
  house_id: string
  name: string
  rooms: HouseRoom[]
  connectors: Connector[]
  createdAt: number
  updatedAt: number
  [k: string]: unknown
}

// ── Lighting (Agent E — opaque pass-through; we don't reinterpret it) ──

export type LightingStateLike = {
  version?: string
  rooms?: Record<string, unknown>
  [k: string]: unknown
}
