/**
 * Agent H — the T1→T2 orchestrator: a user's photo (+ Agent B's bbox) → the three derived,
 * seamless, de-lit PBR map images. Pure (operates on RGBAImage), so it is node-testable end
 * to end; the browser wraps the result in CanvasTextures (createTexture.ts).
 */
import { type RGBAImage } from './image'
import { extractSurfacePatch } from './crop'
import { makeSeamless } from './tile'
import { delight, type DelightOptions } from './delight'
import { derivePbr, type SurfaceKind } from './pbr'

export interface ComposeOptions {
  /** Agent B's pixel bbox [x,y,w,h] in the result's (downscaled) image space. */
  bbox: [number, number, number, number]
  /** the detection result's image.width/height (the downscaled space the bbox lives in). */
  resultW: number
  resultH: number
  /** target square patch size in px (default ~60% of the object's smaller side). */
  patchPx?: number
  /** seamless-tile feather (px). */
  feather?: number
  /** force a surface kind for the roughness band; default auto-infer. */
  kind?: SurfaceKind
  /** normal relief strength. */
  normalStrength?: number
  /** de-light tuning (edge is forced to 'wrap' since the patch is already seamless). */
  delight?: Omit<DelightOptions, 'edge'>
}

export interface ComposedTexture {
  /** de-lit, seamless base color (sRGB at the three boundary). */
  albedo: RGBAImage
  /** linear grayscale roughness. */
  roughness: RGBAImage
  /** linear +Y tangent-space normal. */
  normal: RGBAImage
  /** inferred/forced surface kind (drives the roughness band). */
  kind: 'fabric' | 'wood' | 'metal'
  /** the raw clean crop before seamless/de-light (useful for a preview thumbnail). */
  crop: RGBAImage
}

/** Run T1 (detect+crop via B's bbox) → T2 (seamless → de-light → derive albedo/roughness/normal). */
export function composeTexture(original: RGBAImage, opts: ComposeOptions): ComposedTexture {
  const { patch } = extractSurfacePatch(original, opts.bbox, opts.resultW, opts.resultH, opts.patchPx)
  const seamless = makeSeamless(patch, opts.feather)
  const albedo = delight(seamless, { ...opts.delight, edge: 'wrap' })
  const maps = derivePbr(albedo, { kind: opts.kind, normalStrength: opts.normalStrength, edge: 'wrap' })
  return { albedo: maps.albedo, roughness: maps.roughness, normal: maps.normal, kind: maps.kind, crop: patch }
}
