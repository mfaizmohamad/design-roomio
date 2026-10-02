import * as THREE from 'three'
import type { SceneHandle, Vec2 } from '../contract/sceneContract'
import type { CameraPath } from '../contract/pathSchema'
import { DirectorView } from './directorView'
import { FirstPersonWalk } from './firstPersonWalk'
import { WaypointPath } from './waypointPath'
import { Playback } from './playback'
import { captureFlythrough, webCodecsAvailable } from './videoCapture'
import { clearOverlay } from './overlay'
import { samplesToCameraPath } from './walkRecord'

/**
 * Host-agnostic orchestrator for the whole flythrough feature. Owns the four
 * engine modules and the mode/transport state, and tells the HOST which camera
 * to render via `setRenderCamera(camera | null)` (null = host's own camera).
 *
 * The dev harness drives this implicitly through its render loop; inside
 * React-Three-Fiber a tiny in-Canvas bridge calls `update(dt)` each frame and
 * swaps the rendered camera with R3F's `set({ camera })`. Same engine, two hosts.
 */

export type FlyMode = 'orbit' | 'walk' | 'director'

export interface ControllerCallbacks {
  /** swap the camera the host renders; null restores the host default camera */
  setRenderCamera: (camera: THREE.Camera | null) => void
  /** notify the UI that state changed (re-render the HUD) */
  onChange?: () => void
  /** re-enable/disable the host's orbit-style controls */
  setHostControlsEnabled?: (enabled: boolean) => void
}

export class FlythroughController {
  readonly director: DirectorView
  readonly walk: FirstPersonWalk
  readonly path: WaypointPath
  readonly playback: Playback
  private handle: SceneHandle
  private cb: ControllerCallbacks
  private mode: FlyMode = 'orbit'
  private open = false
  private exporting = false
  private lastRenderCam: THREE.Camera | null = null
  private editMode = false
  private listeners = new Set<() => void>()
  meta = { name: 'Flythrough', duration: 8, fps: 30, fov: 60 }

  constructor(handle: SceneHandle, cb: ControllerCallbacks) {
    this.handle = handle
    this.cb = cb
    this.director = new DirectorView(handle, { fov: this.meta.fov })
    this.walk = new FirstPersonWalk(handle, { eyeHeight: 1.6 })
    this.path = new WaypointPath(handle, { eyeHeight: 1.6 })
    this.playback = new Playback()
    this.path.onChange(() => {
      this.syncPlayback()
      this.fire()
    })
  }

  private fire() {
    this.cb.onChange?.()
    this.listeners.forEach((l) => l())
  }
  /** Subscribe to state changes (for a HUD). Returns an unsubscribe fn. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  isOpen() {
    return this.open
  }
  getMode() {
    return this.mode
  }
  isExporting() {
    return this.exporting
  }
  hasWebCodecs() {
    return webCodecsAvailable()
  }

  // ---- lifecycle ----
  openPanel() {
    if (this.open) return
    this.open = true
    this.setMode('director')
  }
  closePanel() {
    if (!this.open) return
    this.open = false
    if (this.mode === 'walk') this.walk.disable()
    if (this.mode === 'director') this.director.disable()
    this.path.disableEditing()
    this.path.setVisible(false)
    this.playback.pause()
    this.mode = 'orbit'
    this.editMode = false
    this.applyRenderCamera(null)
    this.fire()
  }
  /** Full teardown — removes all overlay objects, restores the scene. */
  dispose() {
    this.playback.pause()
    this.walk.disable()
    this.director.disable()
    this.path.dispose()
    clearOverlay(this.handle.scene)
    this.cb.setHostControlsEnabled?.(true)
    this.applyRenderCamera(null)
  }

  // ---- modes ----
  setMode(next: FlyMode, opts: { walkNearCm?: Vec2; walkFace?: Vec2; walkFloorCm?: number } = {}) {
    if (next === this.mode) return
    if (this.mode === 'walk') this.walk.disable()
    if (this.mode === 'director') this.director.disable()
    this.mode = next
    if (next === 'walk') this.walk.enable(undefined, opts.walkNearCm, opts.walkFace, opts.walkFloorCm)
    else if (next === 'director') this.director.enable()
    this.updatePathEditing()
    this.fire()
  }
  pathEditable() {
    return this.open && this.mode === 'director' && !this.director.isPov() && !this.playback.isPlaying() && !this.editMode
  }
  isEdit() {
    return this.editMode
  }
  /**
   * Toggle "Edit furniture" mode: while ON, the flythrough's path-authoring lock
   * is suspended so the user can select / move / rotate / delete furniture with
   * the app's normal tools (the React layer unlocks + un-hides the toolbars).
   * Forces a director top-down view and pauses playback so editing is usable.
   */
  toggleEdit() {
    this.editMode = !this.editMode
    if (this.editMode) {
      this.playback.pause()
      if (this.mode !== 'director') this.setMode('director')
      if (this.director.isPov()) this.director.setPov(false)
    }
    this.updatePathEditing()
    this.fire()
    return this.editMode
  }
  private updatePathEditing() {
    if (this.pathEditable()) {
      this.path.enableEditing(this.director.topCamera)
      this.path.setVisible(true)
    } else {
      this.path.disableEditing()
      this.path.setVisible(this.mode === 'director')
    }
  }
  togglePov() {
    const v = this.director.togglePov()
    this.updatePathEditing()
    this.fire()
    return v
  }
  isPov() {
    return this.director.isPov()
  }

  // ---- walk: lock pointer (call from a user gesture) ----
  lockWalk() {
    if (this.mode === 'walk') this.walk.lock()
  }

  /**
   * Buyer walkthrough: open straight into first-person walk (no director/path UI),
   * starting near `nearCm` (house-plane cm) on the storey at `floorCm`, facing
   * `face` when given. If
   * already walking, jumps the walker there instead (keeping its heading).
   */
  startWalk(nearCm?: Vec2, face?: Vec2, floorCm = 0) {
    if (this.open && this.mode === 'walk') {
      if (nearCm) this.walk.teleport(nearCm, floorCm)
      return
    }
    this.open = true
    this.setMode('walk', { walkNearCm: nearCm, walkFace: face, walkFloorCm: floorCm })
  }

  /** On-screen movement pad + drag-to-look for touch devices (see FirstPersonWalk). */
  setWalkKey(code: string, down: boolean) {
    this.walk.setVirtualKey(code, down)
  }
  walkLook(dxPx: number, dyPx: number) {
    this.walk.look(dxPx, dyPx)
  }

  // ---- path / playback ----
  syncPlayback() {
    if (this.path.hasCurve()) this.playback.setPath(this.path.toCameraPath(this.meta))
  }
  setDuration(sec: number) {
    this.meta.duration = Math.max(1, sec)
    this.syncPlayback()
    this.fire()
  }
  playPause() {
    this.playback.toggle()
    this.updatePathEditing()
    this.fire()
  }
  seek(p01: number) {
    this.playback.pause()
    this.playback.seek(p01)
    if (this.playback.hasPath()) this.playback.applyToCamera(this.director.recordingCamera)
    this.updatePathEditing()
    this.fire()
  }

  // ---- walk-and-record (F4) ----
  toggleRecord(): { built: boolean; samples: number; points: number } {
    if (this.walk.isRecording()) {
      const samples = this.walk.stopRecording()
      const cp = samplesToCameraPath(samples, this.meta)
      if (cp.controlPoints.length >= 2) {
        this.path.loadCameraPath(cp)
        this.setMode('director')
      }
      this.fire()
      return { built: cp.controlPoints.length >= 2, samples: samples.length, points: cp.controlPoints.length }
    }
    this.walk.startRecording()
    this.fire()
    return { built: false, samples: 0, points: 0 }
  }

  // ---- export (F6) ----
  async export(download = true) {
    if (this.exporting || !this.playback.hasPath()) return null
    this.exporting = true
    this.playback.pause()
    this.fire()
    try {
      return await captureFlythrough(this.handle.renderer, this.handle.scene, this.director.recordingCamera, this.playback, {
        fps: this.meta.fps,
        download,
        noResize: true, // R3F owns sizing
        filename: 'roomio-flythrough',
      })
    } finally {
      this.exporting = false
      this.fire()
    }
  }

  // ---- per-frame: called by the host every frame ----
  update(dt: number) {
    if (!this.open) {
      this.applyRenderCamera(null)
      return
    }
    if (this.mode === 'walk') {
      this.applyRenderCamera(this.walk.update(dt))
      return
    }
    if (this.mode === 'director') {
      // Edit-furniture mode: render the app's OWN camera + controls so furniture
      // editing looks/behaves exactly like the normal app (normal-sized toolbars,
      // orbit navigation). The path spline + gizmo stay visible in the scene.
      if (this.editMode) {
        this.applyRenderCamera(null)
        return
      }
      if (this.playback.hasPath()) {
        if (this.playback.isPlaying()) {
          const stillPlaying = this.playback.update(dt)
          if (!stillPlaying) {
            this.updatePathEditing()
            this.fire()
          }
        }
        this.playback.applyToCamera(this.director.recordingCamera)
      }
      this.director.syncGizmo()
      this.applyRenderCamera(this.director.activeCamera())
      return
    }
    this.applyRenderCamera(null)
  }

  private applyRenderCamera(cam: THREE.Camera | null) {
    // Assert the host-controls state EVERY frame: drei's OrbitControls is
    // recreated whenever state.camera changes (useMemo on the camera) and the
    // fresh instance is enabled by default — if we only toggled on change it
    // would re-enable itself and yank our camera to the orbit pose. Re-disabling
    // each frame (from the priority -2 host hook, before OrbitControls' -1 update)
    // keeps it inert while we drive a non-host camera.
    this.cb.setHostControlsEnabled?.(cam === null)
    if (cam === this.lastRenderCam) return
    this.lastRenderCam = cam
    this.cb.setRenderCamera(cam)
  }

  /** snapshot for the HUD */
  snapshot() {
    const info = this.path.selectedInfo()
    return {
      open: this.open,
      mode: this.mode,
      pov: this.director.isPov(),
      editMode: this.editMode,
      pathEditable: this.pathEditable(),
      count: this.path.count(),
      hasCurve: this.path.hasCurve(),
      selected: info,
      isRecording: this.walk.isRecording(),
      isPlaying: this.playback.isPlaying(),
      isExporting: this.exporting,
      settingLookAt: this.path.isSettingLookAt(),
      loop: this.path.isLoop(),
      progress: this.playback.progress01(),
      total: this.playback.getTotalTime(),
      duration: this.meta.duration,
      webCodecs: webCodecsAvailable(),
    }
  }

  loadPath(cp: CameraPath) {
    this.meta.duration = cp.duration
    this.meta.fps = cp.fps
    this.meta.fov = cp.fov ?? this.meta.fov
    this.path.loadCameraPath(cp)
    this.fire()
  }
  currentPath(): CameraPath {
    return this.path.toCameraPath(this.meta)
  }
}
