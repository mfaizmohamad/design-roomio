/**
 * TypeScript mirror of /shared/camera_path_schema.json (v1.0).
 * The hand-off artifact between authoring (F3/F4) and playback/capture (F5/F6).
 */

export type Vec3 = [number, number, number]

export interface ControlPoint {
  /** [x, y, z] camera position, world meters. y = eye height. */
  position: Vec3
  /** optional explicit world-meter look target; null => curve look-ahead */
  lookAt?: Vec3 | null
  /** seconds to pause at this point during playback (default 0) */
  dwell?: number
}

export interface CameraPath {
  version: '1.0'
  name?: string
  designId?: string | null
  coordinateSpace: 'world-meters'
  /** frames per second for deterministic capture (F6) */
  fps: number
  /** total travel seconds at constant arc-length speed (excludes dwell) */
  duration: number
  loop?: boolean
  /** default eye height (m) for floor-authored points */
  eyeHeight?: number
  /** look-ahead fraction for smooth turning (default 0.02) */
  lookAheadEps?: number
  /** recording camera vertical FOV in degrees (default 60) */
  fov?: number
  controlPoints: ControlPoint[]
}

export const PATH_DEFAULTS = {
  version: '1.0' as const,
  coordinateSpace: 'world-meters' as const,
  fps: 30,
  duration: 8,
  loop: false,
  eyeHeight: 1.6,
  lookAheadEps: 0.02,
  fov: 60,
}

/** Build a fresh, valid empty path with sane defaults. */
export function emptyPath(name = 'Untitled path'): CameraPath {
  return {
    version: '1.0',
    name,
    designId: null,
    coordinateSpace: 'world-meters',
    fps: PATH_DEFAULTS.fps,
    duration: PATH_DEFAULTS.duration,
    loop: PATH_DEFAULTS.loop,
    eyeHeight: PATH_DEFAULTS.eyeHeight,
    lookAheadEps: PATH_DEFAULTS.lookAheadEps,
    fov: PATH_DEFAULTS.fov,
    controlPoints: [],
  }
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
  /** the normalized path (defaults filled) when ok */
  path?: CameraPath
}

function isVec3(v: unknown): v is Vec3 {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}

/**
 * Validate + normalize an untrusted object into a CameraPath. Lenient on
 * additive/unknown fields (additionalProperties:true in the schema), strict on
 * the shape that playback/capture relies on. Fills defaults so consumers can
 * read fps/duration/eyeHeight/lookAheadEps/fov unconditionally.
 */
export function validatePath(input: unknown): ValidationResult {
  const errors: string[] = []
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['path must be a JSON object'] }
  }
  const o = input as Record<string, unknown>

  if (o.version !== '1.0') errors.push(`version must be "1.0" (got ${JSON.stringify(o.version)})`)
  if (o.coordinateSpace !== undefined && o.coordinateSpace !== 'world-meters') {
    errors.push('coordinateSpace must be "world-meters"')
  }

  const cps = o.controlPoints
  if (!Array.isArray(cps)) {
    errors.push('controlPoints must be an array')
  } else if (cps.length < 2) {
    errors.push('controlPoints must have at least 2 points')
  }

  const normPoints: ControlPoint[] = []
  if (Array.isArray(cps)) {
    cps.forEach((cp, i) => {
      if (typeof cp !== 'object' || cp === null) {
        errors.push(`controlPoints[${i}] must be an object`)
        return
      }
      const c = cp as Record<string, unknown>
      if (!isVec3(c.position)) {
        errors.push(`controlPoints[${i}].position must be [x,y,z] finite numbers`)
        return
      }
      const lookAt = c.lookAt === undefined || c.lookAt === null ? null : c.lookAt
      if (lookAt !== null && !isVec3(lookAt)) {
        errors.push(`controlPoints[${i}].lookAt must be [x,y,z] or null`)
        return
      }
      const dwell = typeof c.dwell === 'number' && c.dwell >= 0 ? c.dwell : 0
      normPoints.push({ position: c.position, lookAt, dwell })
    })
  }

  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const fps = num(o.fps, PATH_DEFAULTS.fps)
  const duration = num(o.duration, PATH_DEFAULTS.duration)
  if (fps <= 0) errors.push('fps must be > 0')
  if (duration <= 0) errors.push('duration must be > 0')

  if (errors.length) return { ok: false, errors }

  const path: CameraPath = {
    version: '1.0',
    name: typeof o.name === 'string' ? o.name : 'Untitled path',
    designId: typeof o.designId === 'string' ? o.designId : null,
    coordinateSpace: 'world-meters',
    fps,
    duration,
    loop: o.loop === true,
    eyeHeight: num(o.eyeHeight, PATH_DEFAULTS.eyeHeight),
    lookAheadEps: Math.min(0.5, Math.max(0, num(o.lookAheadEps, PATH_DEFAULTS.lookAheadEps))),
    fov: num(o.fov, PATH_DEFAULTS.fov),
    controlPoints: normPoints,
  }
  return { ok: true, errors: [], path }
}
