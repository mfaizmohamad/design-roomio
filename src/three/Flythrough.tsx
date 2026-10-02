import { placementsFor, storeyColliderPlacements, floorHeightAt } from './houseLevels'
import { useEffect, useReducer, useRef, useState } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { useStore } from '../store'
import { bbox, deriveWalls } from '../geometry/walls'
import { isWalkableFloor } from '../data/archetypes'
import { setSceneHandle, type SceneHandle } from './sceneBus'
// Multi-room: when the whole-house overview is active, the walker must collide
// against the WHOLE house (all rooms at their footprints, doorways walkable),
// not just the single active room — else you hit invisible walls (the active
// room's geometry sitting at the wrong coordinates).
import { useHouseView } from './houseViewMode'
import { useHouse } from './houseSession'
import { layoutHouse, houseColliders, houseBoundsCm, type RoomPlacement } from './houseLayout'
import { FlythroughController } from '../../camera-flythrough/src/engine/FlythroughController'
import { downloadPath, readPathFile } from '../../camera-flythrough/src/engine/pathIO'

/**
 * In-app bridge for the flythrough feature (Agent B engine, /camera-flythrough).
 *
 * <SceneBridge> lives INSIDE the R3F <Canvas>: it publishes the live SceneHandle
 * (per /shared/scene_contract.json), builds getColliders() from the live store
 * design, drives the controller each frame, and swaps the rendered camera via
 * R3F's set({ camera }). <FlythroughHud> is a DOM overlay rendered OUTSIDE the
 * Canvas with the authoring/playback/export controls. The room is left exactly
 * as found on close (overlay objects are removed, user camera + controls restored).
 */

/**
 * In whole-house mode with >1 room, the placements to lay out (active room
 * live). With `floorCm`: the colliders of the storey the walker is on at that
 * height (houseLevels.storeyColliderPlacements); without: every storey.
 */
function housePlacements(floorCm?: number): RoomPlacement[] | null {
  const s = useHouse.getState()
  if (useHouseView.getState().mode !== 'house' || s.rooms.length <= 1) return null
  const live = useStore.getState().design
  return floorCm === undefined ? placementsFor(s, live) : storeyColliderPlacements(s, live, floorCm)
}

export function SceneBridge({ onController }: { onController: (c: FlythroughController | null) => void }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const set = useThree((s) => s.set)
  const get = useThree((s) => s.get)
  const invalidate = useThree((s) => s.invalidate)
  const ctrlRef = useRef<FlythroughController | null>(null)

  useEffect(() => {
    const originalCam = get().camera as THREE.PerspectiveCamera
    const handle: SceneHandle = {
      scene,
      renderer: gl,
      camera: originalCam,
      controls: (get().controls as { enabled: boolean } | null) ?? null,
      domElement: gl.domElement,
      get size() {
        return { width: gl.domElement.clientWidth, height: gl.domElement.clientHeight }
      },
      getColliders: (floorCm = 0) => {
        const housePlace = housePlacements(floorCm)
        if (housePlace) return houseColliders(layoutHouse(housePlace))
        const d = useStore.getState().design
        const walls = useStore.getState().walls ?? deriveWalls(d.corners)
        const b = bbox(d.corners)
        return {
          walls,
          // Flat floor coverings (rugs/carpets) are walkable — you step onto them,
          // so they must not act as collision footprints in the first-person walk.
          furniture: d.furniture
            .filter((f) => !isWalkableFloor(f.archetype, f.h))
            .map((f) => ({ cx: f.x, cz: f.z, w: f.w, d: f.d, rot: f.rotation })),
          polygon: d.corners,
          wallThickness: d.wallThickness,
          bounds: { minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ },
        }
      },
      frame: () => {
        // origin from EVERY storey — it must match HouseView's (RoomView bounds),
        // or the colliders shift off the rendered walls on multi-storey houses
        const housePlace = housePlacements()
        const b = housePlace
          ? houseBoundsCm(layoutHouse(housePlace))
          : bbox(useStore.getState().design.corners)
        return { cx: b.cx, cz: b.cz }
      },
      // Stairs + storeys: the walker follows this floor height (single-room
      // mode has no storeys — everything is flat at 0).
      floorAt: (xCm, zCm, currentFloorCm) => {
        const housePlace = housePlacements()
        if (!housePlace) return 0
        return floorHeightAt(layoutHouse(housePlace), xCm, zCm, currentFloorCm)
      },
      invalidate: () => invalidate(),
    }
    setSceneHandle(handle)

    const controller = new FlythroughController(handle, {
      setRenderCamera: (cam) => set({ camera: (cam ?? originalCam) as THREE.PerspectiveCamera }),
      setHostControlsEnabled: (en) => {
        const c = get().controls as { enabled: boolean } | null
        if (c) c.enabled = en
      },
    })
    ctrlRef.current = controller
    onController(controller)
    // dev handles for manual/automated testing in the console
    ;(window as unknown as { __roomioFly?: FlythroughController }).__roomioFly = controller
    ;(window as unknown as { __roomioLocks?: () => unknown }).__roomioLocks = () =>
      useStore.getState().design.furniture.map((f) => ({ id: f.id, locked: !!f.locked }))

    const onClick = () => ctrlRef.current?.lockWalk()
    gl.domElement.addEventListener('click', onClick)

    return () => {
      gl.domElement.removeEventListener('click', onClick)
      controller.dispose()
      setSceneHandle(null)
      set({ camera: originalCam })
      onController(null)
      ctrlRef.current = null
    }
    // mount once for the lifetime of this Canvas
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Priority -2 runs BEFORE drei's OrbitControls useFrame (-1), so the controller
  // can disable the host controls before they'd otherwise update() and clobber our
  // swapped-in camera. (Negative priority does not take over R3F's auto-render.)
  useFrame((_, dt) => {
    ctrlRef.current?.update(Math.min(dt, 0.1))
  }, -2)
  return null
}

// ---------------------------------------------------------------------------

const STYLE_ID = 'fly-style'
const CSS = `
#fly-launch{position:fixed;right:18px;bottom:18px;z-index:40;background:#3b82f6;color:#fff;border:none;
  padding:11px 16px;border-radius:999px;font:600 14px ui-sans-serif,system-ui,sans-serif;cursor:pointer;
  box-shadow:0 6px 20px rgba(0,0,0,.25)}
#fly-launch:hover{background:#2f6fe0}
#fly-root{position:fixed;inset:0;z-index:39;pointer-events:none;font:13px ui-sans-serif,system-ui,sans-serif}
#fly-root .bar{position:fixed;left:12px;right:12px;top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;pointer-events:none}
#fly-root .group{display:flex;gap:6px;align-items:center;pointer-events:auto;background:rgba(20,22,26,.82);
  backdrop-filter:blur(6px);padding:7px 9px;border-radius:10px}
#fly-root button{border:1px solid rgba(255,255,255,.16);background:#2b2f36;color:#e9eaec;padding:7px 11px;
  border-radius:7px;font-size:13px;cursor:pointer;line-height:1}
#fly-root button:hover{background:#363b44}
#fly-root button.active{background:#3b82f6;border-color:#3b82f6;color:#fff}
#fly-root button:disabled{opacity:.4;cursor:default}
#fly-root .label{color:#aab;font-size:12px;padding:0 2px}
#fly-root input[type=number]{width:52px}
#fly-root input[type=range]{width:240px;accent-color:#3b82f6}
#fly-root .transport{position:fixed;bottom:58px;left:50%;transform:translateX(-50%);display:flex;gap:10px;
  align-items:center;pointer-events:auto;background:rgba(20,22,26,.85);backdrop-filter:blur(6px);
  padding:8px 14px;border-radius:10px;color:#e9eaec}
#fly-root .banner{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:rgba(20,22,26,.85);
  color:#e9eaec;padding:8px 14px;border-radius:9px;max-width:92vw;text-align:center;pointer-events:none}
#fly-root .banner b{color:#8ab4ff}
#fly-root .time{font-variant-numeric:tabular-nums;color:#aab;min-width:84px;text-align:center}
#fly-root .close{background:#7f1d1d;border-color:#7f1d1d}
#fly-root .walk-help{position:fixed;right:18px;bottom:18px;width:250px;pointer-events:auto;
  background:rgba(20,22,26,.9);backdrop-filter:blur(6px);color:#e9eaec;padding:13px 15px;border-radius:12px;
  box-shadow:0 8px 24px rgba(0,0,0,.3)}
#fly-root .walk-help h4{margin:0 0 8px;font-size:13px;color:#8ab4ff;letter-spacing:.02em}
#fly-root .walk-help ol{margin:0;padding-left:18px;font-size:12.5px;line-height:1.7;color:#d7d9dd}
#fly-root .walk-help .keys{margin-top:9px;display:flex;gap:5px;flex-wrap:wrap}
#fly-root .walk-help kbd{background:#363b44;border:1px solid rgba(255,255,255,.18);border-bottom-width:2px;
  border-radius:5px;padding:2px 7px;font:600 11px ui-monospace,monospace;color:#fff}
#fly-root .walk-help .hint{margin-top:9px;font-size:11.5px;color:#9aa}
/* While the flythrough is open, hide the app's furniture HTML overlays — the
   floating lock badges + selected-item edit toolbars. They're positioned for
   the app's own camera, so under the flythrough cameras they balloon and
   clutter (and would steal authoring clicks). display:none also removes them
   from hit-testing. They return the instant the panel closes. */
body.flythrough-active .lock-badge,
body.flythrough-active .item-toolbar,
body.flythrough-active .vp-hint,
body.flythrough-active .house-room-size-editor,
body.flythrough-active .dim-label{display:none !important}
`

export function FlythroughHud({ controller }: { controller: FlythroughController | null }) {
  const [, force] = useReducer((x: number) => x + 1, 0)
  const scrubRef = useRef<HTMLInputElement | null>(null)
  const timeRef = useRef<HTMLSpanElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return
    const el = document.createElement('style')
    el.id = STYLE_ID
    el.textContent = CSS
    document.head.appendChild(el)
  }, [])

  useEffect(() => {
    if (!controller) return
    return controller.subscribe(() => force())
  }, [controller])

  // While the panel is open AND not in Edit-furniture mode: hide the app's
  // furniture HTML overlays and LOCK all furniture so it can't be nudged while
  // authoring the camera path. Toggling "Edit furniture" (or closing) lifts this
  // and restores prior lock states, so normal select/move/rotate/delete works.
  const open = controller?.snapshot().open ?? false
  const edit = controller?.snapshot().editMode ?? false
  const lockActive = open && !edit
  useEffect(() => {
    document.body.classList.toggle('flythrough-active', lockActive)
    if (lockActive) {
      const st = useStore.getState()
      // deselect so no selection wireframe/handles linger in the flythrough view
      st.selectFurniture(null)
      st.selectOpening(null)
      const prior = st.design.furniture.map((f) => ({ id: f.id, locked: !!f.locked }))
      prior.forEach((p) => { if (!p.locked) st.updateFurniture(p.id, { locked: true }) })
      // keep nothing selected while the panel is open (locked items can still be
      // click-selected by the app, which would draw a selection outline)
      const unsub = useStore.subscribe((s) => {
        if (s.selectedFurnitureId || s.selectedOpeningId) {
          s.selectFurniture(null)
          s.selectOpening(null)
        }
      })
      return () => {
        unsub()
        document.body.classList.remove('flythrough-active')
        // restore: unlock anything that wasn't locked before
        const upd = useStore.getState().updateFurniture
        prior.forEach((p) => { if (!p.locked) upd(p.id, { locked: false }) })
      }
    }
    return () => document.body.classList.remove('flythrough-active')
  }, [lockActive])

  // live-update the scrubber/time during playback or export without re-rendering
  useEffect(() => {
    if (!controller) return
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const s = controller.snapshot()
      if ((s.isPlaying || s.isExporting) && scrubRef.current && timeRef.current) {
        scrubRef.current.value = String(s.progress)
        timeRef.current.textContent = `${(s.progress * s.total).toFixed(1)} / ${s.total.toFixed(1)}s`
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [controller])

  if (!controller) return null
  const s = controller.snapshot()

  if (!s.open) {
    return (
      <button id="fly-launch" onClick={() => { controller.openPanel(); force() }}>
        🎥 Flythrough
      </button>
    )
  }

  // [label, body] rather than an HTML string: this used to be rendered through
  // dangerouslySetInnerHTML purely to bold the lead-in word. The strings are all
  // literals today, so it was not exploitable — but it left a live HTML sink one
  // interpolation away from an XSS (a room, listing or user name spliced in here
  // would execute). Structured data + JSX removes the sink entirely.
  const banner: readonly [string, string] = s.editMode
    ? ['Edit furniture', '— click an item to select it, then move / rotate (front knob) / delete (trash). Toggle off to resume the camera path.']
    : s.mode === 'walk'
      ? (s.isRecording
          ? ['Recording walk', '— move with WASD; your path is being traced. Stop & build when done.']
          : ['Walk', '— click to look around · WASD to move · collides with walls & furniture'])
      : s.pov
        ? ['Camera POV', '— preview of the recording camera. Tap Top-down to edit the path.']
        : ['Director (top-down)', '— click the floor to drop waypoints; drag to reshape; set per-point look-at + dwell.']

  return (
    <div id="fly-root">
      <div className="bar">
        <div className="group">
          <span className="label">Flythrough</span>
          <button className={s.mode === 'director' && !s.editMode ? 'active' : ''} onClick={() => { if (s.editMode) controller.toggleEdit(); controller.setMode('director') }}>Director</button>
          <button className={s.mode === 'walk' ? 'active' : ''} onClick={() => { if (s.editMode) controller.toggleEdit(); controller.setMode('walk') }} disabled={s.editMode}>Walk</button>
          <button className="close" onClick={() => { controller.closePanel(); force() }}>✕ Close</button>
        </div>
        <div className="group">
          <button className={s.editMode ? 'active' : ''} onClick={() => controller.toggleEdit()} title="Edit room furniture without leaving the flythrough">
            ✏️ {s.editMode ? 'Done editing' : 'Edit furniture'}
          </button>
        </div>
        {s.mode === 'director' && !s.editMode && (
          <div className="group">
            <button className={s.pov ? 'active' : ''} onClick={() => controller.togglePov()}>⤢ {s.pov ? 'Top-down' : 'Camera POV'}</button>
          </div>
        )}
        {s.mode === 'walk' && (
          <div className="group">
            <button className={s.isRecording ? 'active' : ''} onClick={() => controller.toggleRecord()}>
              {s.isRecording ? '■ Stop & build path' : '● Record walk'}
            </button>
          </div>
        )}
        {s.pathEditable && (
          <div className="group">
            <span className="label">Path</span>
            <span className="label">{s.count} pts{s.selected ? ` · #${s.selected.index + 1}` : ''}</span>
            <button onClick={() => controller.path.removeSelected()}>Delete pt</button>
            <button onClick={() => controller.path.clear()}>Clear</button>
            <button className={s.settingLookAt ? 'active' : ''} onClick={() => { controller.path.beginSetLookAt(); force() }}>Set look-at</button>
            <button onClick={() => controller.path.clearLookAt()}>Auto look</button>
            <span className="label">dwell</span>
            <input type="number" min={0} step={0.25} defaultValue={s.selected?.dwell ?? 0}
              key={`dwell-${s.selected?.index ?? -1}-${s.selected?.dwell ?? 0}`}
              onChange={(e) => controller.path.setDwell(parseFloat(e.target.value) || 0)} />
            <label className="label"><input type="checkbox" checked={s.loop} onChange={(e) => controller.path.setLoop(e.target.checked)} /> loop</label>
            <button onClick={() => { if (s.hasCurve) downloadPath(controller.currentPath()) }}>Save JSON</button>
            <button onClick={() => fileRef.current?.click()}>Load JSON</button>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) { try { controller.loadPath(await readPathFile(f)) } catch (err) { alert('Load failed: ' + (err as Error).message) } }
                e.currentTarget.value = ''
              }} />
          </div>
        )}
      </div>

      {s.mode === 'director' && s.hasCurve && !s.editMode && (
        <div className="transport">
          <button onClick={() => controller.playPause()}>{s.isPlaying ? '❚❚ Pause' : '▶ Play'}</button>
          <input ref={scrubRef} type="range" min={0} max={1} step={0.001} defaultValue={s.progress}
            onInput={(e) => controller.seek(parseFloat((e.target as HTMLInputElement).value))} />
          <span className="time" ref={timeRef}>{(s.progress * s.total).toFixed(1)} / {s.total.toFixed(1)}s</span>
          <label className="label">dur <input type="number" min={1} step={1} defaultValue={s.duration}
            key={`dur-${s.duration}`} onChange={(e) => controller.setDuration(parseFloat(e.target.value) || 8)} />s</label>
          <button disabled={s.isExporting} onClick={async () => {
            const res = await controller.export(true)
            if (res) alert(`Exported ${res.frames} frames @ ${res.width}×${res.height} — downloading .mp4 (${res.webcodecs ? 'WebCodecs' : 'H264 fallback'})`)
          }}>{s.isExporting ? 'Exporting…' : '⤓ Export MP4'}</button>
        </div>
      )}

      {s.mode === 'walk' && (
        <div className="walk-help">
          <h4>🚶 First-person walk</h4>
          <ol>
            <li><b>Click the room</b> to capture the mouse</li>
            <li><b>Move the mouse</b> to look around</li>
            <li><b>WASD</b> / arrow keys to walk</li>
            <li><b>Esc</b> to release the mouse</li>
          </ol>
          <div className="keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>Esc</kbd></div>
          <div className="hint">You collide with walls &amp; furniture — you can’t walk through them.</div>
        </div>
      )}

      <div className="banner"><b>{banner[0]}</b> {banner[1]}</div>
    </div>
  )
}
