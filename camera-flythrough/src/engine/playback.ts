import * as THREE from 'three'
import type { CameraPath } from '../contract/pathSchema'
import { PATH_DEFAULTS } from '../contract/pathSchema'

/**
 * F5 — Playback along the path.
 *
 * Consumes the shared CameraPath artifact (the same JSON authoring writes and
 * capture reads), builds an arc-length-parameterized CatmullRomCurve3, and
 * drives a camera along it:
 *   - position = curve.getPointAt(u)  (arc length ⇒ CONSTANT speed)
 *   - look target = explicit per-point look-at if set, else a look-ahead point
 *     (getPointAt(u+ε)) so the camera anticipates bends and turns smoothly
 *   - per-point dwell holds position for N seconds (look target eases between
 *     neighbouring points across each travel segment)
 *
 * Deterministic: sampleAt(τ) is a pure function of global time τ, so the same
 * τ always yields the same pose — which is exactly what frame-by-frame capture
 * (F6) relies on. play / pause / seek operate on τ.
 */

interface Stop {
  u: number // arc-length param 0..1 of this control point
  target: THREE.Vector3 // world-meter look target at this point
  dwell: number // seconds to hold here
}

export interface Pose {
  position: THREE.Vector3
  target: THREE.Vector3
  /** fraction of the full curve, 0..1 (for the gizmo/scrubber) */
  u: number
}

export class Playback {
  private curve: THREE.CatmullRomCurve3 | null = null
  private stops: Stop[] = []
  private duration = PATH_DEFAULTS.duration
  private loop = false
  private fov = PATH_DEFAULTS.fov
  private totalTime = 0
  private tau = 0
  private playing = false

  /** Build playback state from a CameraPath. Returns false if too few points. */
  setPath(path: CameraPath): boolean {
    const cps = path.controlPoints
    if (cps.length < 2) {
      this.curve = null
      this.stops = []
      this.totalTime = 0
      return false
    }
    this.duration = path.duration
    this.loop = path.loop ?? false
    this.fov = path.fov ?? PATH_DEFAULTS.fov
    const eps = path.lookAheadEps ?? PATH_DEFAULTS.lookAheadEps

    const pts = cps.map((c) => new THREE.Vector3(c.position[0], c.position[1], c.position[2]))
    this.curve = new THREE.CatmullRomCurve3(pts, this.loop, 'centripetal')
    this.curve.arcLengthDivisions = 1000

    const n = cps.length
    const lengths = this.curve.getLengths(1000)
    const total = lengths[lengths.length - 1] || 1

    // arc-length param u_i for each control point (mapped from its natural t_i)
    const tOf = (i: number) => (this.loop ? i / n : i / (n - 1))
    const uAt = (t: number) => {
      const D = lengths.length - 1
      const f = t * D
      const lo = Math.floor(f)
      const hi = Math.min(lo + 1, D)
      const frac = f - lo
      const L = lengths[lo] + (lengths[hi] - lengths[lo]) * frac
      return L / total
    }

    const uOf: number[] = []
    for (let i = 0; i < n; i++) uOf.push(uAt(tOf(i)))

    // per-point look target: explicit, else look-ahead along the curve
    const targetOf = (i: number): THREE.Vector3 => {
      const c = cps[i]
      if (c.lookAt) return new THREE.Vector3(c.lookAt[0], c.lookAt[1], c.lookAt[2])
      const u = uOf[i]
      let ahead = u + eps
      if (!this.loop && ahead >= 1) {
        // open-curve end: look along the tangent so we don't aim at ourselves
        const pos = this.curve!.getPointAt(Math.min(u, 1))
        const tan = this.curve!.getTangentAt(Math.min(u, 1)).multiplyScalar(0.5)
        return pos.add(tan)
      }
      if (this.loop) ahead = ahead % 1
      return this.curve!.getPointAt(Math.max(0, Math.min(ahead, 1)))
    }

    this.stops = []
    for (let i = 0; i < n; i++) {
      this.stops.push({ u: uOf[i], target: targetOf(i), dwell: Math.max(0, cps[i].dwell ?? 0) })
    }
    if (this.loop) {
      // closing travel back to the start point
      this.stops.push({ u: 1, target: this.stops[0].target.clone(), dwell: 0 })
    }

    this.totalTime = this.duration + this.stops.reduce((s, st) => s + st.dwell, 0)
    this.tau = 0
    return true
  }

  hasPath() {
    return this.curve !== null
  }
  getFov() {
    return this.fov
  }
  getTotalTime() {
    return this.totalTime
  }

  // ---- transport ----
  play() {
    if (this.curve) this.playing = true
  }
  pause() {
    this.playing = false
  }
  toggle() {
    this.playing ? this.pause() : this.play()
  }
  isPlaying() {
    return this.playing
  }
  stop() {
    this.playing = false
    this.tau = 0
  }
  /** scrub to normalized progress 0..1 of the full timeline (incl. dwell). */
  seek(p01: number) {
    this.tau = Math.max(0, Math.min(1, p01)) * this.totalTime
  }
  progress01() {
    return this.totalTime > 0 ? this.tau / this.totalTime : 0
  }

  /** Advance the clock. Returns true while still playing. */
  update(dt: number): boolean {
    if (!this.playing || !this.curve) return false
    this.tau += dt
    if (this.tau >= this.totalTime) {
      if (this.loop) this.tau = this.tau % this.totalTime
      else {
        this.tau = this.totalTime
        this.playing = false
      }
    }
    return this.playing
  }

  /** Pure: pose at global time τ (seconds). */
  sampleAt(tau: number): Pose | null {
    if (!this.curve || this.stops.length === 0) return null
    let t = this.loop ? ((tau % this.totalTime) + this.totalTime) % this.totalTime : Math.max(0, Math.min(tau, this.totalTime))
    const stops = this.stops
    for (let k = 0; k < stops.length; k++) {
      // hold at stop k
      if (t <= stops[k].dwell) {
        return { u: stops[k].u, position: this.curve.getPointAt(stops[k].u), target: stops[k].target.clone() }
      }
      t -= stops[k].dwell
      if (k < stops.length - 1) {
        const seg = (stops[k + 1].u - stops[k].u) * this.duration
        if (t <= seg || k === stops.length - 2) {
          const f = seg > 1e-9 ? Math.max(0, Math.min(t / seg, 1)) : 1
          const u = stops[k].u + (stops[k + 1].u - stops[k].u) * f
          const target = stops[k].target.clone().lerp(stops[k + 1].target, f)
          return { u, position: this.curve.getPointAt(Math.min(u, 1)), target }
        }
        t -= seg
      }
    }
    const last = stops[stops.length - 1]
    return { u: last.u, position: this.curve.getPointAt(last.u), target: last.target.clone() }
  }

  /** Current pose at the playhead. */
  currentPose(): Pose | null {
    return this.sampleAt(this.tau)
  }

  /** Apply the current pose to a camera (sets position + lookAt; fov once). */
  applyToCamera(camera: THREE.PerspectiveCamera) {
    const pose = this.currentPose()
    if (!pose) return
    camera.position.copy(pose.position)
    camera.up.set(0, 1, 0)
    camera.lookAt(pose.target)
    if (camera.fov !== this.fov) {
      camera.fov = this.fov
      camera.updateProjectionMatrix()
    }
  }

  /** Apply a specific normalized progress (for capture stepping). */
  applyProgress(p01: number, camera: THREE.PerspectiveCamera) {
    this.tau = Math.max(0, Math.min(1, p01)) * this.totalTime
    this.applyToCamera(camera)
  }
  set tauSeconds(v: number) {
    this.tau = v
  }
  get tauSeconds() {
    return this.tau
  }
}
