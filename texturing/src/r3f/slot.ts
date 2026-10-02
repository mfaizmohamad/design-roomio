/**
 * Agent H — material SLOT targeting (T3 / brief §5). Roomio's parametric builders compose
 * primitive meshes with NO named slots, so to apply a fabric texture to the sofa BODY (and
 * cushions) but NOT the wooden/metal legs or glass, we select target meshes two ways:
 *
 *  - PRECISE (preferred): if meshes carry `userData.role` (once Agent A tags the Box/Cyl
 *    helpers — see roomio.txt REQUEST -> AGENT-A), match the role.
 *  - HEURISTIC (works today): the PRIMARY surface uses the RAW item color, while accents use
 *    shade(color, f) (legs darker), or the METAL/GLASS constants. So for the 'body' slot we
 *    pick dielectric (low-metalness) meshes whose color is CLOSE to the item color — that
 *    catches the body + cushions (a slight shade of the item color) and rejects the darkened
 *    legs (far) and the metal/glass constants (far).
 */
import type { Slot } from '../contract'

export interface MeshDesc {
  /** userData.role if Agent A tags meshes; else undefined (use the heuristic). */
  role?: Slot
  /** the mesh material's color as a #rrggbb hex. */
  colorHex?: string
  roughness?: number
  metalness?: number
}

export interface SlotSelectOptions {
  /** lightness-ratio (mesh.L / item.L) window that counts as 'body'. Accents (legs) are
   *  shade(color, 0.45..0.55) ⇒ ratio ~0.5 (out); body/cushion/top are 0.85..1.18 (in). This
   *  is HUE/SAT-invariant, so it works for dark, pale, and saturated item colors alike. */
  lightnessLo?: number
  lightnessHi?: number
  /** max hue distance (circular, 0..0.5) to count as the same color family. */
  hueTol?: number
  /** max saturation difference to count as the same color family. */
  satTol?: number
  /** meshes at/above this metalness are treated as metal accents, never 'body'. */
  metalnessCut?: number
}

const DEFAULTS: Required<SlotSelectOptions> = {
  // linear-L ratio: legs/feet/frames are shade 0.45–0.55 (out); body/cushion/top/doors are
  // 0.85–1.32 (in). 0.72 cleanly clears the 0.55..0.85 gap.
  lightnessLo: 0.72,
  lightnessHi: 1.5,
  hueTol: 0.09,
  satTol: 0.25,
  metalnessCut: 0.15,
}

function hexToRgb01(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  if (Number.isNaN(n) || h.length !== 6) return [0, 0, 0]
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** [h, s, l] each 0..1. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const dmax = max - min
  if (dmax < 1e-9) return [0, 0, l]
  const s = l > 0.5 ? dmax / (2 - max - min) : dmax / (max + min)
  let h: number
  if (max === r) h = ((g - b) / dmax + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / dmax + 2) / 6
  else h = ((r - g) / dmax + 4) / 6
  return [h, s, l]
}

function hueDist(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2) % 1
  return d > 0.5 ? 1 - d : d
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** HSL computed in LINEAR-sRGB space. Roomio's shade(color, f) operates via THREE.Color,
 *  whose working space is linear, so it multiplies LINEAR lightness by f. Computing L in
 *  linear here makes lightnessRatio == the shade factor exactly, independent of hue/value
 *  (an sRGB-space ratio would vary 0.69–0.78 for the same 0.55 factor due to gamma). */
function hslOf(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb01(hex)
  return rgbToHsl(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b))
}

export function colorDistance(aHex: string, bHex: string): number {
  const a = hexToRgb01(aHex)
  const b = hexToRgb01(bHex)
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/** Lightness ratio mesh.L / item.L (1 = same; ~0.5 = a darkened-leg accent). */
export function lightnessRatio(meshHex: string, itemHex: string): number {
  const [, , lm] = hslOf(meshHex)
  const [, , li] = hslOf(itemHex)
  if (li <= 0.02) return lm <= 0.04 ? 1 : 99
  return lm / li
}

/** Roles that count as the textured 'body' surface (fabric/wood primary face). */
function roleIsBody(role: Slot | undefined): boolean {
  return role === 'body' || role === 'cushion' || role === 'surface'
}

/** Does a mesh belong to the requested slot, using its explicit role? */
function roleMatches(role: Slot | undefined, slot: Slot): boolean {
  if (!role) return false
  if (slot === 'body') return roleIsBody(role)
  return role === slot
}

/** Heuristic: is this mesh the primary 'body' surface (no role tags available)? Keys on the
 *  shade-lightness relationship: body/cushion/top share the item's lightness & color family;
 *  legs/feet/frames are shade(color, ~0.5) (much darker); metal/glass differ in metalness/color. */
export function isPrimaryBody(d: MeshDesc, itemColorHex: string, opts: SlotSelectOptions = {}): boolean {
  const o = { ...DEFAULTS, ...opts }
  if ((d.metalness ?? 0) >= o.metalnessCut) return false // metal accent
  if (d.colorHex == null) return false
  const [hm, sm] = hslOf(d.colorHex)
  const [hi, si] = hslOf(itemColorHex)
  const lr = lightnessRatio(d.colorHex, itemColorHex)
  if (lr < o.lightnessLo || lr > o.lightnessHi) return false // a darkened/strong-shade accent
  if (Math.abs(sm - si) > o.satTol) return false // different color family
  if (Math.min(sm, si) >= 0.08 && hueDist(hm, hi) > o.hueTol) return false // different hue (skip if near-gray)
  return true
}

/**
 * Indices of the meshes to texture for `slot`. If ANY mesh is role-tagged we trust roles
 * (precise); otherwise we use the color heuristic for the 'body' slot (the only slot
 * reliably detectable without roles).
 */
export function selectSlotMeshes(
  descs: MeshDesc[],
  slot: Slot,
  itemColorHex: string,
  opts: SlotSelectOptions = {},
): number[] {
  const hasRoles = descs.some((d) => d.role != null)
  const out: number[] = []
  descs.forEach((d, i) => {
    const hit = hasRoles ? roleMatches(d.role, slot) : slot === 'body' && isPrimaryBody(d, itemColorHex, opts)
    if (hit) out.push(i)
  })
  return out
}
