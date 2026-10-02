/**
 * Agent H — seamless tiling (T2a / brief §4a).
 *
 * Method: offset-and-heal (the classic "make seamless" used by image editors).
 *  1. Offset the patch by half its size with WRAP. For a real surface patch (continuous
 *     interior, mismatched borders) this moves the mismatched borders onto what were
 *     interior-adjacent pixels → the OUTER borders become continuous, so the texture now
 *     tiles. The discontinuity relocates to the center cross.
 *  2. Heal the center cross with a LOCAL seam-band feather that never touches the borders,
 *     so tileability is preserved while the relocated seam is smoothed away.
 *
 * Output is meant to be uploaded with THREE.RepeatWrapping (set at the three boundary, H4).
 */
import { type RGBAImage, makeImage } from './image'

/** Wrap-shift an image by (dx, dy). out(x,y) = in((x-dx) mod w, (y-dy) mod h). */
export function offsetWrap(img: RGBAImage, dx: number, dy: number): RGBAImage {
  const { width: w, height: h, data } = img
  const out = makeImage(w, h)
  const od = out.data
  for (let y = 0; y < h; y++) {
    const sy = (((y - dy) % h) + h) % h
    for (let x = 0; x < w; x++) {
      const sx = (((x - dx) % w) + w) % w
      const si = (sy * w + sx) * 4
      const di = (y * w + x) * 4
      od[di] = data[si]
      od[di + 1] = data[si + 1]
      od[di + 2] = data[si + 2]
      od[di + 3] = data[si + 3]
    }
  }
  return out
}

/** Heal a vertical seam at column `cx` over a half-band `F`, in place. Outer borders
 *  (rows 0/h-1, cols 0/w-1) are never written, so tileability is preserved exactly. */
function healSeamV(img: RGBAImage, cx: number, F: number): void {
  const { width: w, height: h, data } = img
  if (F < 1 || cx - F < 0 || cx + F >= w) return
  for (let y = 1; y < h - 1; y++) {
    const row = y * w
    const aI = (row + (cx - F)) * 4
    const bI = (row + (cx + F)) * 4
    for (let x = cx - F + 1; x < cx + F; x++) {
      const t = (x - (cx - F)) / (2 * F)
      const blend = 1 - Math.abs(x - cx) / F // 1 at seam → full target, 0 at band edge
      const di = (row + x) * 4
      for (let c = 0; c < 3; c++) {
        const target = data[aI + c] * (1 - t) + data[bI + c] * t
        data[di + c] = data[di + c] * (1 - blend) + target * blend
      }
    }
  }
}

/** Heal a horizontal seam at row `cy` over a half-band `F`, in place. Outer borders
 *  (cols 0/w-1, rows 0/h-1) are never written, so tileability is preserved exactly. */
function healSeamH(img: RGBAImage, cy: number, F: number): void {
  const { width: w, height: h, data } = img
  if (F < 1 || cy - F < 0 || cy + F >= h) return
  for (let x = 1; x < w - 1; x++) {
    const aI = ((cy - F) * w + x) * 4
    const bI = ((cy + F) * w + x) * 4
    for (let y = cy - F + 1; y < cy + F; y++) {
      const t = (y - (cy - F)) / (2 * F)
      const blend = 1 - Math.abs(y - cy) / F
      const di = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const target = data[aI + c] * (1 - t) + data[bI + c] * t
        data[di + c] = data[di + c] * (1 - blend) + target * blend
      }
    }
  }
}

/** Make `img` tile seamlessly. featherPx defaults to ~6% of the smaller side. */
export function makeSeamless(img: RGBAImage, featherPx?: number): RGBAImage {
  const { width: w, height: h } = img
  const cx = w >> 1
  const cy = h >> 1
  const o = offsetWrap(img, cx, cy)
  let F = featherPx ?? Math.max(2, Math.round(Math.min(w, h) * 0.06))
  F = Math.min(F, cx - 1, cy - 1)
  if (F >= 1) {
    healSeamV(o, cx, F)
    healSeamH(o, cy, F)
  }
  return o
}

/** Mean absolute luminance jump across the wrap (right edge → left edge). Lower = more tileable. */
export function wrapSeamScore(img: RGBAImage): number {
  const { width: w, height: h, data } = img
  let sum = 0
  for (let y = 0; y < h; y++) {
    const l = (y * w + 0) * 4
    const r = (y * w + (w - 1)) * 4
    sum += Math.abs(data[l] - data[r]) + Math.abs(data[l + 1] - data[r + 1]) + Math.abs(data[l + 2] - data[r + 2])
  }
  // also vertical wrap (top↔bottom)
  for (let x = 0; x < w; x++) {
    const t = x * 4
    const b = ((h - 1) * w + x) * 4
    sum += Math.abs(data[t] - data[b]) + Math.abs(data[t + 1] - data[b + 1]) + Math.abs(data[t + 2] - data[b + 2])
  }
  return sum / ((h + w) * 3)
}
