// Render-settings types — the TS mirror of shared/render_schema.json (v1.0).
// Owned by Agent G. Pure data; no Three.js / R3F imports so this is testable standalone
// and importable by any consumer (the app, the harness, persistence later).

export type RenderQuality = 'high' | 'medium' | 'low'
// 'Neutral' = Khronos PBR-Neutral: preserves finish hue and desaturates only the highlight
// roll-off (best for "show the real paint/floor" listings). 'AgX' is a gentler filmic than ACES.
// (Schema mirror shared/render_schema.json lags by one value — 'Neutral' is an additive,
// forward-compatible addition; consumers ignore unknown fields per the render contract.)
export type ToneMappingMode = 'ACESFilmic' | 'AgX' | 'Neutral' | 'Reinhard' | 'None'
export type AOType = 'N8AO' | 'SSAO' | 'GTAO'

export interface ToneMappingSettings {
  mode: ToneMappingMode
  /** Exposure / middle-grey scale applied before the filmic curve — G's compensation knob
   *  so E's legacy-unit light intensities still read correctly under ACESFilmic. */
  exposure: number
}

export interface IBLSettings {
  /** 'procedural-room' = synthetic interior env built in-engine (no CDN/file). Or a '*.hdr' path. */
  source: string
  /** scene.environmentIntensity + per-material envMapIntensity baseline. Kept modest (E already fills). */
  intensity: number
}

export interface MaterialSettings {
  defaultRoughness: number
  defaultMetalness: number
  envMapIntensity: number
}

export interface BloomSettings {
  enabled: boolean
  /** luminanceThreshold — only pixels brighter than this glow (keeps the lit room from hazing). */
  threshold: number
  strength: number
  radius: number
}

export interface AOSettings {
  enabled: boolean
  type: AOType
  intensity: number
  /** sampling radius (scene-scale dependent, ~meters). */
  radius: number
}

export interface PostSettings {
  bloom: BloomSettings
  ao: AOSettings
  /** MSAA samples for the composer (0 disables). */
  multisampling: number
}

export interface HeroRenderSettings {
  enabled: boolean
  samples: number
  bounces: number
}

export interface RenderSettings {
  version: '1.0'
  quality: RenderQuality
  toneMapping: ToneMappingSettings
  ibl: IBLSettings
  materials: MaterialSettings
  post: PostSettings
  heroRender: HeroRenderSettings
}

/** Deep-partial for forward-compatible overrides (a saved/serialized subset). */
export type PartialRenderSettings = {
  [K in keyof RenderSettings]?: RenderSettings[K] extends object
    ? Partial<RenderSettings[K]>
    : RenderSettings[K]
}
