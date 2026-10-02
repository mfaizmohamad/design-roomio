import type { Unit } from './units'

export type ShapeId = 'rect' | 'l' | 't' | 'u' | 'cut' | 'beveled'

/** Floor-plane point in centimeters. x = right, z = depth (forward). */
export interface Vec2 {
  x: number
  z: number
}

export type OpeningKind = 'door' | 'window'
export type DoorStyle = 'single' | 'glass' | 'french' | 'double' | 'bifold' | 'glassDouble' | 'slider' | 'passage'
export type WindowStyle = 'windowSingle' | 'windowDouble' | 'windowGrille' | 'windowRail'
export type OpeningStyle = DoorStyle | WindowStyle

export interface Opening {
  id: string
  kind: OpeningKind
  style: OpeningStyle
  wallId: string
  /** center position along the wall, 0..1 */
  t: number
  width: number // cm
  height: number // cm
  sill: number // cm — bottom height above floor (0 for doors)
  /** optional frame/jamb tint (additive; defaults to the painted off-white) */
  frameColor?: string
  /** optional leaf/sash tint (additive; defaults to frameColor) */
  leafColor?: string
  /** render as a plain hole with no frame mesh — used for the far side of a
   *  shared-wall opening so two coincident frames don't z-fight (additive) */
  bare?: boolean
}

export type FurnitureCategory =
  | 'sofa'
  | 'bed'
  | 'table'
  | 'chair'
  | 'storage'
  | 'kitchen'
  | 'bathroom'
  | 'decor'
  | 'misc'

export interface FurnitureItem {
  id: string
  archetype: string // key into catalog
  category: FurnitureCategory
  name: string
  x: number // center, cm
  z: number // center, cm
  rotation: number // radians around Y (0 = facing +z)
  w: number // width (local x), cm
  d: number // depth (local z), cm
  h: number // height, cm
  color: string
  /** when true, the item is pinned and ignores drag/rotate gestures */
  locked?: boolean
  /** Immutable reviewed model version; absent items retain procedural rendering. */
  assetRef?: { assetVersionId: string }
}

export interface Materials {
  wallColor: string
  floorTexture: string // key into floor texture catalog
  /** optional wall cladding (a floor-texture catalog id, e.g. large-format
   *  marble tile on kitchen walls). Additive; plain paint when absent. */
  wallTexture?: string
}

/** Optional per-room ceiling treatment (additive; rooms without one get the
 *  default flat plaster ceiling in interior views). */
export interface CeilingSpec {
  /** plain plaster tint (default warm white) */
  color?: string
  /** plank/board cladding (a floor-texture catalog id, e.g. dark wood planks) */
  texture?: string
  /** single round recessed downlight at the ceiling centre (balcony look) */
  downlight?: boolean
}

/** Saved 3D camera viewpoint so reopening restores the exact same view. */
export interface CameraView {
  cam: [number, number, number]
  target: [number, number, number]
}

/**
 * Functional room type — drives the suggestion engine's necessity rules
 * (e.g. a bedroom should have a bed). Additive/optional: blank rooms default
 * to 'living' in the engine; persona presets set this explicitly.
 */
export type RoomType = 'living' | 'bedroom' | 'studio' | 'family' | 'office' | 'den'

export interface RoomDesign {
  id: string
  name: string
  unit: Unit
  shape: ShapeId
  corners: Vec2[] // ordered polygon (cm)
  wallHeight: number // cm
  wallThickness: number // cm
  openings: Opening[]
  materials: Materials
  furniture: FurnitureItem[]
  /** optional saved camera viewpoint (additive; old designs simply lack it) */
  view?: CameraView
  /** functional room type for the suggestion engine (additive; defaults to 'living') */
  roomType?: RoomType
  /** persona preset this room was started from (additive; enables genre-aware rules) */
  personaGenre?: string
  /** per-room ceiling treatment (additive; default plaster) */
  ceiling?: CeilingSpec
  /** when false, layoutHouse never auto-cuts doorways into this room — the
   *  design authors ALL its circulation explicitly (listing replicas). */
  autoDoorways?: boolean
  /** true for a listing-replica room — a faithful reproduction of a REAL flat,
   *  not a design-in-progress. The suggestion engine treats it as a curated real
   *  scene: it suppresses necessity flags & placement warnings (which would
   *  red-flag the replica as broken) and keeps only gentle polish tips. */
  isReplica?: boolean
  createdAt: number
  updatedAt: number
}

/** Derived (not stored) wall segment between two consecutive corners. */
export interface Wall {
  id: string
  index: number
  a: Vec2
  b: Vec2
  length: number // cm
  dirX: number // unit direction a->b
  dirZ: number
  nx: number // unit inward normal
  nz: number
  midX: number
  midZ: number
  angle: number // rotation about Y so a +z-facing plane aligns to the wall
}
