/**
 * HouseView (Agent E, multi-room) — renders ALL session rooms together as one
 * interconnected floor plan (read-only overview), instead of editing one room at
 * a time. Each room is placed at its house-plane position (houseLayout) with a
 * doorway cut to its neighbour, so you see the whole house with rooms connected.
 *
 * Reuses Agent A's PURE geometry (makeFrame / deriveWalls / buildWallParts /
 * pointOnWall) and renderers (getFloorTexture, FurnitureModel) read-only — A's
 * Room.tsx is untouched. The house is centred at the world origin so the sun's
 * shadow frustum and the camera framing stay simple.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useHouse } from './houseSession'
import { useStore } from '../store'
import { ContactShadows, Html } from '@react-three/drei'
import { makeFrame, type Frame } from './coords'
import { deriveWalls, buildWallParts, bbox } from '../geometry/walls'
import { parseLen, formatLenShort, clampWallLength, type Unit } from '../units'
import { getFloorTexture } from './textures'
import { FLOOR_MAP } from '../data/materials'
import { ARCHETYPE_MAP, mountOf } from '../data/archetypes'
import { elevationCm, restsOnSurface } from './mount'
import { FurnitureModel } from './Furniture3D'
import { FloorSurfaceMaterial } from './FloorMaterial'
import { WallPartMesh } from './WallPartMesh'
import { OpeningMesh } from './Openings3D'
import { RoomTrim } from './Trim'
import { Sun } from '../../lighting/src/r3f/Sun'
import { useLighting } from '../../lighting/src/store'
import type { PlacedRoom } from './houseLayout'
import type { RoomDesign, Vec2 } from '../types'

interface Bounds {
  w: number
  d: number
  cx: number
  cz: number
}

function RoomFloor({
  corners,
  floorTexture,
  frame,
  reflector = false,
  onPointerDown,
  onPointerUp,
}: {
  corners: Vec2[]
  floorTexture: string
  frame: Frame
  /** true only for the ONE dominant glossy floor (see the max-1-reflection invariant). */
  reflector?: boolean
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void
  onPointerUp?: (e: ThreeEvent<PointerEvent>) => void
}) {
  const geom = useMemo(() => {
    const pts = corners.map((c) => {
      const [x, z] = frame.toWorld(c.x, c.z)
      return new THREE.Vector2(x, z)
    })
    const tris = THREE.ShapeUtils.triangulateShape(pts, [])
    const positions: number[] = []
    const uvs: number[] = []
    const normals: number[] = []
    const { texture, areaCm } = getFloorTexture(floorTexture)
    const repeat = areaCm / 100
    for (const tri of tris) {
      for (const idx of tri) {
        const v = pts[idx]
        positions.push(v.x, 0, v.y)
        uvs.push(v.x / repeat, v.y / repeat)
        normals.push(0, 1, 0)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    return { g, texture }
  }, [corners, floorTexture, frame])

  return (
    <mesh geometry={geom.g} receiveShadow onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <FloorSurfaceMaterial floorId={floorTexture} texture={geom.texture} reflector={reflector} />
    </mesh>
  )
}

/** Static furniture meshes for both the house overview and buyer room view. */
export function RoomFurniture({ design, frame }: { design: RoomDesign; frame: Frame }) {
  return (
    <>
      {design.furniture.map((item) => {
        const arch = ARCHETYPE_MAP[item.archetype]
        if (!arch) return null
        const [wx, wz] = frame.toWorld(item.x, item.z)
        const elevM = elevationCm(item, design.furniture, design.corners) / 100
        // Wall-hung (no console beneath) → the TV builder drops its floor pedestal.
        const wallMounted = mountOf(item.archetype) === 'wall' && !restsOnSurface(item, design.furniture)
        return (
          <group key={item.id} position={[wx, elevM, wz]} rotation={[0, item.rotation, 0]}>
            <FurnitureModel model={arch.model} w={item.w} d={item.d} h={item.h} color={item.color} wallMounted={wallMounted} assetRef={item.assetRef} />
          </group>
        )
      })}
    </>
  )
}

/** One placed room: floor + walls (doorways cut) + static furniture, offset to its
 *  house position (relative to the house centre at the world origin). */
function RoomShell({
  placed,
  originCm,
  reflectFloor = false,
  onSelect,
}: {
  placed: PlacedRoom
  originCm: { x: number; z: number }
  /** true only for the single dominant glossy floor — grants it the one planar reflection pass. */
  reflectFloor?: boolean
  /** Click the room's floor to SELECT it (repositioning is done in the 2D plan panel, not here). */
  onSelect?: () => void
}) {
  const { design, centerCm, extraOpenings } = placed
  const frame = useMemo(() => makeFrame(design.corners), [design.corners])
  const walls = useMemo(() => deriveWalls(design.corners), [design.corners])
  const openings = useMemo(() => [...design.openings, ...extraOpenings], [design.openings, extraOpenings])
  // Skirting/cornice break at every hole (incl. auto-cut connect doorways); casing
  // frames only the room's own real (non-bare) openings, matching OpeningMesh below.
  const frameOpenings = useMemo(() => design.openings.filter((o) => !o.bare), [design.openings])

  const offX = (centerCm.x - originCm.x) / 100
  const offZ = (centerCm.z - originCm.z) / 100
  const wallGroupRefs = useRef<(THREE.Group | null)[]>([])

  // Dollhouse cull across the whole house: hide a wall when its interior face points
  // away from the camera, so you can see into every room from above.
  useFrame((state) => {
    const camX = state.camera.position.x
    const camZ = state.camera.position.z
    walls.forEach((w, i) => {
      const g = wallGroupRefs.current[i]
      if (!g) return
      const [mxW, mzW] = frame.toWorld(w.midX, w.midZ)
      const wx = offX + mxW
      const wz = offZ + mzW
      const dot = w.nx * (camX - wx) + w.nz * (camZ - wz)
      g.visible = dot > -0.05
    })
  })

  return (
    // storeys stack: the whole room (floor, walls, furniture) lifts to its level
    <group position={[offX, placed.elevationCm / 100, offZ]}>
      <RoomFloor
        corners={design.corners}
        floorTexture={design.materials.floorTexture}
        frame={frame}
        reflector={reflectFloor}
        onPointerDown={
          onSelect
            ? (e) => {
                e.stopPropagation()
                onSelect()
              }
            : undefined
        }
      />
      {walls.map((w, i) => {
        const wallOpenings = openings.filter((o) => o.wallId === w.id)
        const parts = buildWallParts(w, wallOpenings, design.wallHeight, design.wallThickness)
        return (
          <group key={w.id} ref={(el) => (wallGroupRefs.current[i] = el)}>
            {parts.map((p, j) => (
              <WallPartMesh key={j} part={p} wall={w} walls={walls} frame={frame}
                thickness={design.wallThickness} color={design.materials.wallColor} texture={design.materials.wallTexture} />
            ))}
            {/* real door/window frames (authored openings only — the auto-cut
                'connect_*' doorways and bare far-side holes stay frameless) */}
            {design.openings
              .filter((o) => o.wallId === w.id && !o.bare)
              .map((o) => (
                <OpeningMesh
                  key={o.id}
                  opening={o}
                  wall={w}
                  frame={frame}
                  wallHeight={design.wallHeight}
                  wallThickness={design.wallThickness}
                />
              ))}
          </group>
        )
      })}
      <RoomTrim
        walls={walls}
        frame={frame}
        wallHeight={design.wallHeight}
        wallThickness={design.wallThickness}
        holeOpenings={openings}
        frameOpenings={frameOpenings}
      />
      <RoomFurniture design={design} frame={frame} />
    </group>
  )
}

/** Frame the camera on the whole-house bounding box when it changes, or on `fitTo`
 *  (a sub-box in the same world-cm space, e.g. selected rooms) when given. The
 *  scene is drawn relative to the HOUSE centre, so the target is offset by
 *  fitTo's centre minus the house centre. */
function HouseCameraFit({ bounds, placed, fitTo }: { bounds: Bounds; placed: PlacedRoom[]; fitTo?: Bounds }) {
  const { camera: activeCamera, controls, size } = useThree()
  // Frame the camera the ORBIT controls drive, not whatever camera is active. While
  // the flythrough walks, R3F's active camera is the walker's own; this effect
  // re-ran on that camera swap and aimed the walker at the house centre, pitched
  // down — the walkthrough then started staring at the floor and "forward" went
  // the wrong way.
  const camera = (controls as unknown as { object?: THREE.Camera } | null)?.object ?? activeCamera
  const fitNonce = useStore((s) => s.fitNonce)
  const bottom = Math.min(...placed.map((p) => p.elevationCm), 0) / 100
  const top = Math.max(...placed.map((p) => p.elevationCm + p.design.wallHeight), 270) / 100
  const height = top - bottom
  const centerY = (top + bottom) / 2
  // Plain numbers, not the box objects: `bounds`/`fitTo` are rebuilt on every
  // house re-layout (any furniture edit), and depending on the objects would
  // yank the camera back to the default frame each time.
  const box = fitTo ?? bounds
  const boxW = box.w, boxD = box.d
  const offX = (box.cx - bounds.cx) / 100, offZ = (box.cz - bounds.cz) / 100
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    // Fit the entire building volume, including upper storeys, to BOTH field
    // of view axes. A footprint-only distance clipped duplexes and narrow views.
    const aspect = size.width / Math.max(1, size.height)
    const vertical = THREE.MathUtils.degToRad(camera.fov) / 2
    const horizontal = Math.atan(Math.tan(vertical) * aspect)
    const radius = Math.hypot(boxW / 100, boxD / 100, height) / 2
    const distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.08
    const direction = new THREE.Vector3(0.5, 0.65, 0.85).normalize()
    const target = new THREE.Vector3(offX, centerY, offZ)
    camera.position.copy(direction.multiplyScalar(distance)).add(target)
    camera.lookAt(target)
    camera.updateProjectionMatrix()
    const c = controls as unknown as { target?: { set: (x: number, y: number, z: number) => void }; update?: () => void } | null
    c?.target?.set(target.x, target.y, target.z)
    c?.update?.()
  }, [camera, controls, boxW, boxD, offX, offZ, height, centerY, size.width, size.height, fitNonce])
  return null
}

export function HouseView({ placed, bounds, fitTo, readOnly = false }: { placed: PlacedRoom[]; bounds: Bounds; fitTo?: Bounds; readOnly?: boolean }) {
  const houseHalfExtentM = Math.max(bounds.w, bounds.d, 300) / 100 / 2
  // Whole-house mode has its OWN hardcoded fill (separate from E's LightingRig). Scale it by the
  // same fillScale so "lamps off → daylight only" darkens the house here too, not just single-room.
  const fillScale = useLighting((s) => s.fillScale)
  const originCm = { x: bounds.cx, z: bounds.cz }
  const shadowScale = (Math.max(bounds.w, bounds.d, 300) / 100) * 1.4

  // ── Click a room to SELECT it (opens the W×D resize editor + makes it the active room). ─────────
  // Repositioning rooms now lives in the 2D Floor-plan panel (PlanArranger): a flat top-down plan is
  // the industry-standard surface for arranging rooms (Floorplanner/RoomSketcher), and a 2D drag maps
  // 1:1 to a floor coordinate with edge snapping — unlike the old depth-ambiguous drag-in-perspective
  // that fought OrbitControls. This 3D whole-house view is now a live, read-only PREVIEW; clicking a
  // room only selects it.
  const resizeRoom = useHouse((s) => s.resizeRoom)
  const switchRoom = useHouse((s) => s.switchRoom)
  const unit = useStore((s) => s.design.unit)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selectRoom = (id: string) => {
    switchRoom(id) // keep the 3D selection in sync with the 2D plan panel's active room
    setSelectedId((cur) => (cur === id ? null : id))
  }

  const selected = selectedId ? placed.find((p) => p.design.id === selectedId) ?? null : null

  // ── max-1-reflection invariant ────────────────────────────────────────────────
  // Pick the ONE glossy floor that gets a true planar reflection pass: the largest
  // glossy room (the dominant floor plane). Every other glossy floor falls back to
  // IBL env reflection in FloorSurfaceMaterial, so the whole flat renders at most one
  // MeshReflectorMaterial pass regardless of room count (was 1 per glossy floor).
  const dominantFloorIdx = useMemo(() => {
    let best = -1
    let bestArea = 0
    placed.forEach((p, i) => {
      if (!FLOOR_MAP[p.design.materials.floorTexture]?.reflect) return
      // the planar reflector is a ground-plane pass; an upper-storey floor would
      // mirror the storey beneath its own floor slab
      if (p.elevationCm !== 0) return
      const b = bbox(p.design.corners)
      const area = b.w * b.d
      if (area > bestArea) {
        bestArea = area
        best = i
      }
    })
    return best
  }, [placed])

  return (
    <>
      {/* Even, global lighting for the overview (per-room task lights would be at the
          wrong place once rooms are spread out). The sun adds soft directional shadows. */}
      <hemisphereLight color="#ffffff" groundColor="#cfcbc2" intensity={0.9 * fillScale} />
      <ambientLight intensity={0.42 * fillScale} />
      <Sun houseHalfExtentM={houseHalfExtentM} />

      {placed.map((p, i) => (
        <RoomShell
          key={`${p.design.id}_${i}`}
          placed={p}
          originCm={originCm}
          reflectFloor={i === dominantFloorIdx}
          // Buyer previews must never expose the room resize editor through a floor click.
          onSelect={readOnly ? undefined : () => selectRoom(p.design.id)}
        />
      ))}

      {/* Floating size editor for the clicked room. */}
      {!readOnly && selected && (
        <RoomSizeEditor
          key={selected.design.id}
          placed={selected}
          originCm={originCm}
          unit={unit}
          onResize={(size) => resizeRoom(selected.design.id, size)}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Bake the depth pass ONCE (frames={1}) at 512² instead of re-rendering a full
          1024² depth pass every frame on top of the sun shadow. drei's ContactShadows
          resets its bake counter on each React re-render, and HouseView re-renders when
          `placed`/`bounds` change (rooms moved/resized/added) — so it re-bakes on any
          layout change with no stale shadow and no per-frame cost.
          That re-render reset was NOT enough when rooms are hidden (tour room
          multi-select): the old bake kept "ghost" shadows of every hidden room on
          the ground. Keying on the visible room ids remounts it with a fresh bake;
          the key only changes when the set of rooms changes, so edits stay cheap. */}
      <ContactShadows key={placed.map((p) => p.design.id).join('|')} frames={1} position={[0, 0.002, 0]} scale={shadowScale} resolution={512} blur={2.6} opacity={0.34} far={6} />
      <HouseCameraFit bounds={bounds} placed={placed} fitTo={fitTo} />
    </>
  )
}

// ── Per-room size editor ──────────────────────────────────────────────────────
// A small DOM panel floated (drei <Html>) above the clicked room. Editing W or D
// commits through resizeRoom(); it is keyed on the room id in HouseView so it
// remounts (and re-reads the new size) after each resize settles.
function RoomSizeEditor({
  placed,
  originCm,
  unit,
  onResize,
  onClose,
}: {
  placed: PlacedRoom
  originCm: { x: number; z: number }
  unit: Unit
  onResize: (size: { w: number; l: number }) => void
  onClose: () => void
}) {
  const bb = bbox(placed.design.corners)
  const wx = (placed.centerCm.x - originCm.x) / 100
  const wz = (placed.centerCm.z - originCm.z) / 100
  const y = (placed.elevationCm + placed.design.wallHeight) / 100 + 0.45
  return (
    <Html position={[wx, y, wz]} center distanceFactor={11} zIndexRange={[120, 0]} style={{ pointerEvents: 'auto' }}>
      <div className="house-room-size-editor" onPointerDown={(e) => e.stopPropagation()} style={editorWrap}>
        <div style={editorHead}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{placed.design.name}</span>
          <button onClick={onClose} title="Done" style={editorClose}>✕</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SizeField label="W" cm={bb.w} unit={unit} onCommit={(v) => onResize({ w: v, l: bb.d })} />
          <span style={{ color: '#9aa' }}>×</span>
          <SizeField label="D" cm={bb.d} unit={unit} onCommit={(v) => onResize({ w: bb.w, l: v })} />
        </div>
        <div style={editorHint}>Resize room ({unit})</div>
      </div>
    </Html>
  )
}

function SizeField({
  label,
  cm,
  unit,
  onCommit,
}: {
  label: string
  cm: number
  unit: Unit
  onCommit: (cm: number) => void
}) {
  // While editing we show the raw draft; otherwise we ALWAYS derive the displayed
  // value from the authoritative `cm` prop. So after a commit the field reflects the
  // room's real size even when it was clamped to a value that rounds the same (e.g.
  // typing below the 120cm min) — the case a remount-key alone would miss.
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState('')
  // keep an unparseable draft visible (with a red border + message) instead of
  // silently reverting, mirroring the Step 2 wall-length field.
  const [invalid, setInvalid] = useState(false)
  const shown = focused || invalid ? draft : formatLenShort(cm, unit)
  const commit = () => {
    setFocused(false)
    const parsed = parseLen(draft, unit)
    if (parsed == null) {
      // garbage (".", "abc", …) → flag it; an empty field is a silent cancel
      if (draft.trim() !== '') setInvalid(true)
      return
    }
    setInvalid(false)
    // Clamp to the real-world range so a typo (e.g. 999999) can't grow the room
    // off-screen — resizeRoom only enforces a min, so the max lives here.
    const v = clampWallLength(parsed)
    if (Math.abs(v - cm) > 0.5) onCommit(v) // else revert (no-op)
  }
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <span style={{ color: '#9aa', fontSize: 11 }}>{label}</span>
        <input
          value={shown}
          aria-invalid={invalid || undefined}
          onFocus={() => { setDraft(formatLenShort(cm, unit)); setFocused(true); setInvalid(false) }}
          onChange={(e) => { setDraft(e.target.value); if (invalid) setInvalid(false) }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') { setInvalid(false); setDraft(formatLenShort(cm, unit)); (e.target as HTMLInputElement).blur() }
          }}
          style={invalid ? { ...sizeInput, borderColor: '#e5484d' } : sizeInput}
        />
      </label>
      {invalid && <span role="alert" style={{ color: '#ff8a8a', fontSize: 10 }}>Enter a number</span>}
    </span>
  )
}

const editorWrap: CSSProperties = {
  background: 'rgba(20,22,26,.92)', color: '#e9eaec', borderRadius: 10, padding: '9px 11px',
  font: '13px ui-sans-serif,system-ui,sans-serif', boxShadow: '0 8px 24px rgba(0,0,0,.35)', minWidth: 168,
}
const editorHead: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  fontWeight: 700, color: '#8ab4ff', marginBottom: 7, maxWidth: 150,
}
const editorClose: CSSProperties = {
  border: 'none', background: 'transparent', color: '#c9ccd1', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, flex: 'none',
}
const editorHint: CSSProperties = { marginTop: 6, fontSize: 11, color: '#9aa' }
const sizeInput: CSSProperties = {
  width: 56, background: '#2b2f36', border: '1px solid rgba(255,255,255,.16)', color: '#fff',
  borderRadius: 6, padding: '4px 6px', font: '13px ui-monospace,monospace',
}
