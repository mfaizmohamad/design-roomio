// Color temperature (Kelvin) -> RGB hex. Pure, dependency-free.
// Based on the widely-used Tanner Helland blackbody approximation, clamped to a
// design-friendly range. Used for the warm/cool light toggle and the sun's
// warmth-shift toward dawn/dusk.

import { clamp } from '../../shared/lib/math'

export type Warmth = 'warm' | 'neutral' | 'cool'

/** UI presets -> Kelvin. warm = cozy incandescent, cool = daylight. */
export const WARMTH_KELVIN: Record<Warmth, number> = {
  warm: 2700,
  neutral: 4000,
  cool: 5200,
}

function toHex2(v: number): string {
  return clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')
}

/** Kelvin (1000..12000) -> {r,g,b} 0..255. */
export function kelvinToRgb(kelvin: number): { r: number; g: number; b: number } {
  const t = clamp(kelvin, 1000, 12000) / 100
  let r: number
  let g: number
  let b: number

  // Red
  if (t <= 66) {
    r = 255
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592)
  }

  // Green
  if (t <= 66) {
    g = 99.4708025861 * Math.log(t) - 161.1195681661
  } else {
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  }

  // Blue
  if (t >= 66) {
    b = 255
  } else if (t <= 19) {
    b = 0
  } else {
    b = 138.5177312231 * Math.log(t - 10) - 305.0447927307
  }

  return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255) }
}

/** Kelvin -> '#rrggbb'. */
export function kelvinToHex(kelvin: number): string {
  const { r, g, b } = kelvinToRgb(kelvin)
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`
}

/** Warmth preset -> '#rrggbb'. */
export function warmthToHex(warmth: Warmth): string {
  return kelvinToHex(WARMTH_KELVIN[warmth])
}

/** Linear interpolate two Kelvin values (for the sun's smooth warmth shift). */
export function lerpKelvin(a: number, b: number, tt: number): number {
  return a + (b - a) * clamp(tt, 0, 1)
}
