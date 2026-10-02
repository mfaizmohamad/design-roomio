import { Suspense, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, ContactShadows, SoftShadows } from '@react-three/drei'
import { useStore } from '../store'
import { bbox } from '../geometry/walls'
import { Room } from './Room'
import { EditHandles } from './EditHandles'
import { OpeningEditor } from './OpeningEditor'
import { FurnitureEditor } from './FurnitureEditor'
import { setViewCapturer, setViewApplier } from './cameraBus'
import { SceneBridge, FlythroughHud } from './Flythrough'
import type { FlythroughController } from '../../camera-flythrough/src/engine/FlythroughController'
import type { Camera } from 'three'
import type { CameraView } from '../types'
// Agent E lighting (drop-in): layered default room lights + directional sun + soft shadows,
// driven by the time bar / north controls. Replaces the old local <Lights>.
import { LightingRig } from '../../lighting/src/r3f/LightingRig'
import { Ceiling } from '../../lighting/src/r3f/Ceiling'
import { LightingControls } from '../../lighting/src/ui/LightingControls'
import { useLighting } from '../../lighting/src/store'
import { makeFrame } from './coords'
import { getFloorTexture } from './textures'
// Agent E multi-room "whole house" overview: render all session rooms together,
// interconnected, instead of editing one at a time. Toggle via useHouseView.
import { useHouse } from './houseSession'
import { useHouseView } from './houseViewMode'
import { HouseView, RoomFurniture } from './HouseView'
import { ColliderDebug } from './ColliderDebug'
import { layoutHouse, houseBoundsCm } from './houseLayout'
import { placementsFor, focusLevel, activeLevel, visiblePlacements } from './houseLevels'
// Agent G realistic rendering (drop-in): PBR + HDR-IBL + ACESFilmic tone mapping + AO + emissive
// bulbs/bloom + area lights, layered ON TOP of E's lighting. Mounts as <Canvas> children (no Canvas-
// prop changes: `flat` is KEPT so the post EffectComposer owns tone mapping). RenderControls is the
// quality/exposure/beauty-shot panel. See rendering/INTEGRATION.md.
import { RealismLayer } from '../../rendering/src/r3f/RealismLayer'
import { RenderControls } from '../../rendering/src/ui/RenderControls'
import { useRender } from '../../rendering/src/store'
// Agent G: window-as-light-source when the lamps are off (per-window area light + emissive sky pane).
import { WindowDaylight } from './WindowDaylight'
import { ARCHETYPE_MAP } from '../data/archetypes'
// 2D top-down floor-plan arranger — the intuitive way to reposition rooms (replaces the 3D drag).
import { PlanArranger } from './PlanArranger'
// Client resilience: scene-level error boundary (branded fallback + Canvas remount)
// and WebGL context-loss overlay — a GPU reset must never leave a silent black box.
import { ErrorBoundary } from '../ErrorBoundary'
import { ContextLossWatcher, ContextLossOverlay, useWebglContext } from './ContextLoss'

type ControlsLike = {
  target: { set: (x: number, y: number, z: number) => void; toArray: () => number[] }
  update: () => void
} | null

/** Shared pill style for the consolidated viewport toolbar. */
function toolbarChip(active: boolean, activeBg = '#111', activeFg = '#fff'): CSSProperties {
  return {
    padding: '8px 14px',
    borderRadius: 999,
    border: '1px solid rgba(0,0,0,0.12)',
    background: active ? activeBg : '#fff',
    color: active ? activeFg : '#23211e',
    font: '13px ui-sans-serif, system-ui, sans-serif',
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
  }
}

/**
 * Refit the camera on shape change / fitNonce bump. If the loaded design carries
 * a saved view (set when the user pressed Save), restore that exact viewpoint so
 * reopening a previous state looks identical; otherwise frame the room by default.
 */
function CameraFit() {
  const shape = useStore((s) => s.design.shape)
  const fitNonce = useStore((s) => s.fitNonce)
  const { camera, controls, size } = useThree()
  // Tall (portrait-ish) canvases — narrow windows, tablets — have a much narrower horizontal
  // FOV, so the default framing pushes the side walls (and their dimension labels) off-screen.
  // Quantised so drag-resizing doesn't refit on every pixel, only when the aspect meaningfully
  // changes bucket.
  const aspectKey = Math.round((size.width / Math.max(1, size.height)) * 4) / 4
  useEffect(() => {
    const c = controls as unknown as ControlsLike
    const saved = useStore.getState().design.view
    if (saved) {
      camera.position.set(saved.cam[0], saved.cam[1], saved.cam[2])
      camera.updateProjectionMatrix()
      if (c?.target) {
        c.target.set(saved.target[0], saved.target[1], saved.target[2])
        c.update()
      }
      return
    }
    const b = bbox(useStore.getState().design.corners)
    const r = Math.max(b.w, b.d, 300) / 100
    // Pull back on tall canvases so the room still fits horizontally (aspect < ~0.9).
    const aspect = size.width / Math.max(1, size.height)
    const fitBoost = Math.min(2.6, Math.max(1, 0.9 / aspect))
    const dist = r * 1.45 * fitBoost
    camera.position.set(dist * 0.62, dist * 0.72, dist * 0.8)
    camera.updateProjectionMatrix()
    if (c?.target) {
      c.target.set(0, 0.7, 0)
      c.update()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, fitNonce, aspectKey])
  return null
}

/** Snap the camera to a top-down 2D "plan" view when requestPlanView() is called. */
function PlanViewSnap({ radius }: { radius: number }) {
  const nonce = useHouseView((s) => s.planNonce)
  const { camera, controls } = useThree()
  useEffect(() => {
    if (nonce === 0) return // skip initial mount
    const h = Math.max(radius * 2.4, 4)
    camera.position.set(0.001, h, 0.001) // directly above centre, looking straight down
    camera.updateProjectionMatrix()
    const c = controls as unknown as ControlsLike
    if (c?.target) {
      c.target.set(0, 0, 0)
      c.update()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce])
  return null
}

/** Registers a capturer so the UI can read the current camera view at save time,
 *  and an applier so scripted tours/screenshots can place the camera exactly. */
function ViewCapturer() {
  const { camera, controls } = useThree()
  useEffect(() => {
    setViewCapturer((): CameraView | null => {
      const c = controls as unknown as ControlsLike
      const t = c?.target?.toArray?.() ?? [0, 0.7, 0]
      return {
        cam: [camera.position.x, camera.position.y, camera.position.z],
        target: [t[0], t[1], t[2]],
      }
    })
    setViewApplier((view: CameraView) => {
      camera.position.set(view.cam[0], view.cam[1], view.cam[2])
      camera.updateProjectionMatrix()
      const c = controls as unknown as
        | (ControlsLike & { maxPolarAngle?: number; minDistance?: number })
        | null
      if (c?.target) {
        // Scripted poses may exceed the interactive clamps: an up-looking pose
        // (ceiling shot) needs more polar range, and an inside-a-room pose sits
        // closer to its target than the orbit minDistance — widen both so
        // update() keeps the requested view instead of snapping it away.
        const dy = view.target[1] - view.cam[1]
        const dxz = Math.hypot(view.target[0] - view.cam[0], view.target[2] - view.cam[2])
        const polar = Math.PI / 2 + Math.atan2(dy, dxz)
        if (typeof c.maxPolarAngle === 'number' && polar > c.maxPolarAngle) {
          c.maxPolarAngle = Math.min(Math.PI - 0.01, polar + 0.05)
        }
        const dist = Math.hypot(dxz, dy)
        if (typeof c.minDistance === 'number' && dist < c.minDistance) {
          c.minDistance = Math.max(0.1, dist * 0.95)
        }
        c.target.set(view.target[0], view.target[1], view.target[2])
        c.update()
      }
    })
    return () => {
      setViewCapturer(() => null)
      setViewApplier(() => {})
    }
  }, [camera, controls])
  return null
}

export function RoomView({ children, buyerMode = false, onWalkController }: {
  children?: ReactNode
  buyerMode?: boolean
  /** Buyer tours: receive the flythrough controller to drive a first-person
   *  walkthrough with their own UI (the editor's flythrough HUD stays hidden). */
  onWalkController?: (c: FlythroughController | null) => void
}) {
  const corners = useStore((s) => s.design.corners)
  const stage = useStore((s) => s.stage)
  const designId = useStore((s) => s.design.id)
  const wallHeight = useStore((s) => s.design.wallHeight)
  const furniture = useStore((s) => s.design.furniture)
  const ceilingSpec = useStore((s) => s.design.ceiling)

  // Switchable lamp fixtures in the room, for the Render panel's per-lamp toggles. Only meaningful
  // while furniture is on screen (furnish stage). Duplicate names get a numeric suffix.
  const lamps = useMemo(() => {
    if (stage !== 'furnish') return []
    const seen: Record<string, number> = {}
    return furniture
      .filter((f) => ARCHETYPE_MAP[f.archetype]?.model === 'lamp')
      .map((f) => {
        const base = ARCHETYPE_MAP[f.archetype]?.name ?? 'Lamp'
        seen[base] = (seen[base] ?? 0) + 1
        return { id: f.id, label: seen[base] > 1 ? `${base} ${seen[base]}` : base }
      })
  }, [furniture, stage])
  const [flyController, setFlyController] = useState<FlythroughController | null>(null)
  // Pin OrbitControls to the ORIGINAL camera so drei never rebinds it to (and
  // clobbers) the flythrough's swapped-in cameras. Captured once on Canvas create.
  const [origCam, setOrigCam] = useState<Camera | null>(null)
  // Bumping this key remounts the <Canvas> — a fresh canvas element and WebGL
  // context. Used by the scene error boundary and the context-loss overlay.
  const [glKey, setGlKey] = useState(0)
  const restartCanvas = () => {
    useWebglContext.setState({ lost: false })
    setOrigCam(null)
    setGlKey((k) => k + 1)
  }

  // Room polygon in world meters, for the ceiling/roof.
  const ceilingCorners = useMemo(() => {
    const f = makeFrame(corners)
    return corners.map((c) => f.toWorld(c.x, c.z) as [number, number])
  }, [corners])
  const roomFrame = useMemo(() => makeFrame(corners), [corners])

  // Per-room ceiling treatment (design.ceiling): plank cladding + single
  // downlight for the balcony look; default plaster otherwise.
  const ceilingLook = useMemo(() => {
    if (!ceilingSpec) return { map: null as import('three').Texture | null, areaM: 1.6, color: undefined as string | undefined, downlights: 'grid' as const }
    let map: import('three').Texture | null = null
    let areaM = 1.6
    if (ceilingSpec.texture) {
      const built = getFloorTexture(ceilingSpec.texture)
      map = built.texture
      areaM = built.areaCm / 100
    }
    return {
      map,
      areaM,
      color: ceilingSpec.color,
      downlights: (ceilingSpec.downlight ? 'single' : 'grid') as 'single' | 'grid',
    }
  }, [ceilingSpec])

  // Every room gets sensible default lights the moment it exists (Pillar 1: never a dark box).
  useEffect(() => {
    const d = useStore.getState().design
    useLighting.getState().ensureRoom({
      id: d.id,
      centerM: [0, 0], // room is centered on its bbox center (coords.ts)
      wallHeightM: d.wallHeight / 100,
    })
  }, [designId])

  const { camPos, radius, floorW, floorD } = useMemo(() => {
    const b = bbox(corners)
    const r = Math.max(b.w, b.d, 300) / 100
    return {
      camPos: [r * 0.62, r * 0.72, r * 0.8] as [number, number, number],
      radius: r,
      // Actual floor footprint in metres — used to size the contact-shadow plane so its
      // soft shadow stays UNDER the room instead of bleeding onto the background.
      floorW: Math.max(b.w, 100) / 100,
      floorD: Math.max(b.d, 100) / 100,
    }
  }, [corners])

  // Whole-house overview mode: lay out all session rooms interconnected.
  const viewMode = useHouseView((s) => s.mode)
  const debugColliders = useHouseView((s) => s.debugColliders)
  const houseRooms = useHouse((s) => s.rooms)
  const activeId = useHouse((s) => s.activeId)
  const houseLevels = useHouse((s) => s.levels)
  const levelFilter = useHouseView((s) => s.levelFilter)
  const roomFilter = useHouseView((s) => s.roomFilter)
  const liveDesign = useStore((s) => s.design)
  const houseMode = viewMode === 'house' && houseRooms.length > 1

  // PCSS soft-shadow config (see lighting/types ShadowState.soft). The renderer uses
  // PCFSoftShadowMap, whose directional-light path ignores light.shadow.radius, so the
  // sun-shadow softening comes from drei <SoftShadows> (a global shadow-shader patch)
  // mounted ONCE at the Canvas top level below — stable across house/room + day/night
  // so the patch never thrashes (it disposes+recompiles all materials on mount/unmount).
  const softShadow = useLighting((s) => s.shadow.soft)

  // Light Mode traces sunlight coming through windows, so it's only available when SOME room in the
  // house actually has a window. Check the live (active) design plus every other saved room.
  const lightMode = useLighting((s) => s.lightMode)
  const hasAnyWindow = useMemo(() => {
    const hasWin = (ops: { kind: string }[] | undefined) => !!ops?.some((o) => o.kind === 'window')
    if (hasWin(liveDesign.openings)) return true
    return houseRooms.some((r) => r.id !== activeId && hasWin(r.design.openings))
  }, [liveDesign, houseRooms, activeId])

  // Lock: drop out of Light Mode automatically if the last window is removed (nothing to trace).
  useEffect(() => {
    if (lightMode && !hasAnyWindow) useLighting.getState().toggleLightMode(false)
  }, [lightMode, hasAnyWindow])

  // Ray-trace the sun: entering Light Mode kicks the path-traced hero still (three-gpu-pathtracer),
  // which accumulates while the camera is held static and falls back to raster on orbit. Off on exit.
  useEffect(() => {
    const r = useRender.getState()
    if (lightMode) {
      if (r.heroSupported) r.setHeroActive(true)
    } else {
      r.setHeroActive(false)
    }
  }, [lightMode])
  // `placed` = what the 3D view draws (every storey, or the isolated one);
  // `planPlaced` = the ONE storey the 2D plan edits (rooms on other storeys
  // overlap in plan). Bounds come from all storeys so the camera frame and the
  // house origin don't jump when a storey is isolated.
  // A room selection (buyer tour multi-select) also frames the camera on just
  // those rooms (`fitBounds`); without one the frame stays on the whole house.
  const { placed, planPlaced, houseBounds, fitBounds } = useMemo(() => {
    if (!houseMode) return { placed: [], planPlaced: [], houseBounds: { w: 0, d: 0, cx: 0, cz: 0 }, fitBounds: undefined }
    const session = { rooms: houseRooms, activeId, levels: houseLevels }
    const everything = layoutHouse(placementsFor(session, liveDesign))
    const shown = visiblePlacements(everything, levelFilter, roomFilter)
    const focus = focusLevel(levelFilter, activeLevel(session))
    return {
      placed: shown,
      planPlaced: everything.filter((p) => p.level === focus),
      houseBounds: houseBoundsCm(everything),
      fitBounds: roomFilter.length > 0 && shown.length > 0 ? houseBoundsCm(shown) : undefined,
    }
  }, [houseMode, houseRooms, activeId, houseLevels, levelFilter, roomFilter, liveDesign])
  const viewRadius = houseMode ? Math.max(houseBounds.w, houseBounds.d, 300) / 100 : radius

  return (
    <>
    <ErrorBoundary variant="scene" onReset={restartCanvas}>
    <Canvas
      key={glKey}
      shadows
      flat
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      camera={{ position: camPos, fov: 40, near: 0.1, far: 200 }}
      onCreated={(s) => setOrigCam(s.camera)}
    >
      <ContextLossWatcher />
      <color attach="background" args={['#cdccc9']} />
      {/* Agent G: realism layer (IBL + material enhance + EffectComposer). One mount covers both
          single-room and whole-house mode (HouseView renders inside this same Canvas). */}
      <RealismLayer />
      {/* Contact-hardening PCSS for the single sun caster — softens wall/floor + furniture
          contacts and turns thin fan-blade shadows soft/faint (they sit high above the floor,
          so their penumbra is wide). Mounted here (not in Sun) so the global shadow-shader
          patch is applied exactly once and never thrashes on mode/time-of-day changes. */}
      {softShadow && <SoftShadows size={softShadow.size} samples={softShadow.samples} focus={softShadow.focus} />}
      {houseMode ? (
        <Suspense fallback={null}>
          <HouseView placed={placed} bounds={houseBounds} fitTo={fitBounds} readOnly={buyerMode} />
          {children}
        </Suspense>
      ) : (
        <>
          <LightingRig houseHalfExtentM={radius / 2} activeRoomId={designId} />
          <Suspense fallback={null}>
            <Room />
            <WindowDaylight />
            <Ceiling
              cornersWorld={ceilingCorners}
              heightM={wallHeight / 100}
              visualColor={ceilingLook.color}
              textureMap={ceilingLook.map}
              textureAreaM={ceilingLook.areaM}
              downlights={ceilingLook.downlights}
            />
            {!buyerMode && stage === 'step2' && <EditHandles />}
            {!buyerMode && stage === 'step3' && <OpeningEditor />}
            {/* Buyer room mode must show furnished rooms without mounting editor gestures.
                Suppressing FurnitureEditor alone previously left this view empty. */}
            {buyerMode && <RoomFurniture design={liveDesign} frame={roomFrame} />}
            {!buyerMode && stage === 'furnish' && <FurnitureEditor />}
            {children}
            {/* Contact shadow sized to HUG the floor footprint (+15% margin). Previously
                scale={radius*4.2} made the plane ~4× the room, so its soft blurred shadow
                spilled far past the walls and banded into concentric "rings" on the empty
                grey background (worst at grazing / zoomed-out angles — the reported bug).
                frames={1}: bake the depth pass ONCE instead of re-rendering a full depth
                pass every frame on top of the sun shadow. drei's ContactShadows resets its
                bake counter on every React re-render, and this component re-renders whenever
                `furniture` (a store selector above) changes — so it re-bakes automatically
                on any furniture move/resize with no stale shadow and no per-frame cost. */}
            <ContactShadows
              frames={1}
              position={[0, 0.002, 0]}
              scale={[floorW * 1.15, floorD * 1.15]}
              resolution={512}
              blur={2.4}
              opacity={0.38}
              far={6}
            />
          </Suspense>
          <CameraFit />
        </>
      )}
      {!buyerMode && <ColliderDebug />}
      <PlanViewSnap radius={viewRadius} />
      <OrbitControls
        makeDefault
        camera={origCam ?? undefined}
        target={[0, 0.7, 0]}
        enablePan
        minDistance={viewRadius * 0.4}
        maxDistance={viewRadius * 5}
        maxPolarAngle={Math.PI / 2.05}
        enableDamping
        dampingFactor={0.13}
      />
      <ViewCapturer />
      {/* Editor: drives the flythrough HUD. Buyer tour: only when the tour asked for
          the controller (walkthrough); otherwise buyer mode mounts no flythrough. */}
      {!buyerMode && <SceneBridge onController={setFlyController} />}
      {buyerMode && onWalkController && <SceneBridge onController={onWalkController} />}
    </Canvas>
    </ErrorBoundary>
    <ContextLossOverlay onRestart={restartCanvas} />
    {!buyerMode && <FlythroughHud controller={flyController} />}
    {/* anchorRightPx clears the .vp-tools view toolbar (right:18px + 40px wide ⇒ 58px)
        so the "💡 Light Mode" launcher/panel doesn't overlap the undo/redo/fit/home buttons. */}
    {!buyerMode && <LightingControls hasWindows={hasAnyWindow} anchorRightPx={66} />}
    {/* Agent G: render quality / exposure / IBL / beauty-shot panel. Bottom, anchored just past
        A's left panel (var(--panel-w) tracks its responsive breakpoints — 432/360/300px) and
        clamped to the viewport so it stays reachable at narrow window widths. */}
    {!buyerMode && <RenderControls
      anchorLeftPx="min(calc(var(--panel-w, 440px) + 20px), calc(100vw - 244px))"
      anchorBottomPx={12}
      lamps={lamps}
    />}
    {/* 2D floor-plan arranger — only in whole-house mode. Bottom-right, raised above B's flythrough
        launcher. Drag room rectangles here (not in 3D) to reposition them; the 3D view updates live. */}
    {!buyerMode && houseMode && <PlanArranger placed={planPlaced} bounds={houseBounds} anchorRightPx={14} anchorBottomPx={72} />}
    {/* Consolidated viewport toolbar (one coherent group, top-centre):
        2D plan view · whole-house toggle (2+ rooms) · collider-debug. */}
    {!buyerMode && <div style={{ position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 10, display: 'flex', gap: 8 }}>
      <button
        onClick={() => useHouseView.getState().requestPlanView()}
        aria-label="Top-down 2D plan view"
        title="Snap to a top-down 2D plan view"
        style={toolbarChip(false)}
      >
        ⬓ Plan view
      </button>
      {houseRooms.length > 1 && (
        <button
          onClick={() => useHouseView.getState().toggle()}
          aria-label={houseMode ? 'Switch to editing a single room' : 'View the whole house'}
          aria-pressed={houseMode}
          title={houseMode ? 'Back to editing one room' : 'See all rooms together as a connected house'}
          style={toolbarChip(houseMode)}
        >
          {houseMode ? '🚪 Edit a room' : '🏠 View whole house'}
        </button>
      )}
      <button
        onClick={() => useHouseView.getState().toggleDebugColliders()}
        aria-label="Toggle the collision-footprint debug overlay"
        aria-pressed={debugColliders}
        title="Show the flythrough collision footprints (wireframes) — to test for invisible-wall bugs"
        style={toolbarChip(debugColliders, '#ff2bd6', '#fff')}
      >
        ▦ Colliders
      </button>
    </div>}

    {/* Light Mode lock notice — a single, always-visible in-canvas pill so the user knows furniture
        is locked WITHOUT spraying a 🔒 badge over every piece (that clutter was removed). Stays
        visible even if the Lighting panel (which has its own banner) is collapsed/closed. */}
    {!buyerMode && lightMode && (
      <div
        style={{
          position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)', zIndex: 10,
          display: 'flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 999,
          background: 'rgba(180,120,20,0.92)', color: '#fff',
          font: '600 12.5px ui-sans-serif, system-ui, sans-serif',
          boxShadow: '0 4px 16px rgba(0,0,0,0.22)', pointerEvents: 'none', whiteSpace: 'nowrap',
        }}
        role="status"
        aria-live="polite"
      >
        <span aria-hidden>🔒</span> Sun Mode — furniture is locked
      </div>
    )}
    </>
  )
}
