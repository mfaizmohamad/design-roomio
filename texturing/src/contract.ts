/**
 * Agent H — Photo-Texture Mapping contract (TS mirror of shared/texture_schema.json
 * and shared/pbr_conventions.json).
 *
 * This is the single source of truth for the SHAPES Agent H produces and consumes.
 * It is a PUBLISHED API: H will not change its shape without announcing in roomio.txt
 * and waiting for acks from A (FurnitureItem owner), C (persistence), G (rendering).
 *
 * Pipeline (three decoupled stages):
 *   T1 detect+crop  — locate object + category via Agent B; crop a clean surface patch.
 *   T2 texture-ify  — seamless tile + DE-LIGHT + derive albedo/roughness/normal (PBR maps).
 *   T3 apply        — assign maps to the target archetype's material SLOT with world-space
 *                     tiling + user scale/rotation; preview → accept → revert.
 *
 * Storage rule: image BYTES are NEVER embedded in a design. The design stores REFERENCES
 * (content-hash asset ids); bytes live in a content-addressed asset store (local-first,
 * behind Agent C's StorageAdapter shape).  See shared/texture_schema.json.
 */

/** Reference to image bytes stored OUT-OF-BAND in the content-addressed asset store
 *  (key = `roomio.asset.<sha256>`). Never the bytes themselves. */
export type AssetRef = string // `sha256:<64 hex>`

export const ASSET_REF_RE = /^sha256:[0-9a-f]{64}$/

export type ColorSpace = 'srgb' | 'linear'

/**
 * Which material ROLE on the target archetype receives the texture.
 * Roomio's parametric builders (src/three/Furniture3D.tsx) compose primitive meshes
 * with NO named slots today; this taxonomy is defined by Agent H.
 *  - 'body'    : the PRIMARY surface that uses the raw item color
 *                (sofa fabric body, table/desk top, cabinet body, chair seat, bed duvet).
 *  - others    : opt-in once meshes are tagged (see roomio.txt REQUEST -> AGENT-A).
 */
export type Slot = 'body' | 'cushion' | 'surface' | 'wood' | 'metal' | 'glass' | 'accent'

export const SLOTS: readonly Slot[] = ['body', 'cushion', 'surface', 'wood', 'metal', 'glass', 'accent']

/** The three derived PBR maps. albedo is sRGB (de-lit base color); roughness + normal are
 *  LINEAR data maps. metalness optional (omit for dielectric fabric/wood). */
export interface PbrMapRefs {
  albedo: AssetRef
  roughness: AssetRef
  normal: AssetRef
  metalness?: AssetRef
}

/**
 * World-space tiling controls.
 * `repeat_cm` = how many real-world centimeters ONE tile spans. Mirrors the floor's
 * areaCm contract (src/three/textures.ts): at apply time `texture.repeat` is derived
 * per-mesh as `worldDimCm / repeat_cm`, so pattern density is physically consistent
 * across differently-sized meshes (a 210 cm sofa vs a 50 cm side table).
 */
export interface Tiling {
  repeat_cm: number
  rotation_deg: number
}

export const DEFAULT_TILING: Tiling = { repeat_cm: 40, rotation_deg: 0 }

export const DEFAULT_COLOR_SPACE: { albedo: ColorSpace; roughness: ColorSpace; normal: ColorSpace } = {
  albedo: 'srgb',
  roughness: 'linear',
  normal: 'linear',
}

/** Quality / UV status reported by the pipeline. */
export type TextureStatus = 'ok' | 'needs_uv' | 'low_quality'

/** T1 input: a detect+crop job. bbox + source_photo come from Agent B's detection result. */
export interface TextureJob {
  /** AssetRef to the original uploaded photo (optional; may be transient). */
  source_photo?: AssetRef
  /** From Agent B: pixel [x, y, w, h] in the detection result's image.width/height (downscaled) space. */
  bbox?: [number, number, number, number]
  /** A real catalog id from shared/archetypes.json (e.g. 'sofa-3'). NOT the brief's 'sofa_3_seater'. */
  target_archetype_id: string
  target_slot?: Slot
}

/**
 * The PERSISTED slice — this is the ADDITIVE optional `texture` field on Agent A's
 * FurnitureItem (src/types.ts). Round-trips verbatim through Agent C's persistence.
 * Small by construction — references only, never bytes.
 */
export interface AppliedTexture {
  asset_id: AssetRef
  slot: Slot
  maps: PbrMapRefs
  tiling: Tiling
  color_space?: { albedo: ColorSpace; roughness: ColorSpace; normal: ColorSpace }
  source?: { kind: 'photo' | 'procedural'; archetype_id?: string; detected_at?: number }
  status?: TextureStatus
}

/**
 * The ADDITIVE field Agent H proposes on Agent A's FurnitureItem (read-only mirror; A owns the type).
 *   interface FurnitureItem { ...; texture?: AppliedTexture }
 * Mirrors A's existing additive-optional convention (`locked?`, `view?`, `roomType?`).
 */
export interface FurnitureItemTextureExt {
  texture?: AppliedTexture
}

/**
 * Published PBR map authoring conventions (mirror of shared/pbr_conventions.json).
 * Chosen to be correct under the CURRENT renderer (<Canvas shadows flat> => NoToneMapping)
 * AND forward-compatible with Agent G's planned ACESFilmic + sRGB output + HDR IBL stack —
 * so maps authored now need NO recolor when G lands.
 */
export const PBR_CONVENTIONS = {
  three_version: '^0.169.0',
  colorApi: 'modern: THREE.SRGBColorSpace / texture.colorSpace (NOT legacy sRGBEncoding/.encoding)',
  colorSpace: {
    albedo: 'srgb',
    roughness: 'linear',
    normal: 'linear',
    metalness: 'linear',
  },
  normal: {
    type: 'TangentSpaceNormalMap (three default)',
    orientation: '+Y (OpenGL / Y-up green channel)',
    normalScaleDefault: [1, 1] as [number, number],
    // green channel is authored in image space → upload via CanvasTexture/ImageData (flipY=true,
    // same as albedo). If a DataTexture path is used (flipY defaults false), set flipY=true or
    // negate green, else relief inverts.
    uploadFlipY: true,
  },
  roughnessBands: {
    fabric: [0.8, 0.95] as [number, number],
    wood: [0.4, 0.6] as [number, number],
    metal: [0.2, 0.5] as [number, number],
  },
  metalness: 'fabric/wood => material.metalness = 0, no metalnessMap; only emit a map for metallic surfaces',
  tiling: { wrap: 'RepeatWrapping on ALL maps', anisotropy: 8, density: 'world-space: repeat = worldDimCm / repeat_cm' },
  delight: 'albedo MUST be de-lit; baked highlights/shadows double-light under IBL + scene lights',
  ownership: {
    H: 'per-material maps + each map colorSpace/wrap/repeat/anisotropy/channel',
    E_and_G: 'renderer.toneMapping, renderer.outputColorSpace, scene.environment (IBL), bloom/SSAO, shadow config',
  },
} as const

/** True if `s` is a valid content-addressed asset reference. */
export function isAssetRef(s: unknown): s is AssetRef {
  return typeof s === 'string' && ASSET_REF_RE.test(s)
}
