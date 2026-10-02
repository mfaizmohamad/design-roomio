/**
 * Agent H — detect+crop (T1 / brief §3). REUSES Agent B's detection output; does NOT
 * re-detect. Given B's bbox (pixel [x,y,w,h] in the result's DOWNSCALED image space) and
 * the user's ORIGINAL full-res photo, produce a clean, flat-ish surface patch.
 *
 *  1. normalizeBbox: bbox / result image dims → fractions (B's bbox is in downscaled space).
 *  2. bboxToPixels: fractions × original natural dims → an integer rect, clamped.
 *  3. selectCleanPatch: slide a window inside the object crop and pick the flattest,
 *     evenly-lit region (avoid edges/seams/deep shadows/highlights — quality bounds T2).
 */
import { type RGBAImage, makeImage, toLuminance, boxBlurFloat } from './image'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface FracRect {
  fx: number
  fy: number
  fw: number
  fh: number
}

/** Normalize B's pixel bbox by the RESULT image dims (the downscaled space bbox lives in). */
export function normalizeBbox(
  bbox: [number, number, number, number],
  resultW: number,
  resultH: number,
): FracRect {
  const W = resultW > 0 ? resultW : 1
  const H = resultH > 0 ? resultH : 1
  return {
    fx: bbox[0] / W,
    fy: bbox[1] / H,
    fw: bbox[2] / W,
    fh: bbox[3] / H,
  }
}

/** Map a fractional rect onto the original full-res image, clamped to integer bounds. */
export function bboxToPixels(frac: FracRect, naturalW: number, naturalH: number): Rect {
  let x = Math.round(frac.fx * naturalW)
  let y = Math.round(frac.fy * naturalH)
  let w = Math.round(frac.fw * naturalW)
  let h = Math.round(frac.fh * naturalH)
  // clamp to image
  x = Math.max(0, Math.min(x, naturalW - 1))
  y = Math.max(0, Math.min(y, naturalH - 1))
  w = Math.max(1, Math.min(w, naturalW - x))
  h = Math.max(1, Math.min(h, naturalH - y))
  return { x, y, w, h }
}

/** Crop a sub-rectangle. Rect is clamped to the image; returns a fresh RGBAImage. */
export function cropRect(img: RGBAImage, rect: Rect): RGBAImage {
  const x = Math.max(0, Math.min(Math.round(rect.x), img.width - 1))
  const y = Math.max(0, Math.min(Math.round(rect.y), img.height - 1))
  const w = Math.max(1, Math.min(Math.round(rect.w), img.width - x))
  const h = Math.max(1, Math.min(Math.round(rect.h), img.height - y))
  const out = makeImage(w, h)
  for (let row = 0; row < h; row++) {
    const srcStart = ((y + row) * img.width + x) * 4
    const dstStart = row * w * 4
    out.data.set(img.data.subarray(srcStart, srcStart + w * 4), dstStart)
  }
  return out
}

export interface PatchScore {
  rect: Rect
  /** lower = cleaner (flatter, more evenly lit, more central). */
  cost: number
}

/**
 * Pick the cleanest square patch inside `obj`. Cost penalizes large-scale lighting
 * variation (shadow gradients / silhouette), extreme brightness (deep shadow / blown
 * highlight), and distance from center. Fine texture (weave/grain) is NOT penalized.
 */
export function selectCleanPatch(obj: RGBAImage, patchSize?: number): PatchScore {
  const { width: w, height: h } = obj
  const P = Math.max(16, Math.min(patchSize ?? Math.round(Math.min(w, h) * 0.6), Math.min(w, h)))
  // low-frequency illumination field (large-scale lighting + silhouette structure)
  const lum = toLuminance(obj)
  const illum = boxBlurFloat(lum, w, h, Math.max(2, Math.round(P / 6)), 'clamp')

  const stride = Math.max(1, Math.round(P / 4))
  const cxObj = w / 2
  const cyObj = h / 2
  const maxDist = Math.hypot(cxObj, cyObj) || 1

  let best: PatchScore | null = null
  for (let y = 0; y + P <= h; y += stride) {
    for (let x = 0; x + P <= w; x += stride) {
      // mean + variance of the low-freq field within the window (sub-sampled for speed)
      let sum = 0
      let sum2 = 0
      let n = 0
      const step = Math.max(1, Math.round(P / 16))
      for (let yy = y; yy < y + P; yy += step) {
        for (let xx = x; xx < x + P; xx += step) {
          const v = illum[yy * w + xx]
          sum += v
          sum2 += v * v
          n++
        }
      }
      const meanL = sum / n
      const variance = Math.max(0, sum2 / n - meanL * meanL)
      const unevenness = Math.sqrt(variance) // large-scale lighting/structure spread

      // extreme-brightness penalty (deep shadow < 40, blown highlight > 220)
      let extreme = 0
      if (meanL < 40) extreme += (40 - meanL) * 1.5
      if (meanL > 220) extreme += (meanL - 220) * 1.5

      // center bias (prefer the flat face near the object center)
      const dx = x + P / 2 - cxObj
      const dy = y + P / 2 - cyObj
      const centerPenalty = (Math.hypot(dx, dy) / maxDist) * 12

      const cost = unevenness + extreme + centerPenalty
      if (!best || cost < best.cost) best = { rect: { x, y, w: P, h: P }, cost }
    }
  }
  // fallback: if obj smaller than P in some axis, return a centered clamped square
  if (!best) {
    const side = Math.min(w, h)
    return {
      rect: { x: Math.floor((w - side) / 2), y: Math.floor((h - side) / 2), w: side, h: side },
      cost: 0,
    }
  }
  return best
}

export interface SurfacePatch {
  patch: RGBAImage
  objectRect: Rect
  patchRect: Rect
}

/**
 * End-to-end T1: from the original photo + B's bbox + the result image dims, crop the
 * object and select a clean surface patch.
 */
export function extractSurfacePatch(
  original: RGBAImage,
  bbox: [number, number, number, number],
  resultW: number,
  resultH: number,
  patchPx?: number,
): SurfacePatch {
  const frac = normalizeBbox(bbox, resultW, resultH)
  const objectRect = bboxToPixels(frac, original.width, original.height)
  const obj = cropRect(original, objectRect)
  const sel = selectCleanPatch(obj, patchPx)
  const patch = cropRect(obj, sel.rect)
  return { patch, objectRect, patchRect: sel.rect }
}
