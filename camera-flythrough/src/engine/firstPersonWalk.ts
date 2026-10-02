import * as THREE from 'three'
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js'
import type { SceneHandle, Vec2 } from '../contract/sceneContract'
import { resolveWalk } from './collision'
import { pointInPolygon } from './geometry'

/**
 * F1 — First-person walk.
 *
 * PointerLockControls for mouse-look + WASD movement at a fixed eye height
 * (~1.6 m), with collision against the live colliders (walls + furniture
 * footprints) so you can't pass through anything. Movement is proposed in world
 * meters, resolved in design cm by the shared footprint solver, then written
 * back — so you slide along walls instead of stopping dead.
 *
 * Owns its OWN camera (never hijacks the user's OrbitControls camera). The host
 * renders `controller.camera` while walk mode is active.
 */

export interface FirstPersonWalkOpts {
  eyeHeight?: number // meters (default 1.6)
  speed?: number // meters/sec (default 2.6)
  bodyRadius?: number // cm (default 18)
}

/**
 * Largest floor-height change (cm) one move may make. Per-frame moves are a few
 * cm, so walking up a flight changes the floor by far less; stepping off a
 * flight's side or into a void changes it by a storey — refused.
 */
const MAX_STEP_CM = 45

/** Drag-to-look sensitivity multiplier (touch). A finger travels further than a
 *  mouse for the same intent, so 1.0 felt sluggish on a phone. */
const LOOK_SPEED = 1.4

export class FirstPersonWalk {
  readonly camera: THREE.PerspectiveCamera
  readonly controls: PointerLockControls
  private handle: SceneHandle
  private eyeHeight: number
  private speed: number
  private bodyRadius: number
  private keys = new Set<string>()
  private active = false
  private posCm: Vec2 = { x: 0, z: 0 }
  /** floor under the walker, cm above the ground floor (stairs / upper storeys) */
  private floorCm = 0
  private fwd = new THREE.Vector3()
  private right = new THREE.Vector3()
  private up = new THREE.Vector3(0, 1, 0)

  /** trajectory samples (world meters [x,y,z]) for F4 walk-and-record */
  private recording = false
  private samples: Array<[number, number, number]> = []
  private sampleAccum = 0
  private sampleInterval = 0.08 // seconds between samples while recording

  constructor(handle: SceneHandle, opts: FirstPersonWalkOpts = {}) {
    this.handle = handle
    this.eyeHeight = opts.eyeHeight ?? 1.6
    this.speed = opts.speed ?? 2.6
    this.bodyRadius = opts.bodyRadius ?? 18
    const aspect = (handle.size?.width ?? 1) / (handle.size?.height ?? 1) || 1
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.05, 200)
    this.controls = new PointerLockControls(this.camera, handle.domElement)
  }

  private onKeyDown = (e: KeyboardEvent) => this.keys.add(e.code)
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code)

  /**
   * Enter walk mode. Places the camera at `startCm` (cm) when given, else at the
   * clear spot nearest `preferNearCm` (e.g. a chosen room's centre), else nearest
   * the house/room centre.
   */
  enable(startCm?: Vec2, preferNearCm?: Vec2, faceDir?: Vec2, floorHintCm = 0) {
    if (this.active) return
    this.active = true
    if (this.handle.controls) this.handle.controls.enabled = false
    this.placeAt(startCm ?? this.findSpawn(preferNearCm, floorHintCm), floorHintCm)
    // start LEVEL at eye height (no inherited pitch/roll). The user mouse-looks
    // from here; the key fix is that we no longer enter pitched down/up.
    this.camera.up.set(0, 1, 0)
    this.camera.rotation.set(0, 0, 0)
    this.faceToward(faceDir)
    this.camera.quaternion.setFromEuler(this.camera.rotation)
    const aspect = (this.handle.size?.width ?? 1) / (this.handle.size?.height ?? 1) || 1
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
  }

  /** Jump an active walker to the clear spot nearest `preferNearCm` (e.g. "go to
   *  this room"), facing level. No-op when walk mode is off. */
  teleport(preferNearCm: Vec2, floorHintCm = 0) {
    if (!this.active) return
    this.placeAt(this.findSpawn(preferNearCm, floorHintCm), floorHintCm)
  }

  /**
   * Turn (yaw only, level gaze) to face a direction in design cm. design→world is
   * a pure translate + scale (frameFns), so the direction carries over unchanged.
   * A three camera looks down -Z at yaw 0, so forward(yaw) = (-sin, -cos).
   */
  private faceToward(dir?: Vec2) {
    if (!dir || (dir.x === 0 && dir.z === 0)) return
    this.camera.rotation.set(0, Math.atan2(-dir.x, -dir.z), 0, 'YXZ')
  }

  /**
   * `floorHintCm` is the storey the caller means (an upstairs room's elevation).
   * floorAt resolves overlapping storeys relative to the current floor, so asking
   * from 0 for a spot that has a room on BOTH storeys always answered the ground
   * floor — "go to Bedroom 3" landed the walker downstairs.
   */
  private placeAt(start: Vec2, floorHintCm = 0) {
    this.posCm = { ...start }
    this.floorCm = this.handle.floorAt?.(start.x, start.z, floorHintCm) ?? floorHintCm
    const [wx, wz] = this.frameFns().toWorld(start.x, start.z)
    this.camera.position.set(wx, this.eyeY(), wz)
  }

  /**
   * Request pointer lock (must be from a user gesture, e.g. a click). Skipped where
   * pointer lock does not exist (iOS Safari): three's PointerLockControls would
   * call the missing requestPointerLock and throw on every tap. Touch devices look
   * around with look() instead.
   */
  lock() {
    if (!this.active) return
    const el = this.handle.domElement as HTMLElement & { requestPointerLock?: unknown }
    if (typeof el.requestPointerLock !== 'function') return
    this.controls.lock()
  }

  /**
   * On-screen controls (touch): press/release a movement key exactly as the
   * keyboard would — 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD'.
   */
  setVirtualKey(code: string, down: boolean) {
    if (down && this.active) this.keys.add(code)
    else this.keys.delete(code)
  }

  /**
   * Drag-to-look (touch): rotate by a pointer delta in CSS pixels. Same maths and
   * sensitivity as PointerLockControls' mouse-look (YXZ Euler, 0.002 rad/px), with
   * pitch clamped just short of straight up/down so the view never flips.
   */
  look(dxPx: number, dyPx: number) {
    if (!this.active) return
    const e = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(this.camera.quaternion)
    e.y -= dxPx * 0.002 * LOOK_SPEED
    e.x -= dyPx * 0.002 * LOOK_SPEED
    const limit = Math.PI / 2 - 0.05
    e.x = Math.max(-limit, Math.min(limit, e.x))
    this.camera.quaternion.setFromEuler(e)
  }

  disable() {
    if (!this.active) return
    this.active = false
    this.recording = false
    this.keys.clear()
    if (this.controls.isLocked) this.controls.unlock()
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    if (this.handle.controls) this.handle.controls.enabled = true
  }

  isActive() {
    return this.active
  }

  /** Advance one frame. Returns this camera so the host can render it. */
  update(dt: number): THREE.PerspectiveCamera {
    if (!this.active) return this.camera

    // Re-assert eye height + planar position from our OWN source of truth (posCm)
    // every frame. The host's OrbitControls can transiently clobber the camera
    // when it's swapped in; this keeps the walker pinned at eye height and where
    // it actually is, independent of any external camera manipulation.
    {
      const f = this.frameFns()
      const [cwx, cwz] = f.toWorld(this.posCm.x, this.posCm.z)
      this.camera.position.set(cwx, this.eyeY(), cwz)
    }

    // horizontal forward / right from the look direction
    this.camera.getWorldDirection(this.fwd)
    this.fwd.y = 0
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1)
    this.fwd.normalize()
    this.right.crossVectors(this.fwd, this.up).normalize()

    let mz = 0
    let mx = 0
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz += 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1

    if (mx !== 0 || mz !== 0) {
      const len = Math.hypot(mx, mz)
      const step = (this.speed * dt) / len
      const dxW = (this.fwd.x * mz + this.right.x * mx) * step
      const dzW = (this.fwd.z * mz + this.right.z * mx) * step
      const f = this.frameFns()
      // advance from our tracked position (posCm), NOT camera.position — the
      // latter can be transiently clobbered by the host's controls.
      const [curWx, curWz] = f.toWorld(this.posCm.x, this.posCm.z)
      const proposedCm = f.fromWorld(curWx + dxW, curWz + dzW)
      const colliders = this.handle.getColliders?.(this.floorCm)
      const resolved = colliders
        ? resolveWalk(this.posCm, { x: proposedCm[0], z: proposedCm[1] }, colliders, {
            radius: this.bodyRadius,
          })
        : { x: proposedCm[0], z: proposedCm[1] }
      // Follow the floor (stair treads, landings, upper storeys). A move whose
      // floor differs by more than one step is refused — that is what keeps you
      // ON a flight (no dropping off its open side, no hopping the U-stair's
      // central wall) and stops you walking off an upper storey into a void.
      const floor = this.handle.floorAt ? this.handle.floorAt(resolved.x, resolved.z, this.floorCm) : 0
      if (floor !== null && Math.abs(floor - this.floorCm) <= MAX_STEP_CM) {
        this.posCm = resolved
        this.floorCm = floor
      }
      const [nx, nz] = f.toWorld(this.posCm.x, this.posCm.z)
      this.camera.position.set(nx, this.eyeY(), nz)
    }

    if (this.recording) {
      this.sampleAccum += dt
      if (this.sampleAccum >= this.sampleInterval) {
        this.sampleAccum = 0
        this.samples.push([this.camera.position.x, this.camera.position.y, this.camera.position.z])
      }
    }
    return this.camera
  }

  // --- F4 walk-and-record hooks ---
  startRecording() {
    this.samples = [
      [this.camera.position.x, this.camera.position.y, this.camera.position.z],
    ]
    this.sampleAccum = 0
    this.recording = true
  }
  stopRecording(): Array<[number, number, number]> {
    this.recording = false
    return this.samples.slice()
  }
  isRecording() {
    return this.recording
  }

  /**
   * Pick a spawn point that's inside the room AND clear of furniture, so the
   * walker doesn't start jammed against a piece (which makes collision eject it
   * and forward/backward feel broken). Prefers the point nearest the room center.
   */
  private findSpawn(preferNearCm?: Vec2, floorHintCm = 0): Vec2 {
    // Colliders of the storey the preferred spot is on — getColliders() alone is
    // the ground floor, which would test an upstairs room against the wrong walls.
    const floor = preferNearCm ? (this.handle.floorAt?.(preferNearCm.x, preferNearCm.z, floorHintCm) ?? floorHintCm) : 0
    const c = this.handle.getColliders?.(floor ?? 0)
    if (!c) return preferNearCm ?? { x: 0, z: 0 }
    const b = c.bounds
    const cx0 = preferNearCm?.x ?? (b.minX + b.maxX) / 2
    const cz0 = preferNearCm?.z ?? (b.minZ + b.maxZ) / 2
    const margin = this.bodyRadius + 8
    const clear = (x: number, z: number): boolean => {
      if (!pointInPolygon({ x, z }, c.polygon)) return false
      for (const o of c.furniture) {
        const cs = Math.cos(o.rot)
        const sn = Math.sin(o.rot)
        const lx = (x - o.cx) * cs + (z - o.cz) * -sn
        const lz = (x - o.cx) * sn + (z - o.cz) * cs
        if (Math.abs(lx) <= o.w / 2 + margin && Math.abs(lz) <= o.d / 2 + margin) return false
      }
      return true
    }
    if (clear(cx0, cz0)) return { x: cx0, z: cz0 }
    let best: Vec2 | null = null
    let bestD = Infinity
    const N = 16
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const x = b.minX + ((b.maxX - b.minX) * i) / N
        const z = b.minZ + ((b.maxZ - b.minZ) * j) / N
        if (!clear(x, z)) continue
        const d = (x - cx0) ** 2 + (z - cz0) ** 2
        if (d < bestD) {
          bestD = d
          best = { x, z }
        }
      }
    }
    return best ?? { x: cx0, z: cz0 }
  }

  /** Camera height (m): eye height above the floor currently underfoot. */
  private eyeY(): number {
    return this.eyeHeight + this.floorCm / 100
  }

  /** Floor height the walker is standing on (cm above the ground floor). */
  getFloorCm(): number {
    return this.floorCm
  }

  private frameFns() {
    const fr = this.handle.frame?.() ?? { cx: 0, cz: 0 }
    return {
      toWorld: (x: number, z: number): [number, number] => [(x - fr.cx) / 100, (z - fr.cz) / 100],
      fromWorld: (wx: number, wz: number): [number, number] => [wx * 100 + fr.cx, wz * 100 + fr.cz],
    }
  }
}
