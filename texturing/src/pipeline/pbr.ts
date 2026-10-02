/**
 * Agent H — derive PBR maps (T2c / brief §4c).
 *
 *  - roughnessMap: grayscale. Derived from local contrast and mapped into a per-material
 *    band (fabric matte, wood slightly glossy). High-detail areas (grain/weave catching
 *    light) read slightly glossier; flat areas read matte. Bands match pbr_conventions.json.
 *  - normalMap: tangent-space, +Y (OpenGL) green channel (three default TangentSpaceNormalMap).
 *    Height = luminance; Sobel gradients → normal; WRAP edges so the normal map tiles like
 *    the albedo. A flat patch yields the neutral normal (128,128,255).
 *
 * All maps are LINEAR color space (set at the three boundary, H4); only albedo is sRGB.
 */
import { type RGBAImage, makeImage, toLuminance, boxBlurFloat, type EdgeMode } from './image'

export type SurfaceKind = 'fabric' | 'wood' | 'metal' | 'auto'

const BANDS: Record<Exclude<SurfaceKind, 'auto'>, [number, number]> = {
  fabric: [0.8, 0.95],
  wood: [0.4, 0.6],
  metal: [0.2, 0.5],
}

/** Normalized local high-frequency contrast per pixel (0..1), = |lum - blur(lum)| scaled. */
function localContrast(lum: Float32Array, w: number, h: number, edge: EdgeMode): Float32Array {
  const lo = boxBlurFloat(lum, w, h, Math.max(2, Math.round(Math.min(w, h) / 16)), edge)
  const c = new Float32Array(lum.length)
  let maxC = 1e-6
  for (let i = 0; i < lum.length; i++) {
    c[i] = Math.abs(lum[i] - lo[i])
    if (c[i] > maxC) maxC = c[i]
  }
  for (let i = 0; i < c.length; i++) c[i] /= maxC
  return c
}

/** Mean ABSOLUTE local high-frequency contrast in luma units (0..255). Unlike the
 *  max-normalized `localContrast`, this measures the STRENGTH of detail, so it can tell a
 *  low-amplitude fabric weave from strong directional wood grain. */
export function meanAbsContrast(img: RGBAImage, edge: EdgeMode = 'wrap'): number {
  const { width: w, height: h } = img
  const lum = toLuminance(img)
  const lo = boxBlurFloat(lum, w, h, Math.max(2, Math.round(Math.min(w, h) / 16)), edge)
  let s = 0
  for (let i = 0; i < lum.length; i++) s += Math.abs(lum[i] - lo[i])
  return lum.length ? s / lum.length : 0
}

/** Pick a surface band when kind='auto': strong grain → wood, gentle weave → fabric. */
export function inferSurfaceKind(img: RGBAImage, edge: EdgeMode = 'wrap'): Exclude<SurfaceKind, 'auto'> {
  return meanAbsContrast(img, edge) > 9 ? 'wood' : 'fabric'
}

export interface RoughnessOptions {
  kind?: SurfaceKind
  edge?: EdgeMode
}

/** Build a grayscale roughness map (R=G=B=roughness*255). */
export function roughnessMap(img: RGBAImage, opts: RoughnessOptions = {}): RGBAImage {
  const { width: w, height: h } = img
  const edge: EdgeMode = opts.edge ?? 'wrap'
  let kind = opts.kind ?? 'auto'
  if (kind === 'auto') kind = inferSurfaceKind(img, edge)
  const [lo, hi] = BANDS[kind]
  const c = localContrast(toLuminance(img), w, h, edge)

  const out = makeImage(w, h)
  const d = out.data
  for (let p = 0, i = 0; p < c.length; p++, i += 4) {
    // more local detail => slightly glossier (lower roughness): rough = hi - (hi-lo)*contrast
    const rough = hi - (hi - lo) * c[p]
    const v = Math.round(rough * 255)
    d[i] = d[i + 1] = d[i + 2] = v
    d[i + 3] = 255
  }
  return out
}

export interface NormalOptions {
  /** bump strength; higher = more pronounced relief. Default 2.0 (subtle weave/grain). */
  strength?: number
  edge?: EdgeMode
}

function sampleLum(lum: Float32Array, w: number, h: number, x: number, y: number, edge: EdgeMode): number {
  if (edge === 'wrap') {
    x = ((x % w) + w) % w
    y = ((y % h) + h) % h
  } else {
    x = x < 0 ? 0 : x >= w ? w - 1 : x
    y = y < 0 ? 0 : y >= h ? h - 1 : y
  }
  return lum[y * w + x]
}

/**
 * Build a tangent-space normal map (+Y / OpenGL). Height = luminance; Sobel gradient →
 * surface normal n = normalize(-dX, +dY, 1/strength·k) encoded as (n*0.5+0.5).
 * A flat input yields (128,128,255). Edges WRAP so the map tiles with the albedo.
 *
 * ORIENTATION CONTRACT: the green channel is authored in IMAGE space and is a valid +Y
 * (OpenGL) map ONLY when uploaded with texture.flipY=true — i.e. via CanvasTexture/ImageData
 * (the SAME flip the albedo relies on; this is the established Roomio upload path in
 * src/three/textures.ts). If a DataTexture path is ever used (flipY defaults FALSE), either
 * set texture.flipY=true or negate the green channel, or relief inverts (bumps light as grooves).
 */
export function normalMap(img: RGBAImage, opts: NormalOptions = {}): RGBAImage {
  const { width: w, height: h } = img
  const strength = opts.strength ?? 2.0
  const edge: EdgeMode = opts.edge ?? 'wrap'
  const lum = toLuminance(img)
  const out = makeImage(w, h)
  const d = out.data
  // height in 0..1; gradient scaled by strength
  const inv255 = 1 / 255
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel
      const tl = sampleLum(lum, w, h, x - 1, y - 1, edge)
      const tc = sampleLum(lum, w, h, x, y - 1, edge)
      const tr = sampleLum(lum, w, h, x + 1, y - 1, edge)
      const ml = sampleLum(lum, w, h, x - 1, y, edge)
      const mr = sampleLum(lum, w, h, x + 1, y, edge)
      const bl = sampleLum(lum, w, h, x - 1, y + 1, edge)
      const bc = sampleLum(lum, w, h, x, y + 1, edge)
      const br = sampleLum(lum, w, h, x + 1, y + 1, edge)
      const gx = (tr + 2 * mr + br - tl - 2 * ml - bl) * inv255
      const gy = (bl + 2 * bc + br - tl - 2 * tc - tr) * inv255
      // normal: x = -gx, y = +gy gives +Y (OpenGL) — a brighter region BELOW tilts the
      // normal upward (+Y). z = 1/strength keeps it mostly facing the viewer (subtle).
      let nx = -gx * strength
      let ny = gy * strength
      let nz = 1
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len
      ny /= len
      nz /= len
      const di = (y * w + x) * 4
      d[di] = Math.round((nx * 0.5 + 0.5) * 255)
      d[di + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      d[di + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      d[di + 3] = 255
    }
  }
  return out
}

export interface PbrMapImages {
  albedo: RGBAImage
  roughness: RGBAImage
  normal: RGBAImage
  kind: Exclude<SurfaceKind, 'auto'>
}

/** Convenience: derive the three maps from an already-seamless, de-lit albedo patch. */
export function derivePbr(
  albedo: RGBAImage,
  opts: { kind?: SurfaceKind; normalStrength?: number; edge?: EdgeMode } = {},
): PbrMapImages {
  const edge: EdgeMode = opts.edge ?? 'wrap'
  const kind = opts.kind && opts.kind !== 'auto' ? opts.kind : inferSurfaceKind(albedo, edge)
  return {
    albedo,
    roughness: roughnessMap(albedo, { kind, edge }),
    normal: normalMap(albedo, { strength: opts.normalStrength ?? 2.0, edge }),
    kind,
  }
}
