// Pure sun model: (timeOfDay, northOffset) -> sun position / intensity / color.
// No real geolocation — the time bar drives the sun directly (per the brief).
// Implements the brief's dome mapping exactly, with maxElevation given in DEGREES
// (schema uses maxElevationDeg) and converted to radians internally.

import { kelvinToHex, lerpKelvin } from './colorTemp'
import { clamp01, DEG2RAD } from '../../shared/lib/math'

export interface SunSample {
  /** world-meter position [x,y,z] on the dome around house center. */
  position: [number, number, number]
  /** 0..1 brightness factor (max(0,sin(time*pi))); multiply by base intensity. */
  intensityFactor: number
  /** elevation above horizon, radians (0 at dawn/dusk, peak at noon). */
  elevationRad: number
  /** azimuth used (radians), already including northOffset. */
  azimuthRad: number
  /** warmth-shifted hex color for the sun light. */
  color: string
  /** true when the sun is at/below the horizon (night) -> caller can disable shadows. */
  belowHorizon: boolean
}

export interface SunOptions {
  /** peak elevation at noon, degrees. */
  maxElevationDeg?: number
  /** north rotation added to azimuth, degrees (+180 = reversed). */
  northOffsetDeg?: number
  /** dome radius in meters (distance of the sun from house center). */
  domeRadiusM?: number
  /** apply dawn/dusk warming + cooling toward noon. */
  warmthShift?: boolean
}

/**
 * Sample the sun for a given time of day.
 * @param time 0..1 across the day (0 dawn, 0.5 noon, 1 dusk).
 */
export function sampleSun(time: number, opts: SunOptions = {}): SunSample {
  const maxElevationDeg = opts.maxElevationDeg ?? 60
  const northOffset = (opts.northOffsetDeg ?? 0) * DEG2RAD
  const r = opts.domeRadiusM ?? 30
  const warmthShift = opts.warmthShift ?? true

  const t = clamp01(time)
  const maxElev = maxElevationDeg * DEG2RAD

  // Brief mapping: elevation low at dawn/dusk, peak at noon; azimuth sweeps across.
  const elev = Math.sin(t * Math.PI) * maxElev
  const az = t * Math.PI - Math.PI / 2 + northOffset

  const position: [number, number, number] = [
    r * Math.cos(elev) * Math.sin(az),
    r * Math.sin(elev),
    r * Math.cos(elev) * Math.cos(az),
  ]

  // Brightness: full at noon, fades to 0 at the horizon / night.
  const intensityFactor = Math.max(0, Math.sin(t * Math.PI))

  // Warmth: amber near the horizon, neutral-cool near noon.
  // elevFactor 0 (horizon) -> ~2200K, 1 (noon) -> ~5600K.
  const elevFactor = clamp01(Math.sin(t * Math.PI))
  const kelvin = warmthShift ? lerpKelvin(2200, 5600, smoothstep(elevFactor)) : 5600
  const color = kelvinToHex(kelvin)

  return {
    position,
    intensityFactor,
    elevationRad: elev,
    azimuthRad: az,
    color,
    belowHorizon: intensityFactor <= 0.0001,
  }
}

/** Smoothstep for a gentler warmth ramp near the horizon. */
function smoothstep(x: number): number {
  const c = clamp01(x)
  return c * c * (3 - 2 * c)
}
