import * as THREE from 'three'
import type { SceneHandle } from '../contract/sceneContract'
import { getOverlayChild, emptyGroup } from './overlay'

/**
 * F2 — Top-down director view + camera gizmo + POV toggle.
 *
 * Provides two cameras:
 *   - topCamera: an orthographic camera looking straight down (the default
 *     authoring surface — you lay out the path on the room plan).
 *   - recordingCamera: the PerspectiveCamera that playback (F5) animates and
 *     capture (F6) records. Its current pose is drawn as a gizmo (body + facing
 *     cone + frustum) so the director sees where it is and which way it points.
 *
 * One-tap POV toggle renders the recordingCamera instead of the top camera
 * (the gizmo auto-hides in POV — you're looking through it).
 */
export class DirectorView {
  readonly topCamera: THREE.OrthographicCamera
  readonly recordingCamera: THREE.PerspectiveCamera
  private handle: SceneHandle
  private gizmo: THREE.Group
  private group: THREE.Group
  private pov = false
  private active = false

  constructor(handle: SceneHandle, opts: { fov?: number } = {}) {
    this.handle = handle
    this.topCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 200)
    // Look straight down with -z mapped to "up" on screen (north).
    this.topCamera.up.set(0, 0, -1)
    this.recordingCamera = new THREE.PerspectiveCamera(opts.fov ?? 60, 1, 0.05, 200)

    this.group = getOverlayChild(handle.scene, 'gizmo')
    this.gizmo = this.buildGizmo()
    this.group.add(this.gizmo)
    this.group.visible = false

    // Default recording pose: stand near the +z side at eye height, look across.
    const b = handle.getColliders?.().bounds
    const half = b ? ((b.maxZ - b.minZ) / 100) * 0.32 : 1.2
    this.setRecordingPose(
      new THREE.Vector3(0, 1.6, half),
      new THREE.Vector3(0, 1.0, -half),
    )
  }

  private buildGizmo(): THREE.Group {
    const g = new THREE.Group()
    const orange = '#ff7a1a'
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.14, 0.16),
      new THREE.MeshBasicMaterial({ color: orange }),
    )
    g.add(body)
    // facing cone points along local -z (camera looks down -z)
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.26, 16),
      new THREE.MeshBasicMaterial({ color: '#ffd23f' }),
    )
    cone.rotation.x = -Math.PI / 2
    cone.position.z = -0.22
    g.add(cone)
    // a little frustum outline so facing reads at a glance from top-down
    const d = 0.7
    const hw = 0.42
    const hh = 0.28
    const pts = [
      [0, 0, 0], [-hw, hh, -d], [0, 0, 0], [hw, hh, -d],
      [0, 0, 0], [-hw, -hh, -d], [0, 0, 0], [hw, -hh, -d],
      [-hw, hh, -d], [hw, hh, -d], [hw, hh, -d], [hw, -hh, -d],
      [hw, -hh, -d], [-hw, -hh, -d], [-hw, -hh, -d], [-hw, hh, -d],
    ].flat()
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    const frustum = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: orange }))
    g.add(frustum)
    return g
  }

  /** Frame the top-down ortho camera to the room bounds (call on enable/resize). */
  private frameTop() {
    const b = this.handle.getColliders?.().bounds
    const aspect = this.aspect()
    let halfW = 3
    let halfH = 2
    if (b) {
      halfW = ((b.maxX - b.minX) / 100) * 0.62
      halfH = ((b.maxZ - b.minZ) / 100) * 0.62
    }
    // expand to satisfy aspect so the whole room always fits
    if (halfW / halfH < aspect) halfW = halfH * aspect
    else halfH = halfW / aspect
    this.topCamera.left = -halfW
    this.topCamera.right = halfW
    this.topCamera.top = halfH
    this.topCamera.bottom = -halfH
    this.topCamera.position.set(0, 30, 0)
    this.topCamera.lookAt(0, 0, 0)
    this.topCamera.updateProjectionMatrix()
  }

  private aspect(): number {
    const s = this.handle.size ?? { width: 1, height: 1 }
    return (s.width || 1) / (s.height || 1) || 1
  }

  enable() {
    if (this.active) return
    this.active = true
    if (this.handle.controls) this.handle.controls.enabled = false
    this.frameTop()
    this.group.visible = !this.pov
    this.syncGizmo()
  }

  disable() {
    if (!this.active) return
    this.active = false
    this.group.visible = false
    if (this.handle.controls) this.handle.controls.enabled = true
  }

  isActive() {
    return this.active
  }

  /** Toggle (or set) first-person POV of the recording camera. */
  setPov(on: boolean) {
    this.pov = on
    this.group.visible = this.active && !on
    if (on) {
      this.recordingCamera.aspect = this.aspect()
      this.recordingCamera.updateProjectionMatrix()
    }
  }
  togglePov() {
    this.setPov(!this.pov)
    return this.pov
  }
  isPov() {
    return this.pov
  }

  /** Set the recording camera pose (world meters). */
  setRecordingPose(position: THREE.Vector3, lookAt: THREE.Vector3) {
    this.recordingCamera.position.copy(position)
    this.recordingCamera.up.set(0, 1, 0)
    this.recordingCamera.lookAt(lookAt)
    this.syncGizmo()
  }

  /** Sync the gizmo to the recording camera's pose. */
  syncGizmo() {
    this.gizmo.position.copy(this.recordingCamera.position)
    this.gizmo.quaternion.copy(this.recordingCamera.quaternion)
  }

  /** The camera the host should render while director mode is active. */
  activeCamera(): THREE.Camera {
    return this.pov ? this.recordingCamera : this.topCamera
  }

  resize() {
    if (this.active && !this.pov) this.frameTop()
    if (this.pov) {
      this.recordingCamera.aspect = this.aspect()
      this.recordingCamera.updateProjectionMatrix()
    }
  }

  dispose() {
    emptyGroup(this.group)
  }
}
