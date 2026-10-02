/**
 * Dependency-free PNG decoding + render-quality assertions.
 *
 * The verification scripts need to answer "is this screenshot ACTUALLY a
 * render, or a blank/black/HUD-contaminated dud?" without pulling in a native
 * image dependency (sharp/pngjs aren't in the tree). We decode PNGs with the
 * built-in zlib and check luminance statistics:
 *   - notBlank  — a flat/uniform image has ~zero luminance variance
 *   - notBlack  — an all-black capture has ~zero mean luminance
 *   - noHudCorners — a stray light UI pill leaves a cluster of near-white,
 *     low-saturation pixels in a corner region (the same class of contamination
 *     shoot-listing-replica's hideChrome() removes before shooting)
 *
 * Supports 8-bit, non-interlaced PNGs, color types 0/2/4/6 (gray, RGB, gray+A,
 * RGBA) — which covers Chrome's `page.screenshot()` output.
 */
import { readFileSync } from 'node:fs'
import zlib from 'node:zlib'

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 4: 2, 6: 4 }

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** Reverse one PNG scanline filter (types 0–4) in place into `cur`. */
function unfilter(type, line, cur, prev, bpp) {
  const stride = line.length
  for (let i = 0; i < stride; i++) {
    const x = line[i]
    const a = i >= bpp ? cur[i - bpp] : 0 // left
    const b = prev[i] // up
    const c = i >= bpp ? prev[i - bpp] : 0 // up-left
    let v
    switch (type) {
      case 0: v = x; break
      case 1: v = x + a; break
      case 2: v = x + b; break
      case 3: v = x + ((a + b) >> 1); break
      case 4: v = x + paeth(a, b, c); break
      default: throw new Error(`unsupported PNG filter type ${type}`)
    }
    cur[i] = v & 0xff
  }
}

/**
 * Decode a PNG (Buffer or file path) to `{ width, height, channels, colorType,
 * data }` where `data` is raw 8-bit samples, `channels` per pixel, row-major.
 */
export function decodePng(input) {
  // Accept a file path (string), a Node Buffer, or a Uint8Array — puppeteer's
  // page.screenshot() returns a Uint8Array, not a Buffer, in v22+.
  const buf = typeof input === 'string' ? readFileSync(input) : Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG (bad signature)')
  }
  let off = 8
  let width, height, bitDepth, colorType, interlace
  const idat = []
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const dataStart = off + 8
    const data = buf.subarray(dataStart, dataStart + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    off = dataStart + len + 4 // + 4-byte CRC
  }
  if (width == null) throw new Error('PNG missing IHDR')
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth} (only 8-bit supported)`)
  if (interlace) throw new Error('interlaced PNGs are not supported')
  const channels = CHANNELS_BY_COLOR_TYPE[colorType]
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`)

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  let prev = Buffer.alloc(stride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const line = raw.subarray(pos, pos + stride)
    pos += stride
    const cur = out.subarray(y * stride, y * stride + stride)
    unfilter(filter, line, cur, prev, channels)
    prev = cur
  }
  return { width, height, channels, colorType, data: out }
}

/** Rec.709 luminance (0–255) for a pixel at sample offset `pi`. */
function luminanceAt(data, pi, channels) {
  if (channels <= 2) return data[pi] // gray / gray+alpha
  return 0.2126 * data[pi] + 0.7152 * data[pi + 1] + 0.0722 * data[pi + 2]
}

/** Mean + standard deviation of luminance across the whole image (0–255). */
export function pngStats(png) {
  const { width, height, channels, data } = png
  const n = width * height
  let sum = 0
  let sumSq = 0
  for (let i = 0, pi = 0; i < n; i++, pi += channels) {
    const L = luminanceAt(data, pi, channels)
    sum += L
    sumSq += L * L
  }
  const mean = n ? sum / n : 0
  const variance = n ? Math.max(0, sumSq / n - mean * mean) : 0
  return { width, height, mean, std: Math.sqrt(variance) }
}

/**
 * Fraction of near-white, low-saturation pixels in each of the four corner
 * boxes. A light UI pill (text on a pale/white chip) shows up as a high
 * fraction here; a colored scene (even a bright window) has high saturation and
 * scores low. `frac` is the box side length as a fraction of each dimension.
 */
export function cornerWhiteFractions(png, { frac = 0.14, whiteLum = 210, maxSat = 0.18 } = {}) {
  const { width, height, channels, data } = png
  const bw = Math.max(1, Math.round(width * frac))
  const bh = Math.max(1, Math.round(height * frac))
  const boxes = [
    { name: 'top-left', x0: 0, y0: 0 },
    { name: 'top-right', x0: width - bw, y0: 0 },
    { name: 'bottom-left', x0: 0, y0: height - bh },
    { name: 'bottom-right', x0: width - bw, y0: height - bh },
  ]
  return boxes.map(({ name, x0, y0 }) => {
    let white = 0
    let total = 0
    for (let y = y0; y < y0 + bh; y++) {
      for (let x = x0; x < x0 + bw; x++) {
        const pi = (y * width + x) * channels
        let r, g, b
        if (channels <= 2) r = g = b = data[pi]
        else { r = data[pi]; g = data[pi + 1]; b = data[pi + 2] }
        const L = 0.2126 * r + 0.7152 * g + 0.0722 * b
        const mx = Math.max(r, g, b)
        const mn = Math.min(r, g, b)
        const sat = mx === 0 ? 0 : (mx - mn) / mx
        if (L > whiteLum && sat < maxSat) white++
        total++
      }
    }
    return { name, frac: total ? white / total : 0 }
  })
}

/**
 * Assert a screenshot is a real render. Returns
 *   { ok, failures[], stats: {width,height,meanLum,std}, corners? }
 * rather than throwing, so callers compose it into their own pass/fail logging.
 *
 * @param {Buffer|string} input  PNG buffer or file path.
 * @param {object} [opts]
 * @param {boolean} [opts.notBlank=true]   fail if luminance variance is ~0
 * @param {boolean} [opts.notBlack=true]   fail if the image is ~all-black
 * @param {boolean} [opts.noHudCorners=false] fail if a corner looks like a UI pill
 * @param {number}  [opts.minStd=6]        luminance stddev floor for notBlank
 * @param {number}  [opts.minMeanLum=8]    mean-luminance floor for notBlack
 * @param {number}  [opts.corner=0.14]     corner box size (fraction of a side)
 * @param {number}  [opts.maxCornerWhiteFrac=0.12] near-white fraction ceiling
 * @param {number}  [opts.whiteLum=210]    near-white luminance threshold
 */
export function assertRenderQuality(input, opts = {}) {
  const {
    notBlank = true,
    notBlack = true,
    noHudCorners = false,
    minStd = 6,
    minMeanLum = 8,
    corner = 0.14,
    maxCornerWhiteFrac = 0.12,
    whiteLum = 210,
  } = opts
  const png = decodePng(input)
  const s = pngStats(png)
  const failures = []
  if (notBlank && s.std < minStd) {
    failures.push(`blank/uniform image (luminance std ${s.std.toFixed(2)} < ${minStd})`)
  }
  if (notBlack && s.mean < minMeanLum) {
    failures.push(`near-black image (mean luminance ${s.mean.toFixed(2)} < ${minMeanLum})`)
  }
  let corners
  if (noHudCorners) {
    corners = cornerWhiteFractions(png, { frac: corner, whiteLum })
    for (const c of corners) {
      if (c.frac > maxCornerWhiteFrac) {
        failures.push(
          `possible HUD/pill in ${c.name} corner (${(c.frac * 100).toFixed(1)}% near-white > ${(maxCornerWhiteFrac * 100).toFixed(0)}%)`,
        )
      }
    }
  }
  return {
    ok: failures.length === 0,
    failures,
    stats: { width: png.width, height: png.height, meanLum: +s.mean.toFixed(2), std: +s.std.toFixed(2) },
    ...(corners ? { corners } : {}),
  }
}
