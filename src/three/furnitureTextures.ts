import * as THREE from 'three'

// ---------------------------------------------------------------------------
// Procedural surface maps — no external image assets, same posture as the
// floor/wall texture generators in ./textures.ts. Two families live here:
//
//  1. FURNITURE surfaces (fabric | linen | wood | rug | curtain) — a de-lit
//     micro-detail albedo (GRAYSCALE, mean ≈ 1 so the mesh's own `color` tints
//     it), a tangent-space normal map, and a roughness map. Colour-INDEPENDENT
//     → generated ONCE per family (module-level cache) and shared across every
//     instance; per-mesh world-space tiling is a cheap clone that shares the
//     GPU image source. Public API: surfaceMaps() / repeatForFace().
//
//  2. ARCHITECTURAL finishes (stone | marble | tile | laminate | metal |
//     ceramic | leather | plaster) — the SAME field machinery, but the floor /
//     wall routers additionally colourise the albedo (tint↔accent via a per
//     pixel blend mask) so a marble floor keeps its grey figure and a checker
//     tile keeps two colours, while STILL emitting a real +Y normal (Sobel of
//     the height field) and a spatially-varying roughness map (grout rougher,
//     polished field glossy). Domain-warped veins + per-tile jitter break the
//     obvious tile repeat at grazing angle. Public API: architecturalMaps().
//
// Colour-space contract (shared/pbr_conventions.json, ratified):
//   albedo .map      → SRGBColorSpace
//   normalMap        → linear (NoColorSpace, the three default) — +Y OpenGL
//   roughnessMap     → linear; grayscale so the channel doesn't matter
//   material.roughness = 1 so the MAP drives roughness; metalness = 0 (dielectric)
//   NO aoMap (Agent G's screen-space N8AO owns contact AO)
//
// VRAM: every map-set is cached module-level keyed by (kind, quantized params),
// ≤ 1024² and shared across ALL rooms — renderer.info.memory.textures is a
// function of the distinct materials in play, NOT of the room / part count.
// ---------------------------------------------------------------------------

export type SurfaceKind =
  // furniture families (grayscale albedo, tinted by the mesh colour)
  | 'fabric'
  | 'linen'
  | 'wood'
  | 'rug'
  | 'curtain'
  // architectural finishes (usable grayscale for furniture, colourised for floors/walls)
  | 'stone'
  | 'marble'
  | 'tile'
  | 'laminate'
  | 'metal'
  | 'ceramic'
  | 'leather'
  | 'plaster'

const FURNITURE_RES = 256 // canvas resolution for the furniture families

// World-metres represented by ONE texture tile, per family. The furniture path's
// per-mesh repeat is worldDim / repeatM (mirrors the floor's areaCm contract) so
// weave/grain/grout scale stays physically believable across differently-sized
// meshes. (Floors set their tiling via mesh UVs + areaCm, so REPEAT_M only
// governs the furniture path for the architectural kinds.)
const REPEAT_M: Record<SurfaceKind, number> = {
  fabric: 0.16,
  linen: 0.2,
  wood: 0.85,
  rug: 0.45,
  curtain: 0.34,
  stone: 2.0,
  marble: 2.4,
  tile: 0.6,
  laminate: 1.2,
  metal: 0.5,
  ceramic: 0.6,
  leather: 0.5,
  plaster: 2.5,
}

// Subtle relief — enough to catch a grazing highlight, never embossed.
const NORMAL_SCALE: Record<SurfaceKind, number> = {
  fabric: 0.6,
  linen: 0.5,
  wood: 0.35,
  rug: 0.85,
  curtain: 0.7,
  stone: 0.4,
  marble: 0.18,
  tile: 0.55,
  laminate: 0.28,
  metal: 0.22,
  ceramic: 0.3,
  leather: 0.7,
  plaster: 0.22,
}

// Default gloss (0 matte → 1 mirror) used when a kind is built for the FURNITURE
// path; the floor/wall routers pass an explicit gloss derived from the material.
const DEFAULT_GLOSS: Record<SurfaceKind, number> = {
  fabric: 0.05,
  linen: 0.08,
  wood: 0.42,
  rug: 0.03,
  curtain: 0.08,
  stone: 0.12,
  marble: 0.82,
  tile: 0.5,
  laminate: 0.62,
  metal: 0.72,
  ceramic: 0.78,
  leather: 0.4,
  plaster: 0.05,
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const sstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// Stable per-cell hash → [0,1) for per-tile / per-plank jitter.
function hash01(a: number, b: number, seed: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(seed | 0, 2246822519)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return (h >>> 0) / 4294967296
}

// Tileable value noise on a lattice of period `period` (must divide `res` for a
// seamless wrap). Returns a sampler over [0,res).
function makeNoise(res: number, period: number, seed: number): (x: number, y: number) => number {
  const g = new Float32Array(period * period)
  const rnd = mulberry32(seed)
  for (let i = 0; i < g.length; i++) g[i] = rnd()
  const at = (ix: number, iy: number) =>
    g[(((iy % period) + period) % period) * period + (((ix % period) + period) % period)]
  return (x: number, y: number) => {
    const fx = (x / res) * period
    const fy = (y / res) * period
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = smooth(fx - x0)
    const ty = smooth(fy - y0)
    const a = at(x0, y0)
    const b = at(x0 + 1, y0)
    const c = at(x0, y0 + 1)
    const d = at(x0 + 1, y0 + 1)
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty
  }
}

// fbm of tileable noise (periods double each octave; all divide `res` → seamless).
function fbm(x: number, y: number, samplers: ((x: number, y: number) => number)[]): number {
  let sum = 0
  let amp = 0.5
  let norm = 0
  for (const s of samplers) {
    sum += s(x, y) * amp
    norm += amp
    amp *= 0.5
  }
  return sum / norm
}

// Parameters threaded into a field generator. `res` sets the canvas resolution
// (256 furniture, up to 1024 for floor finishes); `gloss` drives the roughness
// map; `tiles` is the grid / plank count; `pattern` selects tile variants.
export interface GenParams {
  seed: number
  res: number
  gloss: number
  tiles: number
  pattern: 'plain' | 'checker' | 'speckle'
}

interface Fields {
  // per-pixel grayscale albedo multiplier (mean ≈ 1), height ∈ [0,1], roughness ∈ [0,1]
  alb: Float32Array
  h: Float32Array
  rough: Float32Array
  // optional accent-blend mask ∈ [0,1] used ONLY by the colourised (floor/wall)
  // path — veins / grout / grain lerp the albedo toward the material's accent.
  mask?: Float32Array
}

// Absolute face roughness for a given gloss: gloss 0 → 0.90 matte, gloss 1 → 0.08.
const roughFromGloss = (g: number) => 0.9 - 0.82 * clamp01(g)

// ---------------------------------------------------------------------------
// Furniture families (unchanged look; only `res`/params threaded through).
// ---------------------------------------------------------------------------

function genFabric(p: GenParams): Fields {
  const { seed, res } = p
  const n = res * res
  const alb = new Float32Array(n)
  const h = new Float32Array(n)
  const rough = new Float32Array(n)
  const threads = 26 // warp/weft threads across the tile
  const fiber = makeNoise(res, 64, seed ^ 0x9e37)
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x
      const u = (x / res) * threads
      const v = (y / res) * threads
      const cu = u - Math.floor(u)
      const cv = v - Math.floor(v)
      const warpOver = ((Math.floor(u) + Math.floor(v)) & 1) === 0
      const bump = warpOver ? Math.sin(cu * Math.PI) : Math.sin(cv * Math.PI)
      const under = warpOver ? Math.sin(cv * Math.PI) : Math.sin(cu * Math.PI)
      const ht = 0.35 * bump + 0.12 * under
      const grit = fiber(x, y)
      h[i] = clamp01(ht + grit * 0.12)
      alb[i] = clamp01(0.9 + 0.12 * bump - 0.06 * (1 - bump) + (grit - 0.5) * 0.05)
      rough[i] = clamp01(0.9 - 0.08 * bump + (grit - 0.5) * 0.04)
    }
  }
  return { alb, h, rough }
}

function genLinen(p: GenParams): Fields {
  const { seed, res } = p
  const n = res * res
  const alb = new Float32Array(n)
  const h = new Float32Array(n)
  const rough = new Float32Array(n)
  const threads = 44 // finer than upholstery
  const wrinkle = makeNoise(res, 8, seed ^ 0x51ed)
  const wrinkle2 = makeNoise(res, 16, seed ^ 0x1b3f)
  const fiber = makeNoise(res, 96, seed ^ 0x77af)
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x
      const u = (x / res) * threads
      const v = (y / res) * threads
      const cu = u - Math.floor(u)
      const cv = v - Math.floor(v)
      const warpOver = ((Math.floor(u) + Math.floor(v)) & 1) === 0
      const weave = warpOver ? Math.sin(cu * Math.PI) : Math.sin(cv * Math.PI)
      const wr = fbm(x, y, [wrinkle, wrinkle2]) - 0.5
      const grit = fiber(x, y)
      h[i] = clamp01(0.25 * weave + 0.5 + wr * 0.6)
      alb[i] = clamp01(0.94 + wr * 0.1 + (weave - 0.5) * 0.05 + (grit - 0.5) * 0.03)
      rough[i] = clamp01(0.9 - wr * 0.08 - weave * 0.04)
    }
  }
  return { alb, h, rough }
}

function genWood(p: GenParams): Fields {
  const { seed, res } = p
  const n = res * res
  const alb = new Float32Array(n)
  const h = new Float32Array(n)
  const rough = new Float32Array(n)
  const mask = new Float32Array(n)
  const rnd = mulberry32(seed)
  const planks = Math.max(2, Math.round(p.tiles) || 3)
  const plankTint: number[] = []
  const plankPhase: number[] = []
  for (let pp = 0; pp < planks; pp++) {
    plankTint.push((rnd() - 0.5) * 0.08)
    plankPhase.push(rnd() * 100)
  }
  const grainWobble = makeNoise(res, 16, seed ^ 0x2c1a)
  const faceRough = roughFromGloss(p.gloss)
  for (let y = 0; y < res; y++) {
    const plank = Math.min(planks - 1, Math.floor((y / res) * planks))
    const frac = ((y / res) * planks) % 1
    const seam = frac < 0.012 || frac > 0.988
    for (let x = 0; x < res; x++) {
      const i = y * res + x
      // grain runs along +x: mostly-straight fine lines with a gentle wander
      const wob = (grainWobble(x, y) - 0.5) * 2.5
      const line = Math.sin((x + wob + plankPhase[plank] * 7) * ((0.42 * res) / 256)) * 0.5 + 0.5
      const fine = Math.sin((x + wob * 0.5) * ((1.9 * res) / 256)) * 0.5 + 0.5
      const grain = line * 0.68 + fine * 0.32
      const dark = Math.pow(grain, 2.4) // grain lines = darker grooves
      h[i] = clamp01(0.65 - dark * 0.4)
      alb[i] = clamp01(0.98 + plankTint[plank] - dark * 0.13)
      rough[i] = clamp01(faceRough + dark * 0.09)
      mask[i] = dark * 0.55 // grain lerps toward accent
      if (seam) {
        h[i] = 0.2
        alb[i] = clamp01(alb[i] - 0.14)
        rough[i] = clamp01(faceRough + 0.12)
        mask[i] = 1
      }
    }
  }
  return { alb, h, rough, mask }
}

function genRug(p: GenParams): Fields {
  const { seed, res } = p
  const n = res * res
  const alb = new Float32Array(n)
  const h = new Float32Array(n)
  const rough = new Float32Array(n)
  const pile = makeNoise(res, 64, seed ^ 0x3a11)
  const pile2 = makeNoise(res, 128, seed ^ 0x6b27)
  const clump = makeNoise(res, 16, seed ^ 0x11cd)
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x
      const pv = fbm(x, y, [clump, pile, pile2])
      h[i] = clamp01(pv)
      alb[i] = clamp01(0.82 + pv * 0.32)
      rough[i] = clamp01(0.95 - pv * 0.06)
    }
  }
  return { alb, h, rough }
}

function genCurtain(p: GenParams): Fields {
  const { seed, res } = p
  const n = res * res
  const alb = new Float32Array(n)
  const h = new Float32Array(n)
  const rough = new Float32Array(n)
  const folds = 4 // vertical drape folds across the tile
  const weave = 40
  const fiber = makeNoise(res, 96, seed ^ 0x44bd)
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x
      const fold = Math.sin((x / res) * folds * Math.PI * 2) * 0.5 + 0.5
      const wv = Math.sin((x / res) * weave * Math.PI * 2) * 0.5 + 0.5
      const grit = fiber(x, y)
      h[i] = clamp01(fold * 0.7 + wv * 0.12 + (grit - 0.5) * 0.1)
      alb[i] = clamp01(0.86 + fold * 0.16 + (grit - 0.5) * 0.04)
      rough[i] = clamp01(0.92 - fold * 0.05)
    }
  }
  return { alb, h, rough }
}

// ---------------------------------------------------------------------------
// Architectural finishes. Height fields are pixel-based (no canvas path drawing)
// so they Sobel cleanly into a +Y normal and tile seamlessly.
// ---------------------------------------------------------------------------

// Domain-warped ridged veins (marble figure). Two independent tileable fbm
// fields warp the sample point so veins meander and DON'T lock onto the lattice;
// a finer pass adds sparse hairline threads. A low-frequency REGION field gates
// the veins so the slab keeps large calm expanses (elegant vitrified marble, not
// a busy oil-slick). Returns a mask ∈ [0,1].
function veinField(res: number, seed: number, warpAmp: number, thresh: number, hairThresh: number): Float32Array {
  const out = new Float32Array(res * res)
  const wax = makeNoise(res, 8, seed ^ 0x1111)
  const way = makeNoise(res, 16, seed ^ 0x2222)
  const wbx = makeNoise(res, 8, seed ^ 0x3333)
  const wby = makeNoise(res, 16, seed ^ 0x4444)
  // LOW-frequency vein noise → a few big sweeping veins (level sets of a coarse
  // field), not a dense capillary network. Hairlines stay sparse + fine.
  const va = makeNoise(res, 4, seed ^ 0x5555)
  const vb = makeNoise(res, 8, seed ^ 0x6666)
  const fa = makeNoise(res, 32, seed ^ 0x8888)
  const fb = makeNoise(res, 64, seed ^ 0x9999)
  const region = makeNoise(res, 4, seed ^ 0xaaaa) // where veins are allowed to run
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const wx = (fbm(x, y, [wax, way]) - 0.5) * warpAmp
      const wy = (fbm(x, y, [wbx, wby]) - 0.5) * warpAmp
      const q = fbm(x + wx, y + wy, [va, vb])
      const ridge = 1 - Math.abs(2 * q - 1)
      const vein = sstep(thresh, 1, ridge)
      const q2 = fbm(x + wx * 0.5, y + wy * 0.5, [fa, fb])
      const hair = sstep(hairThresh, 1, 1 - Math.abs(2 * q2 - 1)) * 0.22
      const gate = sstep(0.3, 0.62, region(x, y)) // calm expanses between vein runs
      out[y * res + x] = clamp01(vein * gate + hair * gate * 0.6)
    }
  }
  return out
}

function genMarble(p: GenParams): Fields {
  const { seed, res } = p
  const n = res * res
  const alb = new Float32Array(n)
  const h = new Float32Array(n)
  const rough = new Float32Array(n)
  const mask = new Float32Array(n)
  const veins = veinField(res, seed, res * 0.06, 0.9, 0.97)
  const cloud = makeNoise(res, 8, seed ^ 0xa1a1)
  const faceRough = roughFromGloss(p.gloss)
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x
      const m = veins[i]
      const cl = (cloud(x, y) - 0.5) * 0.045 // faint tonal drift across the slab
      alb[i] = clamp01(1.0 + cl - m * 0.06) // veins read as a gentle tonal shift
      h[i] = clamp01(0.5 + m * 0.1 + cl * 0.4)
      rough[i] = clamp01(faceRough + m * 0.05 - cl * 0.02)
      mask[i] = m * 0.7 // subtle accent tint along the vein
    }
  }
  return { alb, h, rough, mask }
}

function genStone(p: GenParams): Fields {
  const { seed, res } = p
  const n = res * res
  const alb = new Float32Array(n)
  const h = new Float32Array(n)
  const rough = new Float32Array(n)
  const mask = new Float32Array(n)
  const a = makeNoise(res, 8, seed ^ 0x0b01)
  const b = makeNoise(res, 16, seed ^ 0x0b02)
  const c = makeNoise(res, 64, seed ^ 0x0b03)
  const d = makeNoise(res, 128, seed ^ 0x0b04)
  const fleck = makeNoise(res, Math.min(256, res), seed ^ 0x0b05)
  const faceRough = roughFromGloss(p.gloss)
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x
      const m = fbm(x, y, [a, b, c, d])
      const fl = fleck(x, y)
      alb[i] = clamp01(0.92 + (m - 0.5) * 0.16 + (fl - 0.5) * 0.05)
      h[i] = clamp01(0.15 + m * 0.7)
      rough[i] = clamp01(faceRough + (m - 0.5) * 0.06 + (fl - 0.5) * 0.05)
      mask[i] = clamp01((fl - 0.72) * 3) * 0.5 // sparse aggregate flecks
    }
  }
  return { alb, h, rough, mask }
}

function genTile(p: GenParams): Fields {
  const { seed, res } = p
  const n = res * res
  const alb = new Float32Array(n)
  const h = new Float32Array(n)
  const rough = new Float32Array(n)
  const mask = new Float32Array(n)
  const tiles = Math.max(1, Math.round(p.tiles) || 4)
  const polished = p.gloss > 0.45
  const groutW = polished ? 0.01 : 0.026 // fraction of a tile cell
  const micro = makeNoise(res, res >= 256 ? 128 : 64, seed ^ 0x7c01)
  const speck = makeNoise(res, res >= 256 ? 256 : res, seed ^ 0x7c02)
  const faceRough = roughFromGloss(p.gloss)
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x
      const fx = (x / res) * tiles
      const fy = (y / res) * tiles
      const tx = Math.floor(fx)
      const ty = Math.floor(fy)
      const u = fx - tx
      const v = fy - ty
      const dist = Math.min(u, 1 - u, v, 1 - v)
      const grout = 1 - sstep(groutW, groutW * 1.8, dist) // 1 in the grout channel
      const jitter = (hash01(tx, ty, seed) - 0.5) * 0.1 // per-tile lightness jitter
      const mi = (micro(x, y) - 0.5) * 0.03
      const checkerCell = p.pattern === 'checker' && ((tx + ty) & 1) === 1
      let a: number
      let hh: number
      let r: number
      let mk: number
      if (grout > 0.02) {
        // grout line: recessed + rougher. Polished → hairline LIGHT grout.
        a = polished ? clamp01(1.02) : 0.8
        hh = clamp01(0.5 - 0.32 * grout)
        r = clamp01(lerp(faceRough, 0.85, grout))
        mk = polished ? 0 : grout // matte grout takes the accent (darker) colour
      } else {
        a = clamp01(0.95 + jitter + mi)
        hh = 0.72
        r = clamp01(faceRough + mi)
        mk = checkerCell ? 1 : 0
      }
      if (p.pattern === 'speckle' && grout <= 0.02) {
        const s = speck(x, y)
        const fleck = sstep(0.7, 0.82, s)
        a = clamp01(a - fleck * 0.12)
        mk = Math.max(mk, fleck * 0.7)
        r = clamp01(r + fleck * 0.08)
      }
      alb[i] = a
      h[i] = hh
      rough[i] = r
      mask[i] = mk
    }
  }
  return { alb, h, rough, mask }
}

function genLaminate(p: GenParams): Fields {
  const { seed, res } = p
  const n = res * res
  const alb = new Float32Array(n)
  const h = new Float32Array(n)
  const rough = new Float32Array(n)
  const mask = new Float32Array(n)
  const rnd = mulberry32(seed)
  const planks = Math.max(2, Math.round(p.tiles) || 5)
  const plankTint: number[] = []
  const plankPhase: number[] = []
  for (let pp = 0; pp < planks; pp++) {
    plankTint.push((rnd() - 0.5) * 0.05)
    plankPhase.push(rnd() * 100)
  }
  const wob = makeNoise(res, 32, seed ^ 0x1a2b)
  const sheen = makeNoise(res, 16, seed ^ 0x1a2c)
  const faceRough = roughFromGloss(p.gloss)
  for (let y = 0; y < res; y++) {
    const plank = Math.min(planks - 1, Math.floor((y / res) * planks))
    const frac = ((y / res) * planks) % 1
    const seam = frac < 0.01 || frac > 0.99
    for (let x = 0; x < res; x++) {
      const i = y * res + x
      // tight, mostly-straight grain (anisotropic along +x)
      const w = (wob(x, y) - 0.5) * 1.4
      const line = Math.sin((x + w + plankPhase[plank] * 5) * ((0.5 * res) / 256)) * 0.5 + 0.5
      const fine = Math.sin((x + w * 0.4) * ((2.6 * res) / 256)) * 0.5 + 0.5
      const grain = line * 0.7 + fine * 0.3
      const dark = Math.pow(grain, 3.0)
      // anisotropy: roughness streaks run ALONG the grain (varies in y, not x)
      const streak = (sheen(x, y) - 0.5) * 0.08
      alb[i] = clamp01(0.99 + plankTint[plank] - dark * 0.1)
      h[i] = clamp01(0.6 - dark * 0.28)
      rough[i] = clamp01(faceRough + dark * 0.06 + streak)
      mask[i] = dark * 0.4
      if (seam) {
        alb[i] = clamp01(alb[i] - 0.12)
        h[i] = 0.25
        rough[i] = clamp01(faceRough + 0.12)
        mask[i] = 1
      }
    }
  }
  return { alb, h, rough, mask }
}

function genMetal(p: GenParams): Fields {
  const { seed, res } = p
  const n = res * res
  const alb = new Float32Array(n)
  const h = new Float32Array(n)
  const rough = new Float32Array(n)
  const jitterN = makeNoise(res, 32, seed ^ 0x3d01)
  const streaks = 44 // horizontal brush lines across the tile
  const faceRough = roughFromGloss(p.gloss)
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x
      // brushed anisotropy: fine streaks that run horizontally, wobbled in x
      const wobble = (jitterN(x, y) - 0.5) * (res * 0.03)
      const s = Math.sin((y + wobble) * ((Math.PI * 2 * streaks) / res)) * 0.5 + 0.5
      alb[i] = clamp01(0.9 + (s - 0.5) * 0.05)
      h[i] = clamp01(0.5 + (s - 0.5) * 0.15)
      // roughness varies strongly across the brush direction → anisotropic sheen
      rough[i] = clamp01(faceRough + (s - 0.5) * 0.12)
    }
  }
  return { alb, h, rough }
}

function genCeramic(p: GenParams): Fields {
  const { seed, res } = p
  const n = res * res
  const alb = new Float32Array(n)
  const h = new Float32Array(n)
  const rough = new Float32Array(n)
  const mask = new Float32Array(n)
  const tiles = Math.max(1, Math.round(p.tiles) || 3)
  const cloud = makeNoise(res, 8, seed ^ 0xce01)
  const cloud2 = makeNoise(res, 16, seed ^ 0xce02)
  const groutW = 0.008
  const faceRough = roughFromGloss(p.gloss)
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x
      const fx = (x / res) * tiles
      const fy = (y / res) * tiles
      const u = fx - Math.floor(fx)
      const v = fy - Math.floor(fy)
      const dist = Math.min(u, 1 - u, v, 1 - v)
      const grout = 1 - sstep(groutW, groutW * 2, dist)
      const cl = (fbm(x, y, [cloud, cloud2]) - 0.5) * 0.05 // faint glaze clouding
      if (grout > 0.02) {
        alb[i] = clamp01(1.01)
        h[i] = clamp01(0.5 - 0.2 * grout)
        rough[i] = clamp01(lerp(faceRough, 0.55, grout))
        mask[i] = 0
      } else {
        alb[i] = clamp01(1.0 + cl)
        h[i] = clamp01(0.6 + cl)
        rough[i] = clamp01(faceRough + Math.abs(cl) * 0.3)
        mask[i] = 0
      }
    }
  }
  return { alb, h, rough, mask }
}

function genLeather(p: GenParams): Fields {
  const { seed, res } = p
  const n = res * res
  const alb = new Float32Array(n)
  const h = new Float32Array(n)
  const rough = new Float32Array(n)
  const mask = new Float32Array(n)
  // Worley-lite cellular pebble grain: jittered feature points on a wrapped grid.
  const cells = 12
  const cell = res / cells
  const pts: { x: number; y: number }[] = []
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      pts.push({ x: (cx + hash01(cx, cy, seed)) * cell, y: (cy + hash01(cy, cx, seed ^ 0x99)) * cell })
    }
  }
  const pore = makeNoise(res, 128, seed ^ 0xae01)
  const faceRough = roughFromGloss(p.gloss)
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x
      const cx = Math.floor(x / cell)
      const cy = Math.floor(y / cell)
      let d1 = 1e9
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = ((cx + ox) % cells + cells) % cells
          const gy = ((cy + oy) % cells + cells) % cells
          const pt = pts[gy * cells + gx]
          // wrap the feature point into the local neighbourhood for seamless tiling
          const px = pt.x + (cx + ox - gx) * cell
          const py = pt.y + (cy + oy - gy) * cell
          const dd = (px - x) * (px - x) + (py - y) * (py - y)
          if (dd < d1) d1 = dd
        }
      }
      const bump = clamp01(Math.sqrt(d1) / (cell * 0.7)) // 0 at cell centre → 1 at seams
      const grain = 1 - bump // raised pebbles, recessed seams
      const po = (pore(x, y) - 0.5) * 0.08
      alb[i] = clamp01(0.9 + grain * 0.12 + po)
      h[i] = clamp01(grain * 0.8 + 0.1 + po)
      rough[i] = clamp01(faceRough + (1 - grain) * 0.12)
      mask[i] = clamp01(1 - grain) * 0.4 // creases lerp toward accent
    }
  }
  return { alb, h, rough, mask }
}

function genPlaster(p: GenParams): Fields {
  const { seed, res } = p
  const n = res * res
  const alb = new Float32Array(n)
  const h = new Float32Array(n)
  const rough = new Float32Array(n)
  const low = makeNoise(res, 4, seed ^ 0x9101)
  const low2 = makeNoise(res, 8, seed ^ 0x9102)
  const stip = makeNoise(res, res >= 256 ? 128 : 64, seed ^ 0x9103)
  const stip2 = makeNoise(res, res >= 256 ? 256 : res, seed ^ 0x9104)
  const faceRough = roughFromGloss(p.gloss)
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x
      const lo = fbm(x, y, [low, low2]) - 0.5
      const st = fbm(x, y, [stip, stip2]) - 0.5
      // centre ≈ 1 so a painted wall matches its swatch; variation stays subtle
      alb[i] = clamp01(0.998 + lo * 0.025 + st * 0.018)
      h[i] = clamp01(0.5 + st * 0.4 + lo * 0.3)
      rough[i] = clamp01(faceRough + st * 0.04)
    }
  }
  return { alb, h, rough }
}

const GEN: Record<SurfaceKind, (p: GenParams) => Fields> = {
  fabric: genFabric,
  linen: genLinen,
  wood: genWood,
  rug: genRug,
  curtain: genCurtain,
  stone: genStone,
  marble: genMarble,
  tile: genTile,
  laminate: genLaminate,
  metal: genMetal,
  ceramic: genCeramic,
  leather: genLeather,
  plaster: genPlaster,
}

// ---------------------------------------------------------------------------
// Canvas builders.
// ---------------------------------------------------------------------------

function fieldToCanvas(field: Float32Array, res: number): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = res
  cv.height = res
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(res, res)
  for (let i = 0; i < field.length; i++) {
    const val = Math.round(clamp01(field[i]) * 255)
    img.data[i * 4] = val
    img.data[i * 4 + 1] = val
    img.data[i * 4 + 2] = val
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return cv
}

// sRGB byte triple from a #rrggbb string (no THREE.Color → no colour-space drift;
// the canvas is tagged SRGBColorSpace so bytes stay sRGB).
function hexRGB(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}

// Colourised albedo: base = lerp(tint, accent, mask), then multiplied by the
// tonal grayscale `alb` (mean ≈ 1) so figure/grain reads without double-lighting.
function coloredCanvas(f: Fields, res: number, tint: string, accent: string): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = res
  cv.height = res
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(res, res)
  const [tr, tg, tb] = hexRGB(tint)
  const [ar, ag, ab] = hexRGB(accent)
  const mask = f.mask
  for (let i = 0; i < f.alb.length; i++) {
    const m = mask ? mask[i] : 0
    const shade = f.alb[i]
    img.data[i * 4] = Math.max(0, Math.min(255, Math.round(lerp(tr, ar, m) * shade)))
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(lerp(tg, ag, m) * shade)))
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(lerp(tb, ab, m) * shade)))
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return cv
}

// Height → tangent-space normal (Sobel). +Y (OpenGL) green; wraps at edges so
// the derived normal map tiles seamlessly with the albedo/roughness.
function heightToNormalCanvas(h: Float32Array, res: number, strength = 2.2): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = res
  cv.height = res
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(res, res)
  const at = (x: number, y: number) =>
    h[(((y % res) + res) % res) * res + (((x % res) + res) % res)]
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const len = Math.sqrt(dx * dx + dy * dy + 1)
      const nx = -dx / len
      const ny = -dy / len
      const nz = 1 / len
      const i = (y * res + x) * 4
      img.data[i] = Math.round((nx * 0.5 + 0.5) * 255)
      img.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      img.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return cv
}

export interface SurfaceMaps {
  map: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
  roughnessMap: THREE.CanvasTexture
  // shared uniform relief; R3F copies it into each material (safe to share)
  normalScale: THREE.Vector2
}

function applySampler(t: THREE.CanvasTexture) {
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
}

// ---------------------------------------------------------------------------
// FURNITURE path (grayscale albedo, tinted by the mesh colour). Unchanged API.
// ---------------------------------------------------------------------------

// One base map-set per family (repeat = 1). Cheap to keep resident; clones for
// per-mesh tiling share these GPU image sources.
const baseCache = new Map<SurfaceKind, SurfaceMaps>()

function buildBase(kind: SurfaceKind): SurfaceMaps {
  const seed = 0x1000 + kind.length * 131 + kind.charCodeAt(0) * 17
  const f = GEN[kind]({
    seed,
    res: FURNITURE_RES,
    gloss: DEFAULT_GLOSS[kind],
    tiles: kind === 'tile' || kind === 'ceramic' ? 3 : 4,
    pattern: 'plain',
  })
  const map = new THREE.CanvasTexture(fieldToCanvas(f.alb, FURNITURE_RES))
  map.colorSpace = THREE.SRGBColorSpace
  const normalMap = new THREE.CanvasTexture(heightToNormalCanvas(f.h, FURNITURE_RES))
  const roughnessMap = new THREE.CanvasTexture(fieldToCanvas(f.rough, FURNITURE_RES))
  for (const t of [map, normalMap, roughnessMap]) applySampler(t)
  const s = NORMAL_SCALE[kind]
  return { map, normalMap, roughnessMap, normalScale: new THREE.Vector2(s, s) }
}

function getBase(kind: SurfaceKind): SurfaceMaps {
  let b = baseCache.get(kind)
  if (!b) {
    b = buildBase(kind)
    baseCache.set(kind, b)
  }
  return b
}

// Tiled (per-repeat) clones — share the base image source, only sampler state
// (wrap/repeat) differs. Cached so a re-render is a Map lookup, not an allocation.
const tiledCache = new Map<string, SurfaceMaps>()

const qz = (v: number) => Math.max(0.5, Math.min(14, Math.round(v * 2) / 2))

/** Map-set for a furniture surface at a given world-space repeat (tiles in x,y). */
export function surfaceMaps(kind: SurfaceKind, repeatX: number, repeatY: number): SurfaceMaps | null {
  if (typeof document === 'undefined') return null // SSR / test env — fall back to flat colour
  const rx = qz(repeatX)
  const ry = qz(repeatY)
  const key = `${kind}|${rx}|${ry}`
  const cached = tiledCache.get(key)
  if (cached) return cached
  const base = getBase(kind)
  const clone = (t: THREE.CanvasTexture) => {
    const c = t.clone()
    applySampler(c)
    c.repeat.set(rx, ry)
    c.needsUpdate = true
    return c
  }
  const maps: SurfaceMaps = {
    map: clone(base.map),
    normalMap: clone(base.normalMap),
    roughnessMap: clone(base.roughnessMap),
    normalScale: base.normalScale,
  }
  maps.map.colorSpace = THREE.SRGBColorSpace
  tiledCache.set(key, maps)
  return maps
}

/** World-space repeat for a rectangular face of `wCm` × `hCm`, given the family. */
export function repeatForFace(kind: SurfaceKind, wCm: number, hCm: number): [number, number] {
  const rm = REPEAT_M[kind]
  return [Math.max(0.01, wCm / 100) / rm, Math.max(0.01, hCm / 100) / rm]
}

// ---------------------------------------------------------------------------
// ARCHITECTURAL path (colourised albedo for floors / walls). Base maps at
// repeat = 1; floors tile via mesh UVs, clad walls clone the sampler for a
// per-part UV offset (all clones share the ONE cached GPU source).
// ---------------------------------------------------------------------------

export interface ArchOptions {
  tint: string // #rrggbb base colour
  accent: string // #rrggbb secondary (veins / grout / grain)
  gloss: number // 0 matte → 1 mirror; drives the roughness map
  res?: number // ≤ 1024; defaults per kind
  tiles?: number // grid / plank count across one texture tile
  pattern?: 'plain' | 'checker' | 'speckle'
  seed?: number
}

const DEFAULT_ARCH_RES: Record<SurfaceKind, number> = {
  fabric: 256,
  linen: 256,
  wood: 512,
  rug: 256,
  curtain: 256,
  stone: 1024,
  marble: 1024,
  tile: 512,
  laminate: 512,
  metal: 512,
  ceramic: 512,
  leather: 512,
  plaster: 512,
}

const archCache = new Map<string, SurfaceMaps>()

const qg = (v: number) => Math.round(clamp01(v) * 20) / 20 // quantize gloss for the cache key

/**
 * Colourised architectural map-set (albedo + +Y normal + roughness), cached
 * module-level by (kind, tint, accent, gloss, res, tiles, pattern, seed) so the
 * SAME finish shared across every room / wall part reuses ONE GPU source.
 * repeat stays 1 — the caller drives tiling via mesh UVs or clone offsets.
 */
export function architecturalMaps(kind: SurfaceKind, opts: ArchOptions): SurfaceMaps | null {
  if (typeof document === 'undefined') return null
  const res = Math.min(1024, opts.res ?? DEFAULT_ARCH_RES[kind])
  const tiles = opts.tiles ?? (kind === 'ceramic' ? 3 : 4)
  const pattern = opts.pattern ?? 'plain'
  const seed = opts.seed ?? 0x2000 + kind.charCodeAt(0) * 53
  const gloss = qg(opts.gloss)
  const key = `${kind}|${opts.tint}|${opts.accent}|${gloss}|${res}|${tiles}|${pattern}|${seed}`
  const cached = archCache.get(key)
  if (cached) return cached
  const f = GEN[kind]({ seed, res, gloss, tiles, pattern })
  const map = new THREE.CanvasTexture(coloredCanvas(f, res, opts.tint, opts.accent))
  map.colorSpace = THREE.SRGBColorSpace
  const normalMap = new THREE.CanvasTexture(heightToNormalCanvas(f.h, res))
  const roughnessMap = new THREE.CanvasTexture(fieldToCanvas(f.rough, res))
  for (const t of [map, normalMap, roughnessMap]) applySampler(t)
  const s = NORMAL_SCALE[kind]
  const maps: SurfaceMaps = { map, normalMap, roughnessMap, normalScale: new THREE.Vector2(s, s) }
  archCache.set(key, maps)
  return maps
}

// Per-registration sampler clones (share the base GPU source, only repeat/offset
// differ). Cached so N wall parts across N rooms don't re-allocate — and because
// three keys the WebGLTexture by (source, sampler-params) with repeat/offset NOT
// in that key, every clone reuses the ONE base upload. Used for clad-wall
// continuity: one cached architectural source, per-part UV offset (like the floor).
const offsetCache = new Map<string, SurfaceMaps>()

/**
 * A wall part's map-set: the ONE shared `base` map-set (from architecturalMaps /
 * getFloorTexture) with the part's UV `repeat`/`offset` baked into cheap sampler
 * clones. `cacheKey` should identify the finish (e.g. the clad/paint id) so
 * identical registrations across rooms collapse to a single cache entry.
 */
export function offsetMaps(
  cacheKey: string,
  base: SurfaceMaps,
  repeatU: number,
  repeatV: number,
  offsetU: number,
  offsetV: number,
): SurfaceMaps {
  const ru = Math.round(repeatU * 100) / 100
  const rv = Math.round(repeatV * 100) / 100
  const ou = Math.round(offsetU * 100) / 100
  const ov = Math.round(offsetV * 100) / 100
  const ck = `${cacheKey}|${ru}|${rv}|${ou}|${ov}`
  const cached = offsetCache.get(ck)
  if (cached) return cached
  const clone = (t: THREE.CanvasTexture) => {
    const c = t.clone()
    applySampler(c)
    c.repeat.set(ru, rv)
    c.offset.set(ou, ov)
    c.needsUpdate = true
    return c
  }
  const maps: SurfaceMaps = {
    map: clone(base.map),
    normalMap: clone(base.normalMap),
    roughnessMap: clone(base.roughnessMap),
    normalScale: base.normalScale,
  }
  maps.map.colorSpace = THREE.SRGBColorSpace
  offsetCache.set(ck, maps)
  return maps
}

// Test/introspection hook — proves the caches are bounded (do NOT scale per room).
export function _cacheSizes() {
  return {
    base: baseCache.size,
    tiled: tiledCache.size,
    arch: archCache.size,
    offset: offsetCache.size,
  }
}
