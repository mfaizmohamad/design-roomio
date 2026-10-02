import type { CameraPath, ControlPoint, Vec3 } from '../contract/pathSchema'
import { PATH_DEFAULTS } from '../contract/pathSchema'

/**
 * F4 — Walk-and-record path.
 *
 * A manual first-person walk (F1) samples the camera position at a fixed
 * interval. Those samples are too dense to use directly — feeding hundreds of
 * near-collinear points into a Catmull-Rom spline makes it jittery. So we
 * DECIMATE to a sensible handful of control points with Ramer–Douglas–Peucker
 * (keeps corners, drops redundant straight-line samples), then feed the result
 * into the SAME CameraPath the waypoint authoring (F3) produces — both modes
 * converge on one artifact.
 */

type P3 = [number, number, number]

/** Perpendicular distance from point p to the 3D line through a→b. */
function perpDistance(p: P3, a: P3, b: P3): number {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const abz = b[2] - a[2]
  const apx = p[0] - a[0]
  const apy = p[1] - a[1]
  const apz = p[2] - a[2]
  const abLen2 = abx * abx + aby * aby + abz * abz
  if (abLen2 < 1e-12) {
    // a==b: distance to the point
    return Math.hypot(apx, apy, apz)
  }
  // cross(ap, ab) magnitude / |ab|
  const cx = apy * abz - apz * aby
  const cy = apz * abx - apx * abz
  const cz = apx * aby - apy * abx
  return Math.sqrt((cx * cx + cy * cy + cz * cz) / abLen2)
}

/** Ramer–Douglas–Peucker simplification of a polyline (epsilon in meters). */
export function rdp(points: P3[], epsilon: number): P3[] {
  if (points.length < 3) return points.slice()
  let maxD = 0
  let idx = 0
  const a = points[0]
  const b = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], a, b)
    if (d > maxD) {
      maxD = d
      idx = i
    }
  }
  if (maxD > epsilon) {
    const left = rdp(points.slice(0, idx + 1), epsilon)
    const right = rdp(points.slice(idx), epsilon)
    return left.slice(0, -1).concat(right)
  }
  return [a, b]
}

export interface DecimateOpts {
  /** start tolerance in meters (default 0.12) */
  epsilon?: number
  /** hard cap on control points; tolerance grows until satisfied (default 14) */
  maxPoints?: number
  /** drop samples closer than this (m) before RDP to kill jitter (default 0.04) */
  minSpacing?: number
}

/** Decimate dense walk samples to a smooth set of control points. */
export function decimateWalk(samples: P3[], opts: DecimateOpts = {}): P3[] {
  const minSpacing = opts.minSpacing ?? 0.04
  const maxPoints = opts.maxPoints ?? 14
  let epsilon = opts.epsilon ?? 0.12

  if (samples.length <= 2) return samples.slice()

  // 1) thin out near-duplicate consecutive samples (sub-step jitter)
  const thinned: P3[] = [samples[0]]
  for (let i = 1; i < samples.length; i++) {
    const last = thinned[thinned.length - 1]
    const d = Math.hypot(samples[i][0] - last[0], samples[i][1] - last[1], samples[i][2] - last[2])
    if (d >= minSpacing) thinned.push(samples[i])
  }
  // always keep the final sample so the path ends where the walk ended
  const lastSample = samples[samples.length - 1]
  const lastKept = thinned[thinned.length - 1]
  if (lastKept[0] !== lastSample[0] || lastKept[1] !== lastSample[1] || lastKept[2] !== lastSample[2]) {
    thinned.push(lastSample)
  }
  if (thinned.length <= 2) return thinned

  // 2) RDP, growing tolerance until we're under the cap (fewer = smoother)
  let result = rdp(thinned, epsilon)
  let guard = 0
  while (result.length > maxPoints && guard++ < 24) {
    epsilon *= 1.5
    result = rdp(thinned, epsilon)
  }
  return result
}

/** Convert dense walk samples into the shared CameraPath artifact. */
export function samplesToCameraPath(
  samples: P3[],
  meta: Partial<CameraPath> & { decimate?: DecimateOpts } = {},
): CameraPath {
  const pts = decimateWalk(samples, meta.decimate)
  const controlPoints: ControlPoint[] = pts.map((p) => ({
    position: [p[0], p[1], p[2]] as Vec3,
    lookAt: null, // recorded walks use look-ahead for smooth turning
    dwell: 0,
  }))
  return {
    version: '1.0',
    name: meta.name ?? 'Recorded walk',
    designId: meta.designId ?? null,
    coordinateSpace: 'world-meters',
    fps: meta.fps ?? PATH_DEFAULTS.fps,
    duration: meta.duration ?? PATH_DEFAULTS.duration,
    loop: meta.loop ?? false,
    eyeHeight: meta.eyeHeight ?? PATH_DEFAULTS.eyeHeight,
    lookAheadEps: meta.lookAheadEps ?? PATH_DEFAULTS.lookAheadEps,
    fov: meta.fov ?? PATH_DEFAULTS.fov,
    controlPoints,
  }
}
