// Canonical internal unit is CENTIMETERS. World/3D unit is METERS (cm / 100).
export type Unit = 'ft' | 'cm'

export const CM_PER_M = 100
export const CM_PER_IN = 2.54
export const CM_PER_FT = 30.48

/**
 * Real-world clamp for a single wall / room dimension, in cm.
 *  - MIN keeps a wall usable (matches the store's long-standing 60 cm floor).
 *  - MAX (30 m) keeps the footprint framable so a fat-finger typo (e.g. 999999)
 *    can never blow the room past the viewport and blank the workspace.
 */
export const MIN_WALL_CM = 60
export const MAX_WALL_CM = 3000

/**
 * Ceiling-height bounds (cm). MAX is 600, not a single-storey 400, because a duplex's
 * double-height living hall is ~5.5–5.8m. At 400 the Sky Duplex preset (and any
 * user matching one) would be silently squashed and its mezzanine (hung at 2.8m + a
 * 1.35m railing) would punch through the ceiling.
 */
export const MIN_WALL_HEIGHT_CM = 180
export const MAX_WALL_HEIGHT_CM = 600

/** Clamp a ceiling height (cm) into [MIN_WALL_HEIGHT_CM, MAX_WALL_HEIGHT_CM]. */
export function clampWallHeight(cm: number): number {
  return Math.min(MAX_WALL_HEIGHT_CM, Math.max(MIN_WALL_HEIGHT_CM, cm))
}

/** Clamp a length (cm) into the real-world wall range [MIN_WALL_CM, MAX_WALL_CM]. */
export function clampWallLength(cm: number): number {
  return Math.min(MAX_WALL_CM, Math.max(MIN_WALL_CM, cm))
}

export const toM = (cm: number): number => cm / CM_PER_M
export const toCm = (m: number): number => m * CM_PER_M

/** Format a length in cm to a human string in the chosen unit. */
export function formatLen(cm: number, unit: Unit): string {
  if (unit === 'cm') {
    return `${Math.round(cm)} cm`
  }
  // feet + inches, e.g. 19' 8"
  const totalIn = cm / CM_PER_IN
  let ft = Math.floor(totalIn / 12)
  let inch = Math.round(totalIn - ft * 12)
  if (inch === 12) {
    ft += 1
    inch = 0
  }
  return `${ft}' ${inch}"`
}

/** Compact label (no unit suffix) used on small dimension tags. */
export function formatLenShort(cm: number, unit: Unit): string {
  if (unit === 'cm') return `${Math.round(cm)}`
  const totalIn = cm / CM_PER_IN
  let ft = Math.floor(totalIn / 12)
  let inch = Math.round(totalIn - ft * 12)
  if (inch === 12) {
    ft += 1
    inch = 0
  }
  return `${ft}' ${inch}"`
}

/** parseFloat that returns null for NaN / non-finite results (e.g. a bare "."). */
function toNum(s: string): number | null {
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse a user-typed length string into cm.
 * Accepts: "350" (cm if unit=cm), "11' 6\"", "11ft 6in", "11.5'", "350cm", "3.5m".
 * Returns null if unparseable (including NaN-yielding input like a bare ".").
 */
export function parseLen(input: string, unit: Unit): number | null {
  const s = input.trim().toLowerCase()
  if (!s) return null

  // explicit cm / m
  let m = s.match(/^([\d.]+)\s*cm$/)
  if (m) return toNum(m[1])
  m = s.match(/^([\d.]+)\s*m$/)
  if (m) {
    const n = toNum(m[1])
    return n == null ? null : n * CM_PER_M
  }

  // feet+inches: 11' 6", 11ft 6in, 11'6, 11 6
  m = s.match(/^([\d.]+)\s*(?:'|ft|feet|f)\s*([\d.]+)?\s*(?:"|in|inch|inches)?$/)
  if (m) {
    const ft = toNum(m[1])
    if (ft == null) return null
    const inch = m[2] ? toNum(m[2]) : 0
    if (inch == null) return null
    return (ft * 12 + inch) * CM_PER_IN
  }
  // inches only: 24"
  m = s.match(/^([\d.]+)\s*(?:"|in|inch|inches)$/)
  if (m) {
    const n = toNum(m[1])
    return n == null ? null : n * CM_PER_IN
  }

  // bare number → interpret in current unit
  m = s.match(/^([\d.]+)$/)
  if (m) {
    const n = toNum(m[1])
    if (n == null) return null
    return unit === 'cm' ? n : n * CM_PER_FT // bare number in ft mode = feet
  }
  return null
}
