/**
 * Agent H — de-light (T2b / brief §4b).
 *
 * A photo has the room's lighting baked in (bright spots, shadow gradients). Used as an
 * albedo map that DOUBLE-lights under Agent E's lights + Agent G's IBL. We neutralize the
 * LARGE-SCALE illumination so the result is true (flat) base color, letting the scene's
 * lights do the lighting.
 *
 * Homomorphic flatten: estimate the low-frequency illumination L (a heavy blur of
 * luminance), and a per-pixel gain m/L pulls every region toward the patch's mean
 * brightness — flattening shadows/highlights while PRESERVING high-frequency texture
 * (weave/grain). Gain is clamped so near-black regions don't explode.
 *
 * Two correctness refinements (adversarial-review confirmed):
 *  - The gain is applied as an ADDITIVE LUMA delta (the same delta added to R,G,B), not a
 *    per-channel multiply, so chroma (hue/saturation) is preserved even when a channel
 *    clips at 255 — no warm→yellow cast on saturated upholstery/wood in de-shadowed areas.
 *  - A global scale `s` rescales the result so overall MEAN TONE is preserved (the raw
 *    per-pixel gain is non-mean-preserving and darkened contrasty photos ~3–10%).
 */
import { type RGBAImage, cloneImage, toLuminance, boxBlurFloat, mean, type EdgeMode } from './image'

export interface DelightOptions {
  /** illumination blur radius in px; default ~ min(w,h)/4 (large-scale only). */
  radius?: number
  /** clamp the correction gain so we flatten lighting without blowing up dark pixels. */
  minGain?: number
  maxGain?: number
  /** 'wrap' if the input already tiles (recommended — run AFTER makeSeamless). */
  edge?: EdgeMode
  /** 0..1 how strongly to flatten (1 = full); default 1. */
  strength?: number
}

/** Returns a de-lit copy (true albedo). Chroma preserved; overall mean tone preserved. */
export function delight(img: RGBAImage, opts: DelightOptions = {}): RGBAImage {
  const { width: w, height: h } = img
  const radius = opts.radius ?? Math.max(4, Math.round(Math.min(w, h) / 4))
  const minGain = opts.minGain ?? 0.5
  const maxGain = opts.maxGain ?? 2.0
  const edge: EdgeMode = opts.edge ?? 'wrap'
  const strength = opts.strength ?? 1

  const lum = toLuminance(img) // per-pixel luminance
  const illum = boxBlurFloat(lum, w, h, radius, edge)
  const m = mean(illum) || 1
  const srcMean = mean(lum)

  // pass 1: target (flattened) luminance per pixel + its mean
  const targetL = new Float32Array(lum.length)
  for (let p = 0; p < lum.length; p++) {
    const L = illum[p] < 1 ? 1 : illum[p]
    let gain = m / L
    gain = gain < minGain ? minGain : gain > maxGain ? maxGain : gain
    gain = 1 + (gain - 1) * strength // ease: 1 = full correction, 0 = identity
    targetL[p] = lum[p] * gain
  }
  const meanTarget = mean(targetL)
  // global tone scale so overall mean luminance is preserved
  const s = meanTarget > 1e-4 ? srcMean / meanTarget : 1

  // pass 2: apply as an ADDITIVE luma delta (preserves chroma; black stays black) scaled by
  // s (preserves mean). luma is linear, so adding `delta` to R,G,B raises luma by exactly delta.
  const out = cloneImage(img)
  const d = out.data
  for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
    const desiredL = targetL[p] * s
    const delta = desiredL - lum[p]
    d[i] = d[i] + delta
    d[i + 1] = d[i + 1] + delta
    d[i + 2] = d[i + 2] + delta
    // alpha unchanged
  }
  return out
}

/** Diagnostic: spread of the low-frequency illumination (max-min of blurred luminance). */
export function illuminationSpread(img: RGBAImage, radius?: number, edge: EdgeMode = 'wrap'): number {
  const { width: w, height: h } = img
  const r = radius ?? Math.max(4, Math.round(Math.min(w, h) / 4))
  const illum = boxBlurFloat(toLuminance(img), w, h, r, edge)
  let lo = Infinity
  let hi = -Infinity
  for (const v of illum) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return hi - lo
}
