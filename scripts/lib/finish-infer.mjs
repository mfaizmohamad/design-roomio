/**
 * Pure classical-CV routines for the offline listing-finish inference
 * (scripts/infer-listing-scene.mjs). No I/O, no browser, no deps — deterministic
 * and unit-testable (scripts/lib/finish-infer.test.mjs).
 *
 * Colour pipeline: sRGB ↔ linear ↔ CIELAB (D65). White balance estimates the
 * illuminant from BRIGHT near-neutral pixels (walls/ceiling/floor highlights) and
 * normalises them toward neutral — an intrinsic-albedo read, so a warm-lit white
 * wall does NOT become beige (the failure the acceptance calls out), and a warm/
 * dark photo can't blow the correction out (tight clamp). Region dominant colour
 * is a Lab-histogram MODE after rejecting shadows/highlights and over-saturated
 * (object) pixels. The floor classifier decides only WOOD vs STONE (the reliable
 * signal); the exact texture within the group is chosen by nearest colour.
 */

const clamp01 = (x) => Math.max(0, Math.min(1, x))

// ───────────────────────── sRGB ↔ linear ↔ Lab ─────────────────────────
export function srgbToLinear(c) {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
}
export function linearToSrgb(l) {
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055
  return Math.round(clamp01(c) * 255)
}
export function hexToRgb(h) {
  const s = h.replace('#', '')
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}
export function rgbToHex(r, g, b) {
  const to = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

const Xn = 0.95047, Yn = 1, Zn = 1.08883
const fwd = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
const inv = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787)

/** sRGB bytes (0..255) → CIELAB. */
export function rgbToLab(r, g, b) {
  const rl = srgbToLinear(r), gl = srgbToLinear(g), bl = srgbToLinear(b)
  const X = rl * 0.4124 + gl * 0.3576 + bl * 0.1805
  const Y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722
  const Z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505
  const fx = fwd(X / Xn), fy = fwd(Y / Yn), fz = fwd(Z / Zn)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
/** CIELAB → sRGB bytes (0..255). */
export function labToRgb(lab) {
  const [L, a, b] = lab
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200
  const X = inv(fx) * Xn, Y = inv(fy) * Yn, Z = inv(fz) * Zn
  const rl = X * 3.2406 - Y * 1.5372 - Z * 0.4986
  const gl = -X * 0.9689 + Y * 1.8758 + Z * 0.0415
  const bl = X * 0.0557 - Y * 0.204 + Z * 1.057
  return [linearToSrgb(rl), linearToSrgb(gl), linearToSrgb(bl)]
}
/** CIE76 ΔE (Euclidean in Lab) — adequate for coarse nearest-swatch snapping. */
export function deltaE(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
export function chromaOf(lab) {
  return Math.hypot(lab[1], lab[2])
}

// ───────────────────────── white balance (bright-neutral) ─────────────────────────
/**
 * Normalise a photo toward an intrinsic-albedo read in linear light:
 *  1. WHITE BALANCE — estimate the illuminant from bright, near-neutral pixels
 *     (walls/ceiling/floor highlights) and divide it out, so a warm-lit white
 *     surface reads neutral, not beige. Per-channel gain clamped to [0.82, 1.22]
 *     so a warm/dark photo can't over-correct.
 *  2. EXPOSURE — rescale so the scene's bright-neutral reference (its "white
 *     point") lands at a canonical light level. Material lightness is otherwise
 *     confounded by exposure: a white tile floor in a dim room reads grey. Gain
 *     clamped to [0.7, 2.3] so a dark frame can't be blown out. This makes floor/
 *     wall LIGHTNESS comparable across bright and dim photos of the same flat.
 * @param {number[]|Uint8ClampedArray} rgba  packed RGBA bytes, length w*h*4
 * @returns {{ lin: Float64Array, scales:{r:number,g:number,b:number}, exposure:number }}
 */
export function whiteBalanceLinear(rgba, w, h) {
  const n = w * h
  const lin = new Float64Array(n * 3)
  const luma = new Float64Array(n)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = srgbToLinear(rgba[p]), g = srgbToLinear(rgba[p + 1]), b = srgbToLinear(rgba[p + 2])
    lin[i * 3] = r; lin[i * 3 + 1] = g; lin[i * 3 + 2] = b
    luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const thresh = Float64Array.from(luma).sort()[Math.floor(0.65 * n)] // top ~35% brightness
  let iR = 0, iG = 0, iB = 0, cnt = 0
  for (let i = 0; i < n; i++) {
    if (luma[i] < thresh) continue
    const r = lin[i * 3], g = lin[i * 3 + 1], b = lin[i * 3 + 2]
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    if (mx <= 1e-4 || (mx - mn) / mx > 0.35) continue // skip bright but strongly-coloured
    iR += r; iG += g; iB += b; cnt++
  }
  let sR = 1, sG = 1, sB = 1, exposure = 1
  if (cnt >= Math.max(20, 0.02 * n)) {
    iR /= cnt; iG /= cnt; iB /= cnt
    const gray = (iR + iG + iB) / 3 || 1e-6
    const c = (x) => Math.max(0.82, Math.min(1.22, x))
    sR = c(gray / (iR || 1e-6)); sG = c(gray / (iG || 1e-6)); sB = c(gray / (iB || 1e-6))
    // Exposure: map the WB'd reference luma to a canonical light-surface level.
    const refLuma = 0.2126 * iR * sR + 0.7152 * iG * sG + 0.0722 * iB * sB
    exposure = Math.max(0.7, Math.min(2.3, 0.62 / (refLuma || 1e-6)))
  }
  for (let i = 0; i < n; i++) {
    lin[i * 3] = Math.min(1, lin[i * 3] * sR * exposure)
    lin[i * 3 + 1] = Math.min(1, lin[i * 3 + 1] * sG * exposure)
    lin[i * 3 + 2] = Math.min(1, lin[i * 3 + 2] * sB * exposure)
  }
  return { lin, scales: { r: sR, g: sG, b: sB }, exposure }
}

/** CIELAB samples for a fractional band [y0,y1)×[x0,x1) of a WB'd linear grid. */
export function bandLab(lin, w, h, y0, y1, x0, x1) {
  const out = []
  const rx0 = Math.round(x0 * w), rx1 = Math.round(x1 * w)
  const ry0 = Math.round(y0 * h), ry1 = Math.round(y1 * h)
  for (let y = ry0; y < ry1; y++) {
    for (let x = rx0; x < rx1; x++) {
      const i = (y * w + x) * 3
      out.push(rgbToLab(linearToSrgb(lin[i]), linearToSrgb(lin[i + 1]), linearToSrgb(lin[i + 2])))
    }
  }
  return out
}

export function stdOfL(labs) {
  if (!labs.length) return 0
  let m = 0
  for (const l of labs) m += l[0]
  m /= labs.length
  let v = 0
  for (const l of labs) v += (l[0] - m) ** 2
  return Math.sqrt(v / labs.length)
}

// ───────────────────────── region dominant colour ─────────────────────────
/**
 * Dominant colour of Lab samples via a quantised histogram MODE, after rejecting
 * deep-shadow / clipped-highlight pixels and over-saturated (object) pixels. The
 * largest surviving bin wins (walls/floors are the largest coherent surface once
 * shadows and colourful objects are filtered). Returns { lab, coverage } or null
 * when the band is too sparse to trust.
 */
export function dominantColor(labs, { rejectDarkL = 20, rejectBrightL = 98, maxChroma = Infinity, step = 7 } = {}) {
  const kept = labs.filter(([L, a, b]) => L >= rejectDarkL && L <= rejectBrightL && Math.hypot(a, b) <= maxChroma)
  if (kept.length < 10) return null
  const bins = new Map()
  for (const p of kept) {
    const k = `${Math.round(p[0] / step)}|${Math.round(p[1] / step)}|${Math.round(p[2] / step)}`
    let e = bins.get(k)
    if (!e) { e = { n: 0, L: 0, a: 0, b: 0 }; bins.set(k, e) }
    e.n++; e.L += p[0]; e.a += p[1]; e.b += p[2]
  }
  let best = null
  for (const e of bins.values()) if (!best || e.n > best.n) best = e
  const lab = [best.L / best.n, best.a / best.n, best.b / best.n]
  let near = 0
  for (const p of kept) if (deltaE(p, lab) <= 14) near++
  return { lab, coverage: near / kept.length, keptFraction: kept.length / labs.length }
}

// ───────────────────────── floor group classifier ─────────────────────────
/**
 * Decide only WOOD vs STONE for a floor's dominant Lab colour — the reliable
 * classical signal. WOOD = a warm hue (orange/brown/yellow) carrying real chroma
 * (laminate folds in). Everything else (marble, ceramic/vitrified tile, concrete,
 * coloured tile) is STONE; the exact texture is then chosen by nearest colour, so
 * we never have to disambiguate the notoriously-confused tile-vs-marble by CV.
 * Returns { group:'wood'|'stone', decisiveness ∈ (0,1] } — decisiveness scales the
 * per-image confidence.
 */
export function classifyFloorGroup(lab) {
  const [L, a, b] = lab
  const C = Math.hypot(a, b)
  const hue = (Math.atan2(b, a) * 180) / Math.PI // warm woods sit ~25..90°
  const warm = a > 3 && b > 6 && hue >= 22 && hue <= 100
  if (warm && C >= 13 && L >= 20 && L <= 82) {
    return { group: 'wood', decisiveness: clamp01(0.55 + (C - 13) / 45 + (L < 55 ? 0.08 : 0)) }
  }
  // Stone: most decisive when clearly neutral (low chroma). A near-neutral warm
  // beige (C 8..13) is ambiguous → moderate decisiveness.
  const dec = C < 8 ? 0.85 : C < 13 ? 0.55 : 0.45
  return { group: 'stone', decisiveness: clamp01(dec) }
}
