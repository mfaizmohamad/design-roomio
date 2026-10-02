// Lighting domain types (Agent E). Mirrors shared/lighting_schema.json (v1.0).
// World units are METERS (matches src/three/coords.ts). Intensities are renderer-tuned
// (R3F <Canvas flat> => legacy/non-physical light units), NOT physical watts.

export type LightLayer = 'ambient' | 'task' | 'accent'

export type LightType =
  | 'hemisphere'
  | 'ambient'
  | 'ceiling'
  | 'pendant'
  | 'desk'
  | 'floor'
  | 'sconce'
  | 'wall_wash'
  | 'strip'
  | 'spot'
  | 'point'

export type Warmth = 'warm' | 'neutral' | 'cool'

export interface Light {
  id: string
  type: LightType
  layer: LightLayer
  /** hex '#rrggbb' the light emits (already warmth-tinted). */
  color: string
  /** optional color temperature in Kelvin; when present, color is derived from it. */
  colorTempK?: number
  /** convenience preset for the warm/cool UI toggle. */
  warmth?: Warmth
  /** renderer-tuned intensity (see LEARNINGS.md), NOT physical watts. */
  intensity: number
  castShadow?: boolean
  /** auto-added default (so UI can label / reset). */
  isDefault?: boolean
  /** soft on/off without deleting. */
  enabled?: boolean
  /** world-meter position [x,y,z]. Ignored for ambient/hemisphere. */
  pos?: [number, number, number]
  /** world-meter aim point for spot/wall_wash. */
  target?: [number, number, number]
  /** HemisphereLight ground tint. */
  groundColor?: string
  /** optional visible fixture mesh to render (pendant/floor-lamp/sconce). */
  fixtureModel?: string
}

export interface RoomLighting {
  lights: Light[]
}

export interface SunState {
  enabled: boolean
  maxElevationDeg: number
  warmthShift: boolean
  intensityScale: number
  domeRadiusM: number
}

export interface ShadowState {
  mapSize: number
  bias: number
  normalBias: number
  /**
   * PCSS (percentage-closer soft-shadow) penumbra config for the single sun caster.
   * The renderer runs PCFSoftShadowMap, whose directional-light branch IGNORES
   * `light.shadow.radius` — so real softening comes from a contact-hardening PCSS
   * shader (drei <SoftShadows>), driven by these knobs. The penumbra widens with
   * blocker→receiver distance, so wall/floor contacts stay grounded while thin decor
   * (fan blades, high above the floor) casts a soft, faint shadow instead of a hard
   * one. `size` = max penumbra filter width, `samples` = Vogel-disk taps (quality vs
   * cost), `focus` = blocker-search seed. Undefined → shadows stay hard (no patch).
   */
  soft?: { size: number; samples: number; focus: number }
  /** orthographic frustum half-extent (m); auto-derived from house bounds when undefined. */
  halfExtentM?: number
  type: 'PCFSoft' | 'PCF' | 'VSM' | 'Basic'
}

export interface LightingState {
  version: '1.0'
  /** 0..1 across the day. 0=dawn, 0.5=noon, 1=dusk. */
  timeOfDay: number
  /** north indicator rotation (deg), added to sun azimuth; +180 = reversed. */
  northOffsetDeg: number
  barVisible: boolean
  northVisible: boolean
  /**
   * "Light Mode" — a presentation/lighting focus mode. When true, furniture is locked
   * (no accidental drag/rotate/resize) and the editing hints are hidden, so the user can
   * play with light without disturbing the layout. When false, furniture is in its default
   * (editable) state. A single global flag; furniture's own `locked` flags are never mutated.
   */
  lightMode: boolean
  sun: SunState
  shadow: ShadowState
  rooms: Record<string, RoomLighting>
}

export const DEFAULT_SUN: SunState = {
  enabled: true,
  maxElevationDeg: 60,
  warmthShift: true,
  intensityScale: 1.0,
  domeRadiusM: 30,
}

export const DEFAULT_SHADOW: ShadowState = {
  mapSize: 2048,
  bias: -0.0004,
  normalBias: 0.02,
  // Soft penumbra via PCSS (see `soft` above): a single 2048 sun shadow stretched
  // over a whole house is low-texel-density and reads harsh/aliased at raster, and
  // thin fan blades cast crisp floor shadows. Contact-hardening PCSS softens the
  // edge with distance while keeping wall/floor contacts grounded.
  soft: { size: 26, samples: 16, focus: 0 },
  type: 'PCFSoft',
}

/** A pleasant early-afternoon default so rooms look good immediately. */
export function makeDefaultLightingState(): LightingState {
  return {
    version: '1.0',
    timeOfDay: 0.55,
    northOffsetDeg: 0,
    barVisible: false,
    northVisible: false,
    lightMode: false,
    sun: { ...DEFAULT_SUN },
    shadow: { ...DEFAULT_SHADOW },
    rooms: {},
  }
}
