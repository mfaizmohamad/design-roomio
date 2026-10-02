import * as THREE from 'three'
import type { SceneHandle } from '../contract/sceneContract'
import type { CameraPath, ControlPoint, Vec3 } from '../contract/pathSchema'
import { PATH_DEFAULTS } from '../contract/pathSchema'
import { getOverlayChild, emptyGroup } from './overlay'

/**
 * F3 — Waypoint path authoring.
 *
 * In the top-down director view, click the floor to drop waypoints; a
 * THREE.CatmullRomCurve3 (centripetal — no cusps/overshoot) is built so it
 * passes THROUGH every point. The curve is drawn as a line. Markers are
 * draggable to reshape. Each waypoint carries an optional explicit look-at
 * target and a dwell (seconds) — the per-point look-at + timing.
 *
 * Produces the shared CameraPath artifact (toCameraPath) consumed by playback
 * (F5) + capture (F6), and loads one back (loadCameraPath).
 */

interface Waypoint {
  position: THREE.Vector3 // world meters (y = eye height)
  lookAt: THREE.Vector3 | null
  dwell: number
  marker: THREE.Mesh
}

const COLOR_MID = '#3b82f6'
const COLOR_START = '#22c55e'
const COLOR_END = '#ef4444'
const COLOR_SEL = '#ffd23f'
const COLOR_LOOK = '#a855f7'

export class WaypointPath {
  private handle: SceneHandle
  private eyeHeight: number
  private waypoints: Waypoint[] = []
  private selected = -1

  private group: THREE.Group
  private markerGroup: THREE.Group
  private curveGroup: THREE.Group
  private lookGroup: THREE.Group

  private curve: THREE.CatmullRomCurve3 | null = null
  private loop = false

  private camera: THREE.Camera | null = null
  private editing = false
  private raycaster = new THREE.Raycaster()
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private dragging = -1
  private downXY: { x: number; y: number } | null = null
  private pendingFloor: THREE.Vector3 | null = null
  private setLookAtMode = false

  private changeCbs: Array<() => void> = []

  constructor(handle: SceneHandle, opts: { eyeHeight?: number } = {}) {
    this.handle = handle
    this.eyeHeight = opts.eyeHeight ?? PATH_DEFAULTS.eyeHeight
    this.group = getOverlayChild(handle.scene, 'path')
    this.markerGroup = new THREE.Group()
    this.curveGroup = new THREE.Group()
    this.lookGroup = new THREE.Group()
    this.group.add(this.curveGroup, this.markerGroup, this.lookGroup)
    this.raycaster.params.Line = { threshold: 0.1 }
  }

  onChange(cb: () => void) {
    this.changeCbs.push(cb)
  }
  private fireChange() {
    this.changeCbs.forEach((c) => c())
  }

  private overlay: HTMLDivElement | null = null

  // ---- editing lifecycle ----
  // Bind pointer handling to a transparent overlay div placed exactly over the
  // canvas, NOT the canvas itself. This isolates waypoint authoring from the
  // host's own canvas interactions (e.g. the app's furniture select/drag in the
  // furnish stage) — those events never reach the WebGL canvas while editing.
  enableEditing(camera: THREE.Camera) {
    this.camera = camera
    if (this.editing) return
    this.editing = true
    const canvas = this.handle.domElement
    const parent = canvas.parentElement ?? document.body
    const el = document.createElement('div')
    el.className = 'fly-overlay'
    el.style.cssText = 'position:absolute;inset:0;z-index:5;cursor:crosshair;touch-action:none'
    // ensure the parent is a positioning context
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative'
    // hide the host's in-canvas DOM overlays (e.g. drei <Html> furniture badges)
    // while authoring — they'd clutter the director view and steal clicks.
    parent.classList.add('fly-editing')
    parent.appendChild(el)
    this.overlay = el
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('pointerup', this.onPointerUp)
  }
  disableEditing() {
    if (!this.editing) return
    this.editing = false
    const el = this.overlay
    if (el) {
      el.parentElement?.classList.remove('fly-editing')
      el.removeEventListener('pointerdown', this.onPointerDown)
      el.removeEventListener('pointermove', this.onPointerMove)
      el.removeEventListener('pointerup', this.onPointerUp)
      el.remove()
      this.overlay = null
    }
    this.dragging = -1
    this.pendingFloor = null
  }
  setVisible(v: boolean) {
    this.group.visible = v
  }

  // ---- raycasting helpers ----
  private ndc(e: PointerEvent): THREE.Vector2 {
    const r = this.handle.domElement.getBoundingClientRect()
    return new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    )
  }
  private floorHit(e: PointerEvent): THREE.Vector3 | null {
    if (!this.camera) return null
    this.raycaster.setFromCamera(this.ndc(e), this.camera)
    const out = new THREE.Vector3()
    const hit = this.raycaster.ray.intersectPlane(this.floorPlane, out)
    return hit ? out : null
  }
  private markerHit(e: PointerEvent): number {
    if (!this.camera) return -1
    this.raycaster.setFromCamera(this.ndc(e), this.camera)
    const hits = this.raycaster.intersectObjects(this.markerGroup.children, false)
    if (!hits.length) return -1
    const idx = (hits[0].object as THREE.Mesh).userData.index
    return typeof idx === 'number' ? idx : -1
  }

  // ---- pointer handlers ----
  private onPointerDown = (e: PointerEvent) => {
    if (!this.editing || e.button !== 0) return
    this.downXY = { x: e.clientX, y: e.clientY }
    const mi = this.markerHit(e)
    if (mi >= 0) {
      this.dragging = mi
      this.select(mi)
      this.pendingFloor = null
    } else {
      this.dragging = -1
      this.pendingFloor = this.floorHit(e)
    }
  }
  private onPointerMove = (e: PointerEvent) => {
    if (!this.editing || this.dragging < 0) return
    const hit = this.floorHit(e)
    if (!hit) return
    const wp = this.waypoints[this.dragging]
    wp.position.set(hit.x, this.eyeHeight, hit.z)
    wp.marker.position.copy(wp.position)
    this.rebuildCurve()
    this.rebuildLookLines()
    this.fireChange()
  }
  private onPointerUp = (e: PointerEvent) => {
    if (!this.editing) return
    const moved = this.downXY ? Math.hypot(e.clientX - this.downXY.x, e.clientY - this.downXY.y) : 0
    if (this.dragging >= 0) {
      this.dragging = -1
    } else if (this.pendingFloor && moved < 6) {
      if (this.setLookAtMode && this.selected >= 0) {
        this.waypoints[this.selected].lookAt = new THREE.Vector3(this.pendingFloor.x, 1.0, this.pendingFloor.z)
        this.setLookAtMode = false
        this.rebuildLookLines()
        this.fireChange()
      } else {
        this.addPointAt(this.pendingFloor)
      }
    }
    this.downXY = null
    this.pendingFloor = null
  }

  // ---- data ops ----
  private makeMarker(index: number): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 18, 14),
      new THREE.MeshBasicMaterial({ color: COLOR_MID }),
    )
    m.userData.index = index
    return m
  }

  addPointAt(world: THREE.Vector3) {
    const position = new THREE.Vector3(world.x, this.eyeHeight, world.z)
    const marker = this.makeMarker(this.waypoints.length)
    marker.position.copy(position)
    this.markerGroup.add(marker)
    this.waypoints.push({ position, lookAt: null, dwell: 0, marker })
    this.select(this.waypoints.length - 1)
    this.rebuildCurve()
    this.recolor()
    this.fireChange()
  }

  removeSelected() {
    if (this.selected < 0) return
    const wp = this.waypoints[this.selected]
    this.markerGroup.remove(wp.marker)
    wp.marker.geometry.dispose()
    ;(wp.marker.material as THREE.Material).dispose()
    this.waypoints.splice(this.selected, 1)
    this.waypoints.forEach((w, i) => (w.marker.userData.index = i))
    this.selected = Math.min(this.selected, this.waypoints.length - 1)
    this.rebuildCurve()
    this.rebuildLookLines()
    this.recolor()
    this.fireChange()
  }

  clear() {
    emptyGroup(this.markerGroup)
    emptyGroup(this.curveGroup)
    emptyGroup(this.lookGroup)
    this.waypoints = []
    this.selected = -1
    this.curve = null
    this.fireChange()
  }

  select(i: number) {
    this.selected = i
    this.recolor()
  }
  selectedIndex() {
    return this.selected
  }

  setDwell(seconds: number) {
    if (this.selected < 0) return
    this.waypoints[this.selected].dwell = Math.max(0, seconds)
    this.fireChange()
  }
  beginSetLookAt() {
    if (this.selected >= 0) this.setLookAtMode = true
  }
  isSettingLookAt() {
    return this.setLookAtMode
  }
  clearLookAt() {
    if (this.selected < 0) return
    this.waypoints[this.selected].lookAt = null
    this.rebuildLookLines()
    this.fireChange()
  }

  setLoop(loop: boolean) {
    this.loop = loop
    this.rebuildCurve()
    this.fireChange()
  }
  isLoop() {
    return this.loop
  }

  count() {
    return this.waypoints.length
  }
  hasCurve() {
    return this.curve !== null
  }
  getCurve() {
    return this.curve
  }
  selectedInfo() {
    if (this.selected < 0) return null
    const wp = this.waypoints[this.selected]
    return { index: this.selected, dwell: wp.dwell, hasLookAt: !!wp.lookAt }
  }

  // ---- rendering ----
  private rebuildCurve() {
    emptyGroup(this.curveGroup)
    if (this.waypoints.length < 2) {
      this.curve = null
      return
    }
    const pts = this.waypoints.map((w) => w.position.clone())
    this.curve = new THREE.CatmullRomCurve3(pts, this.loop, 'centripetal')
    this.curve.arcLengthDivisions = 600
    const samples = this.curve.getPoints(Math.max(60, this.waypoints.length * 50))
    const geo = new THREE.BufferGeometry().setFromPoints(samples)
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#06b6d4' }))
    this.curveGroup.add(line)
  }

  private rebuildLookLines() {
    emptyGroup(this.lookGroup)
    for (const wp of this.waypoints) {
      if (!wp.lookAt) continue
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 12, 10),
        new THREE.MeshBasicMaterial({ color: COLOR_LOOK }),
      )
      dot.position.copy(wp.lookAt)
      const geo = new THREE.BufferGeometry().setFromPoints([wp.position.clone(), wp.lookAt.clone()])
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: COLOR_LOOK, dashSize: 0.12, gapSize: 0.08 }))
      line.computeLineDistances()
      this.lookGroup.add(dot, line)
    }
  }

  private recolor() {
    this.waypoints.forEach((w, i) => {
      const mat = w.marker.material as THREE.MeshBasicMaterial
      let c = COLOR_MID
      if (i === this.selected) c = COLOR_SEL
      else if (i === 0) c = COLOR_START
      else if (i === this.waypoints.length - 1) c = COLOR_END
      mat.color.set(c)
    })
  }

  // ---- import / export (shared CameraPath) ----
  toCameraPath(meta: Partial<CameraPath> = {}): CameraPath {
    const controlPoints: ControlPoint[] = this.waypoints.map((w) => ({
      position: [w.position.x, w.position.y, w.position.z] as Vec3,
      lookAt: w.lookAt ? ([w.lookAt.x, w.lookAt.y, w.lookAt.z] as Vec3) : null,
      dwell: w.dwell,
    }))
    return {
      version: '1.0',
      name: meta.name ?? 'Untitled path',
      designId: meta.designId ?? null,
      coordinateSpace: 'world-meters',
      fps: meta.fps ?? PATH_DEFAULTS.fps,
      duration: meta.duration ?? PATH_DEFAULTS.duration,
      loop: this.loop,
      eyeHeight: this.eyeHeight,
      lookAheadEps: meta.lookAheadEps ?? PATH_DEFAULTS.lookAheadEps,
      fov: meta.fov ?? PATH_DEFAULTS.fov,
      controlPoints,
    }
  }

  loadCameraPath(path: CameraPath) {
    this.clear()
    this.eyeHeight = path.eyeHeight ?? this.eyeHeight
    this.loop = path.loop ?? false
    for (const cp of path.controlPoints) {
      const marker = this.makeMarker(this.waypoints.length)
      const position = new THREE.Vector3(cp.position[0], cp.position[1], cp.position[2])
      marker.position.copy(position)
      this.markerGroup.add(marker)
      this.waypoints.push({
        position,
        lookAt: cp.lookAt ? new THREE.Vector3(cp.lookAt[0], cp.lookAt[1], cp.lookAt[2]) : null,
        dwell: cp.dwell ?? 0,
        marker,
      })
    }
    this.selected = this.waypoints.length ? 0 : -1
    this.rebuildCurve()
    this.rebuildLookLines()
    this.recolor()
    this.fireChange()
  }

  dispose() {
    this.disableEditing()
    emptyGroup(this.markerGroup)
    emptyGroup(this.curveGroup)
    emptyGroup(this.lookGroup)
  }
}
