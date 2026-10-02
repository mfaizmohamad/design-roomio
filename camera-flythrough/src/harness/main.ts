import * as THREE from 'three'
import { buildScene } from './buildScene'
import { FirstPersonWalk } from '../engine/firstPersonWalk'
import { DirectorView } from '../engine/directorView'
import { WaypointPath } from '../engine/waypointPath'
import { Playback } from '../engine/playback'
import { captureFlythrough, webCodecsAvailable } from '../engine/videoCapture'
import { samplesToCameraPath } from '../engine/walkRecord'
import { downloadPath, readPathFile, saveToLocal, loadFromLocal } from '../engine/pathIO'

/**
 * Dev-harness entry. Wires the flythrough engine to a faithful furnished-room
 * SceneHandle. In production this same engine attaches to Agent A's live scene
 * via getSceneHandle() (see /shared/scene_contract.json) — the engine code is
 * identical; only the source of the SceneHandle differs.
 */

const app = document.getElementById('app')!
const { handle, startLoop } = buildScene(app)

// ---- engine modules ----
const walk = new FirstPersonWalk(handle, { eyeHeight: 1.6 })
const director = new DirectorView(handle)
const path = new WaypointPath(handle, { eyeHeight: 1.6 })
const playback = new Playback()

const pathMeta = { name: 'Flythrough', duration: 8, fps: 30, fov: 60 }

type Mode = 'orbit' | 'walk' | 'director'
let mode: Mode = 'director'

// ---- HUD ----
const hud = document.createElement('div')
hud.id = 'hud'
hud.innerHTML = `
  <div class="group">
    <span class="label">View</span>
    <button id="btn-director" class="active">Director (F2)</button>
    <button id="btn-walk">Walk (F1)</button>
    <button id="btn-orbit">Orbit</button>
  </div>
  <div class="group" id="grp-director">
    <button id="btn-pov">⤢ Camera POV</button>
  </div>
  <div class="group" id="grp-walk">
    <button id="btn-record">● Record walk</button>
  </div>
  <div class="group" id="grp-path">
    <span class="label">Path</span>
    <span class="label" id="lbl-count">0 pts</span>
    <button id="btn-del">Delete pt</button>
    <button id="btn-clear">Clear</button>
    <button id="btn-lookat">Set look-at</button>
    <button id="btn-lookclear">Auto look</button>
    <span class="label">dwell</span>
    <input id="in-dwell" type="number" min="0" step="0.25" value="0" style="width:54px" />
    <label class="label"><input id="cb-loop" type="checkbox" /> loop</label>
    <button id="btn-save">Save JSON</button>
    <button id="btn-load">Load JSON</button>
    <input id="file-load" type="file" accept="application/json,.json" style="display:none" />
  </div>
`
document.body.appendChild(hud)

const banner = document.createElement('div')
banner.id = 'banner'
document.body.appendChild(banner)

const transport = document.createElement('div')
transport.id = 'transport'
transport.innerHTML = `
  <button id="tp-play">▶ Play</button>
  <input id="tp-scrub" type="range" min="0" max="1" step="0.001" value="0" />
  <span class="time" id="tp-time">0.0 / 0.0s</span>
  <label>dur <input id="tp-dur" type="number" min="1" step="1" value="8" />s</label>
  <button id="tp-export">⤓ Export MP4</button>
`
document.body.appendChild(transport)
const tpPlay = transport.querySelector<HTMLButtonElement>('#tp-play')!
const tpScrub = transport.querySelector<HTMLInputElement>('#tp-scrub')!
const tpTime = transport.querySelector<HTMLSpanElement>('#tp-time')!
const tpDur = transport.querySelector<HTMLInputElement>('#tp-dur')!
const tpExport = transport.querySelector<HTMLButtonElement>('#tp-export')!

const toast = document.createElement('div')
toast.id = 'toast'
document.body.appendChild(toast)
let toastTimer = 0
function showToast(msg: string, ms = 3500) {
  toast.textContent = msg
  toast.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), ms)
}

const btnOrbit = hud.querySelector<HTMLButtonElement>('#btn-orbit')!
const btnWalk = hud.querySelector<HTMLButtonElement>('#btn-walk')!
const btnDirector = hud.querySelector<HTMLButtonElement>('#btn-director')!
const btnPov = hud.querySelector<HTMLButtonElement>('#btn-pov')!
const grpDirector = hud.querySelector<HTMLDivElement>('#grp-director')!
const grpPath = hud.querySelector<HTMLDivElement>('#grp-path')!
const lblCount = hud.querySelector<HTMLSpanElement>('#lbl-count')!
const btnDel = hud.querySelector<HTMLButtonElement>('#btn-del')!
const btnClear = hud.querySelector<HTMLButtonElement>('#btn-clear')!
const btnLookAt = hud.querySelector<HTMLButtonElement>('#btn-lookat')!
const btnLookClear = hud.querySelector<HTMLButtonElement>('#btn-lookclear')!
const inDwell = hud.querySelector<HTMLInputElement>('#in-dwell')!
const cbLoop = hud.querySelector<HTMLInputElement>('#cb-loop')!
const grpWalk = hud.querySelector<HTMLDivElement>('#grp-walk')!
const btnRecord = hud.querySelector<HTMLButtonElement>('#btn-record')!
const btnSave = hud.querySelector<HTMLButtonElement>('#btn-save')!
const btnLoad = hud.querySelector<HTMLButtonElement>('#btn-load')!
const fileLoad = hud.querySelector<HTMLInputElement>('#file-load')!

function setBanner(html: string) {
  banner.innerHTML = html
}

function pathEditable() {
  return mode === 'director' && !director.isPov() && !playback.isPlaying()
}

function syncPlaybackFromPath() {
  if (path.hasCurve()) playback.setPath(path.toCameraPath(pathMeta))
}

function updateTransport() {
  const show = mode === 'director' && playback.hasPath()
  transport.classList.toggle('show', show)
  tpPlay.textContent = playback.isPlaying() ? '❚❚ Pause' : '▶ Play'
  const total = playback.getTotalTime()
  const cur = playback.progress01() * total
  tpTime.textContent = `${cur.toFixed(1)} / ${total.toFixed(1)}s`
  if (document.activeElement !== tpScrub) tpScrub.value = String(playback.progress01())
}

function updatePathEditing() {
  if (pathEditable()) {
    path.enableEditing(director.topCamera)
    path.setVisible(true)
  } else {
    path.disableEditing()
    path.setVisible(false)
  }
}

function refreshHud() {
  btnOrbit.classList.toggle('active', mode === 'orbit')
  btnWalk.classList.toggle('active', mode === 'walk')
  btnDirector.classList.toggle('active', mode === 'director')
  grpDirector.style.display = mode === 'director' ? 'flex' : 'none'
  grpWalk.style.display = mode === 'walk' ? 'flex' : 'none'
  grpPath.style.display = pathEditable() ? 'flex' : 'none'
  btnRecord.classList.toggle('active', walk.isRecording())
  btnRecord.textContent = walk.isRecording() ? '■ Stop & build path' : '● Record walk'
  btnPov.classList.toggle('active', director.isPov())
  btnPov.textContent = director.isPov() ? '⤢ Top-down' : '⤢ Camera POV'
  btnLookAt.classList.toggle('active', path.isSettingLookAt())
  const info = path.selectedInfo()
  lblCount.textContent = `${path.count()} pts${info ? ` · #${info.index + 1}` : ''}`
  if (info) inDwell.value = String(info.dwell)
}

path.onChange(() => {
  syncPlaybackFromPath()
  refreshHud()
  updateTransport()
})

// ---- transport listeners ----
tpPlay.addEventListener('click', () => {
  playback.toggle()
  updatePathEditing()
  refreshHud()
  updateTransport()
})
tpScrub.addEventListener('input', () => {
  playback.pause()
  playback.seek(parseFloat(tpScrub.value))
  if (playback.hasPath()) playback.applyToCamera(director.recordingCamera)
  updateTransport()
})
tpDur.addEventListener('change', () => {
  pathMeta.duration = Math.max(1, parseFloat(tpDur.value) || 8)
  syncPlaybackFromPath()
  updateTransport()
})

let exporting = false
async function runExport(download = true) {
  if (exporting || !playback.hasPath()) return null
  exporting = true
  playback.pause()
  tpExport.disabled = true
  tpPlay.disabled = true
  const codec = webCodecsAvailable() ? 'WebCodecs' : 'H264 WASM fallback'
  try {
    const res = await captureFlythrough(handle.renderer, handle.scene, director.recordingCamera, playback, {
      fps: pathMeta.fps,
      download,
      filename: 'roomio-flythrough',
      onProgress: (f, total) => {
        tpTime.textContent = `Exporting ${f}/${total}…`
      },
    })
    showToast(`✓ Exported ${res.frames} frames @ ${res.width}×${res.height} ${res.fps}fps (${codec})${download ? ' — downloading .mp4' : ''}`, 5000)
    return res
  } catch (e) {
    showToast(`✗ Export failed: ${(e as Error).message}`, 6000)
    throw e
  } finally {
    exporting = false
    tpExport.disabled = false
    tpPlay.disabled = false
    updateTransport()
  }
}
tpExport.addEventListener('click', () => { void runExport(true) })

function setMode(next: Mode) {
  if (next === mode) return
  if (mode === 'walk') walk.disable()
  if (mode === 'director') director.disable()
  mode = next
  if (mode === 'walk') {
    walk.enable()
    setBanner('<b>Walk mode</b> — click to look around · <b>WASD</b>/arrows to move · <b>Esc</b> to release · collides with walls & furniture')
  } else if (mode === 'director') {
    director.enable()
    setBanner('<b>Director (top-down)</b> — click the floor to drop waypoints; a smooth spline connects them. Drag points to reshape. Select a point to set its look-at + dwell.')
  } else {
    setBanner('<b>Orbit</b> — drag to rotate, scroll to zoom.')
  }
  updatePathEditing()
  refreshHud()
  updateTransport()
}

btnOrbit.addEventListener('click', () => setMode('orbit'))
btnWalk.addEventListener('click', () => setMode('walk'))
btnDirector.addEventListener('click', () => setMode('director'))
btnPov.addEventListener('click', () => {
  const pov = director.togglePov()
  setBanner(pov
    ? '<b>Camera POV</b> — first-person preview of the recording camera. Tap <b>Top-down</b> to return and edit the path.'
    : '<b>Director (top-down)</b> — click the floor to drop waypoints; drag to reshape; set per-point look-at + dwell.')
  updatePathEditing()
  refreshHud()
})

// ---- path tools ----
btnDel.addEventListener('click', () => path.removeSelected())
btnClear.addEventListener('click', () => path.clear())
btnLookAt.addEventListener('click', () => {
  path.beginSetLookAt()
  setBanner('<b>Set look-at</b> — click a spot on the floor for the selected point to face. (Click cancels to a normal waypoint add only after you place it.)')
  refreshHud()
})
btnLookClear.addEventListener('click', () => path.clearLookAt())
inDwell.addEventListener('change', () => path.setDwell(parseFloat(inDwell.value) || 0))
cbLoop.addEventListener('change', () => path.setLoop(cbLoop.checked))

// ---- F4 walk-and-record ----
function finishRecording() {
  const samples = walk.stopRecording()
  const cp = samplesToCameraPath(samples, pathMeta)
  if (cp.controlPoints.length >= 2) {
    path.loadCameraPath(cp)
    cbLoop.checked = path.isLoop()
    setMode('director')
    showToast(`Recorded walk → ${cp.controlPoints.length} control points (decimated from ${samples.length} samples)`, 4500)
  } else {
    showToast('Walk too short to build a path — move further and try again.', 4000)
  }
  refreshHud()
}
btnRecord.addEventListener('click', () => {
  if (walk.isRecording()) {
    finishRecording()
  } else {
    walk.startRecording()
    setBanner('<b>Recording walk</b> — move with WASD; your trajectory becomes the path. Tap <b>Stop &amp; build path</b> when done.')
    refreshHud()
  }
})

// ---- save / load JSON ----
btnSave.addEventListener('click', () => {
  if (!path.hasCurve()) { showToast('Add at least 2 waypoints first.', 3000); return }
  const cp = path.toCameraPath(pathMeta)
  downloadPath(cp)
  saveToLocal(cp)
  showToast('Saved path JSON (downloaded + cached locally).', 3500)
})
btnLoad.addEventListener('click', () => fileLoad.click())
fileLoad.addEventListener('change', async () => {
  const f = fileLoad.files?.[0]
  if (!f) return
  try {
    const cp = await readPathFile(f)
    pathMeta.duration = cp.duration
    pathMeta.fps = cp.fps
    pathMeta.fov = cp.fov ?? pathMeta.fov
    tpDur.value = String(cp.duration)
    path.loadCameraPath(cp)
    cbLoop.checked = path.isLoop()
    showToast(`Loaded "${cp.name}" — ${cp.controlPoints.length} points.`, 3500)
  } catch (e) {
    showToast(`Load failed: ${(e as Error).message}`, 5000)
  }
  fileLoad.value = ''
})

// Click the canvas to (re)acquire pointer lock while walking.
handle.domElement.addEventListener('click', () => {
  if (mode === 'walk') walk.lock()
})
window.addEventListener('resize', () => director.resize())

// start in director mode
director.enable()
setBanner('<b>Director (top-down)</b> — click the floor to drop waypoints; a smooth spline connects them. Drag points to reshape. Select a point to set its look-at + dwell.')
updatePathEditing()
refreshHud()

// ---- render loop ----
startLoop((dt): THREE.Camera | null | false => {
  if (exporting) return false // deterministic capture loop owns the canvas
  if (mode === 'walk') return walk.update(dt)
  if (mode === 'director') {
    if (playback.hasPath()) {
      if (playback.isPlaying()) {
        playback.update(dt)
        updateTransport()
        if (!playback.isPlaying()) {
          updatePathEditing()
          refreshHud()
        }
      }
      playback.applyToCamera(director.recordingCamera)
    }
    director.syncGizmo()
    return director.activeCamera()
  }
  return null
})

// ---- debug hooks for headless verification ----
;(window as unknown as { __fly: unknown }).__fly = {
  setMode,
  getMode: () => mode,
  pressKeys: (codes: string[]) => codes.forEach((c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c }))),
  releaseKeys: (codes: string[]) => codes.forEach((c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c }))),
  walkPosCm: () => (walk as unknown as { posCm: { x: number; z: number } }).posCm,
  walkCamPos: () => walk.camera.position.toArray(),
  setWalkYaw: (rad: number) => {
    walk.camera.rotation.set(0, rad, 0)
  },
  colliders: () => handle.getColliders?.(),
  togglePov: () => { const v = director.togglePov(); updatePathEditing(); refreshHud(); return v },
  isPov: () => director.isPov(),
  setRecordingPose: (p: number[], l: number[]) =>
    director.setRecordingPose(new THREE.Vector3(p[0], p[1], p[2]), new THREE.Vector3(l[0], l[1], l[2])),
  // path authoring
  addWaypoint: (x: number, z: number) => path.addPointAt(new THREE.Vector3(x, 1.6, z)),
  dragSelected: (x: number, z: number) => {
    const i = path.selectedIndex()
    if (i < 0) return
    // simulate a drag by removing+reinserting is complex; expose direct set instead
    ;(path as unknown as { waypoints: Array<{ position: THREE.Vector3; marker: THREE.Mesh }> }).waypoints[i].position.set(x, 1.6, z)
    ;(path as unknown as { waypoints: Array<{ position: THREE.Vector3; marker: THREE.Mesh }> }).waypoints[i].marker.position.set(x, 1.6, z)
    ;(path as unknown as { rebuildCurve: () => void }).rebuildCurve()
  },
  select: (i: number) => path.select(i),
  setDwell: (s: number) => path.setDwell(s),
  setLookAtWorld: (x: number, y: number, z: number) => {
    const i = path.selectedIndex()
    if (i < 0) return
    ;(path as unknown as { waypoints: Array<{ lookAt: THREE.Vector3 | null }> }).waypoints[i].lookAt = new THREE.Vector3(x, y, z)
    ;(path as unknown as { rebuildLookLines: () => void }).rebuildLookLines()
  },
  pathCount: () => path.count(),
  hasCurve: () => path.hasCurve(),
  toCameraPath: () => path.toCameraPath(),
  loadCameraPath: (p: unknown) => path.loadCameraPath(p as ReturnType<typeof path.toCameraPath>),
  curveSample: (t: number) => {
    const c = path.getCurve()
    return c ? c.getPointAt(Math.max(0, Math.min(1, t))).toArray() : null
  },
  curveDense: (n: number) => {
    const c = path.getCurve()
    return c ? c.getPoints(n).map((p) => p.toArray()) : null
  },
  // playback
  play: () => { playback.play(); updatePathEditing(); refreshHud(); updateTransport() },
  pause: () => { playback.pause(); updatePathEditing(); refreshHud(); updateTransport() },
  isPlaying: () => playback.isPlaying(),
  seek: (p: number) => { playback.seek(p); if (playback.hasPath()) playback.applyToCamera(director.recordingCamera); updateTransport() },
  progress01: () => playback.progress01(),
  totalTime: () => playback.getTotalTime(),
  setDuration: (s: number) => { pathMeta.duration = s; syncPlaybackFromPath(); updateTransport() },
  poseAt: (p: number) => {
    const pose = playback.sampleAt(p * playback.getTotalTime())
    return pose ? { position: pose.position.toArray(), target: pose.target.toArray(), u: pose.u } : null
  },
  recCamPos: () => director.recordingCamera.position.toArray(),
  webCodecs: () => webCodecsAvailable(),
  // F4 walk-and-record
  startRecording: () => walk.startRecording(),
  stopRecordingBuild: () => {
    const samples = walk.stopRecording()
    const cp = samplesToCameraPath(samples, pathMeta)
    if (cp.controlPoints.length >= 2) path.loadCameraPath(cp)
    return { samples: samples.length, points: cp.controlPoints.length }
  },
  isRecording: () => walk.isRecording(),
  // save / load JSON round-trip
  serializePath: () => JSON.stringify(path.toCameraPath(pathMeta)),
  loadFromJSON: (text: string) => {
    const cp = JSON.parse(text)
    path.loadCameraPath(cp)
    return path.count()
  },
  loadFromLocalCache: () => {
    const cp = loadFromLocal()
    if (cp) { path.loadCameraPath(cp); return path.count() }
    return 0
  },
  saveLocal: () => saveToLocal(path.toCameraPath(pathMeta)),
  // capture (download:false for tests — returns buffer info)
  capture: async (download = false) => {
    const res = await runExport(download)
    if (!res) return null
    const buf = res.buffer
    let bytes: Uint8Array | null = null
    if (buf instanceof Uint8Array) bytes = buf
    else if (buf instanceof ArrayBuffer) bytes = new Uint8Array(buf)
    else if (Array.isArray(buf)) {
      const blob = new Blob(buf as Blob[])
      bytes = new Uint8Array(await blob.arrayBuffer())
    }
    // sniff the MP4 'ftyp' box (bytes 4..8) for a sanity check
    const head = bytes ? Array.from(bytes.slice(0, 12)) : []
    return { frames: res.frames, width: res.width, height: res.height, fps: res.fps, webcodecs: res.webcodecs, byteLength: bytes?.length ?? 0, head }
  },
}
