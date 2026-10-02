// Quality presets — high / medium / low. Pure functions (no R3F), unit-tested.
//
// INVARIANT (the whole point of the quality toggle, per the brief R8): "low" drops the
// GPU-heavy post passes (AO off, no multisampling, cheaper bloom) so low-end devices hold
// framerate — but the REALISM FOUNDATION (IBL + ACESFilmic tone mapping + PBR materials) is
// CHEAP and the biggest lever, so it NEVER drops across any tier. A "low" room is still
// photographic-ish (lit by IBL, filmic), just without the expensive contact AO + heavy bloom.
//
// IBL strength is a SINGLE dial: ibl.intensity drives scene.environmentIntensity (global).
// materials.envMapIntensity stays at 1.0 (per-material) so the two don't double-scale.
// Bloom is SELECTIVE by HDR luminance: luminanceThreshold ~1.0 means only emissive fixtures
// pushed >1 (the MaterialEnhancer boosts them) glow — never the whole lit room (no haze).

import type {
  RenderQuality,
  RenderSettings,
  PartialRenderSettings,
} from './types'

/** Tone mapping + IBL + material policy are shared across tiers (the cheap, high-impact base). */
const BASE = {
  version: '1.0' as const,
  // Neutral = Khronos PBR-Neutral: preserves finish HUE and only desaturates the highlight
  // roll-off, so warm wood/paint reads true and daylight windows stop washing to featureless
  // white (ACES desaturated midtones + crushed highlights, which the exposure knob then had to
  // over-compensate). Neutral lifts midtones less aggressively than ACES darkened them, so the
  // exposure comes DOWN from the old ACES-compensation value: ~1.1 puts a mid-grey wall near 0.5
  // and keeps the brightest daytime pane just under clip (co-tune value in shared/LEARNINGS.md).
  toneMapping: { mode: 'Neutral' as const, exposure: 1.1 },
  ibl: { source: 'procedural-room', intensity: 0.55 },
  materials: { defaultRoughness: 0.7, defaultMetalness: 0.0, envMapIntensity: 1.0 },
  heroRender: { enabled: false, samples: 256, bounces: 5 },
}

const PRESETS: Record<RenderQuality, RenderSettings> = {
  high: {
    ...BASE,
    quality: 'high',
    post: {
      bloom: { enabled: true, threshold: 1.0, strength: 0.85, radius: 0.65 },
      // radius is WORLD metres: keep it near true contact creases (~0.45 m) so flat, low-poly
      // furniture faces don't self-occlude into dark triangular patches. N8AO reconstructs normals
      // from depth (no normal pass), which misfires at hard box edges when the radius reaches across
      // them — a large 1.0 m radius turned that into visible dark shapes on sofas/armchairs.
      ao: { enabled: true, type: 'N8AO', intensity: 1.3, radius: 0.45 },
      multisampling: 4,
    },
  },
  medium: {
    ...BASE,
    quality: 'medium',
    post: {
      bloom: { enabled: true, threshold: 1.0, strength: 0.6, radius: 0.55 },
      // lighter AO: less intensity + smaller (contact-scale) radius + halfRes (set in the rig)
      ao: { enabled: true, type: 'N8AO', intensity: 1.0, radius: 0.4 },
      multisampling: 2,
    },
  },
  low: {
    ...BASE,
    quality: 'low',
    post: {
      // cheap bloom only on genuinely-bright emitters; AO off; no MSAA.
      bloom: { enabled: true, threshold: 1.0, strength: 0.5, radius: 0.5 },
      ao: { enabled: false, type: 'N8AO', intensity: 0.0, radius: 0.85 },
      multisampling: 0,
    },
  },
}

/** Return a fresh (deep-cloned) settings object for a quality tier. */
export function presetFor(quality: RenderQuality): RenderSettings {
  return structuredClone(PRESETS[quality])
}

/** The default render settings (== the 'high' preset). Used when a scene carries no RenderSettings. */
export const DEFAULT_RENDER_SETTINGS: RenderSettings = presetFor('high')

/**
 * Apply a forward-compatible partial override onto a base settings object (deep per sub-object).
 * Unknown/missing keys fall back to the base — so a serialized subset (or a future field a
 * consumer doesn't know) round-trips without clobbering. Pure; returns a new object.
 */
export function withOverrides(
  base: RenderSettings,
  partial: PartialRenderSettings | null | undefined,
): RenderSettings {
  if (!partial) return structuredClone(base)
  const out = structuredClone(base)
  for (const key of Object.keys(partial) as (keyof RenderSettings)[]) {
    const v = partial[key]
    if (v == null) continue
    const cur = out[key]
    if (typeof cur === 'object' && cur !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[key] = mergeDeep(cur, v) as never
    } else {
      out[key] = v as never
    }
  }
  return out
}

function mergeDeep<T>(a: T, b: Partial<T>): T {
  const out = { ...a }
  for (const k of Object.keys(b) as (keyof T)[]) {
    const bv = b[k]
    if (bv == null) continue
    const av = out[k]
    if (typeof av === 'object' && av !== null && typeof bv === 'object' && !Array.isArray(bv)) {
      out[k] = mergeDeep(av, bv as Partial<typeof av>) as never
    } else {
      out[k] = bv as never
    }
  }
  return out
}
