/**
 * Agent H — pure RGBA image buffer ops (no DOM, no three.js). The whole T2 pipeline
 * (crop → seamless tile → de-light → PBR maps) operates on this plain type so it is
 * deterministic and node-testable. The browser/three boundary wraps these into
 * CanvasTexture/DataTexture at apply time (H4), exactly as src/three/textures.ts does.
 *
 * An RGBAImage is ImageData-compatible: `data` is RGBA, row-major, length = w*h*4.
 */

export interface RGBAImage {
  width: number
  height: number
  data: Uint8ClampedArray // RGBA, row-major
}

export function makeImage(width: number, height: number, fill?: [number, number, number, number]): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4)
  if (fill) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill[0]
      data[i + 1] = fill[1]
      data[i + 2] = fill[2]
      data[i + 3] = fill[3]
    }
  } else {
    // default opaque
    for (let i = 3; i < data.length; i += 4) data[i] = 255
  }
  return { width, height, data }
}

export function cloneImage(img: RGBAImage): RGBAImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }
}

export function clampInt(v: number, lo: number, hi: number): number {
  v = Math.round(v)
  return v < lo ? lo : v > hi ? hi : v
}

/** Index of the R channel of pixel (x,y). */
export function idx(img: RGBAImage, x: number, y: number): number {
  return (y * img.width + x) * 4
}

/** Rec.709 luminance of an sRGB-ish 8-bit triple, 0..255. */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Per-pixel luminance as a Float32Array (0..255), length = w*h. */
export function toLuminance(img: RGBAImage): Float32Array {
  const { width, height, data } = img
  const out = new Float32Array(width * height)
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    out[p] = luma(data[i], data[i + 1], data[i + 2])
  }
  return out
}

export type EdgeMode = 'clamp' | 'wrap'

function wrapIndex(i: number, n: number, mode: EdgeMode): number {
  if (mode === 'wrap') {
    i %= n
    return i < 0 ? i + n : i
  }
  return i < 0 ? 0 : i >= n ? n - 1 : i
}

/**
 * Separable box blur on a Float32 single-channel buffer. Used for the de-light
 * illumination estimate (large radius) and for seam feathering. `edge='wrap'` makes
 * the blur toroidal so it is seam-aware for already-tiling textures.
 */
export function boxBlurFloat(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  edge: EdgeMode = 'clamp',
): Float32Array {
  if (radius < 1) return new Float32Array(src)
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const win = radius * 2 + 1
  // horizontal pass
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) {
        sum += src[row + wrapIndex(x + k, width, edge)]
      }
      tmp[row + x] = sum / win
    }
  }
  // vertical pass
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) {
        sum += tmp[wrapIndex(y + k, height, edge) * width + x]
      }
      out[y * width + x] = sum / win
    }
  }
  return out
}

/** Mean of a Float32 buffer. */
export function mean(buf: Float32Array): number {
  let s = 0
  for (let i = 0; i < buf.length; i++) s += buf[i]
  return buf.length ? s / buf.length : 0
}
