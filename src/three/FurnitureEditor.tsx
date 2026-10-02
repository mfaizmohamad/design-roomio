import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useStore } from '../store'
import { makeFrame } from './coords'
import { useFloorRay, useControlsToggle } from './interaction'
import { resolveFurniture } from '../geometry/collision'
import { ARCHETYPE_MAP, isMounted, mountOf } from '../data/archetypes'
import { FurnitureModel } from './Furniture3D'
import { elevationCm, restsOnSurface } from './mount'
import type { FurnitureItem } from '../types'
// Agent E — Light Mode: when on, ALL furniture is locked (pointer edits blocked) + hints hidden.
import { furnitureLocked } from '../../lighting/src/contract'
import { useLighting } from '../../lighting/src/store'
// Agent G — per-lamp lighting: each lamp is a real, individually-switchable warm light.
import { useRender } from '../../rendering/src/store'

// Snap rotation to the nearest 15° increment (kept simple per spec).
const ROT_SNAP = (15 * Math.PI) / 180
function snapAngle(a: number): number {
  return Math.round(a / ROT_SNAP) * ROT_SNAP
}

interface GizmoProps {
  item: FurnitureItem
  frame: ReturnType<typeof makeFrame>
}

function FurnitureGizmo({ item, frame }: GizmoProps) {
  const walls = useStore((s) => s.walls)
  const corners = useStore((s) => s.design.corners)
  const furniture = useStore((s) => s.design.furniture)
  const wallThickness = useStore((s) => s.design.wallThickness)
  const selectedId = useStore((s) => s.selectedFurnitureId)
  const overlapIds = useStore((s) => s.overlapIds)
  const selectFurniture = useStore((s) => s.selectFurniture)
  const updateFurniture = useStore((s) => s.updateFurniture)
  const removeFurniture = useStore((s) => s.removeFurniture)
  const setOverlaps = useStore((s) => s.setOverlaps)
  const beginGesture = useStore((s) => s.beginGesture)
  const endGesture = useStore((s) => s.endGesture)
  // Light Mode (presentation): locks every piece regardless of its own locked flag.
  const lightMode = useLighting((s) => s.lightMode)
  const locked = furnitureLocked(item, lightMode)
  // Per-lamp lighting: a lamp fixture is lit iff the master lights are on AND this lamp isn't
  // individually switched off. The window-daylight mode (global off) already darkens everything.
  const lightsOn = useRender((s) => s.lightsOn)
  const thisLampOff = useRender((s) => s.lampOff[item.id])

  const floorRay = useFloorRay()
  const toggleControls = useControlsToggle()

  // Drag state for a move (offset between the item center and the grab point, cm).
  const moving = useRef(false)
  const grabOffset = useRef<{ x: number; z: number }>({ x: 0, z: 0 })
  // Drag state for the rotate handle.
  const rotating = useRef(false)

  const selected = selectedId === item.id
  const overlapping = overlapIds.includes(item.id)

  const [wx, wz] = frame.toWorld(item.x, item.z)
  const archetype = ARCHETYPE_MAP[item.archetype]
  const mounted = isMounted(item.archetype)
  const isLamp = archetype?.model === 'lamp'
  const lampLit = isLamp && lightsOn && thisLampOff !== true

  // Vertical lift: wall-hung / on-a-surface pieces float above the floor (and
  // above whatever sits beneath them). Recomputed when the scene changes.
  // Passing the room polygon lets a wall piece stranded mid-room stand on the
  // floor instead of hanging in mid-air.
  const elevM = elevationCm(item, furniture, corners) / 100
  // Wall-hung (no console beneath) → the TV builder drops its floor pedestal.
  const wallMounted = mountOf(item.archetype) === 'wall' && !restsOnSurface(item, furniture)

  // World meters of the footprint / height.
  const wM = item.w / 100
  const dM = item.d / 100
  const hM = item.h / 100

  // The selection-outline box geometry — memoized so it isn't rebuilt per frame.
  const outlineGeo = useMemo(
    () => new THREE.BoxGeometry(wM + 0.04, hM + 0.04, dM + 0.04),
    [wM, hM, dM],
  )

  // Wall/surface-mounted pieces are exempt from footprint collision (they sit
  // above floor furniture), and floor pieces never collide with mounted ones.
  const collisionOthers = mounted
    ? []
    : furniture.filter((f) => f.id !== item.id && !isMounted(f.archetype))

  // ---- shared resolve helper: applies collision + snapping for a proposed center.
  const resolveMove = (cx: number, cz: number) => {
    const others = collisionOthers
    const r = resolveFurniture(
      item,
      { x: cx, z: cz },
      walls,
      others,
      corners,
      { wallThickness },
    )
    updateFurniture(item.id, { x: r.x, z: r.z, rotation: r.rotation })
    setOverlaps(r.overlaps)
  }

  // ---- MOVE handlers (on the invisible hitbox) ----------------------------
  const onMoveDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    selectFurniture(item.id)
    if (locked) return // pinned or Light Mode: select only, ignore drag
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    moving.current = true
    beginGesture()
    toggleControls(false)
    // Record grab offset so the item doesn't jump its center onto the cursor.
    const hit = floorRay(e.clientX, e.clientY)
    if (hit) {
      const [hx, hz] = frame.fromWorld(hit.x, hit.z)
      grabOffset.current = { x: item.x - hx, z: item.z - hz }
    } else {
      grabOffset.current = { x: 0, z: 0 }
    }
  }

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!moving.current || locked) return
    e.stopPropagation()
    const hit = floorRay(e.clientX, e.clientY)
    if (!hit) return
    const [cx, cz] = frame.fromWorld(hit.x, hit.z)
    resolveMove(cx + grabOffset.current.x, cz + grabOffset.current.z)
  }

  const onMoveUp = (e: ThreeEvent<PointerEvent>) => {
    if (!moving.current) return
    moving.current = false
    endGesture()
    toggleControls(true)
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
  }

  // ---- ROTATE handlers (on the front handle) ------------------------------
  const onRotDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    selectFurniture(item.id)
    if (locked) return // pinned or Light Mode: ignore rotation too
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    rotating.current = true
    beginGesture()
    toggleControls(false)
  }

  const onRotMove = (e: ThreeEvent<PointerEvent>) => {
    if (!rotating.current || locked) return
    e.stopPropagation()
    const hit = floorRay(e.clientX, e.clientY)
    if (!hit) return
    // Vector from item center to the cursor (world meters). A Y-rotation θ maps
    // the item's local +z (its "front") to world ( sinθ, cosθ ), so to point the
    // front at the cursor we set θ = atan2(dx, dz).
    const dx = hit.x - wx
    const dz = hit.z - wz
    if (Math.abs(dx) < 1e-5 && Math.abs(dz) < 1e-5) return
    const angle = snapAngle(Math.atan2(dx, dz))
    // Push through resolveFurniture so any wall snap / inside-constraint that the
    // new rotation triggers stays legal. We feed the current center as proposed.
    const others = collisionOthers
    const r = resolveFurniture(
      { ...item, rotation: angle },
      { x: item.x, z: item.z },
      walls,
      others,
      corners,
      { wallThickness },
    )
    updateFurniture(item.id, { x: r.x, z: r.z, rotation: r.rotation })
    setOverlaps(r.overlaps)
  }

  const onRotUp = (e: ThreeEvent<PointerEvent>) => {
    if (!rotating.current) return
    rotating.current = false
    endGesture()
    toggleControls(true)
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
  }

  return (
    <group
      position={[wx, elevM, wz]}
      rotation={[0, item.rotation, 0]}
      // Tag lamp groups so MaterialEnhancer can gate THIS lamp's emissive shade glow per-lamp
      // (it walks up from the shade mesh to find this id).
      userData={{ __roomioLampId: isLamp ? item.id : undefined }}
    >
      {/* The furniture itself (rendered in local space). */}
      <FurnitureModel
        model={archetype.model}
        w={item.w}
        d={item.d}
        h={item.h}
        color={item.color}
        wallMounted={wallMounted}
        assetRef={item.assetRef}
      />

      {/* A real warm light for a lamp — makes it an actual light source, individually switchable.
          Positioned at the shade (~top of the lamp); a soft local pool (decay) so turning it off
          visibly darkens its surroundings. No shadow (perf; the sun is the shadow caster). */}
      {lampLit && (
        <pointLight
          position={[0, hM * 0.82, 0]}
          color="#ffd9a6"
          intensity={4}
          distance={3.6}
          decay={1.5}
          castShadow={false}
        />
      )}

      {/* Invisible drag/select hitbox spanning the full footprint volume. */}
      <mesh
        position={[0, hM / 2, 0]}
        onPointerDown={onMoveDown}
        onPointerMove={onMove}
        onPointerUp={onMoveUp}
      >
        <boxGeometry args={[wM, hM, dM]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Overlap warning: a translucent red box over the footprint. */}
      {overlapping && (
        <mesh position={[0, hM / 2, 0]}>
          <boxGeometry args={[wM, hM, dM]} />
          <meshBasicMaterial color="#e0483a" transparent opacity={0.18} depthWrite={false} />
        </mesh>
      )}

      {/* Selection visuals. */}
      {selected && (
        <>
          {/* Yellow selection outline. */}
          <lineSegments position={[0, hM / 2, 0]}>
            <primitive object={outlineGeo} attach="geometry" />
            <lineBasicMaterial color="#f3b700" />
          </lineSegments>

          {/* Rotate handle: a grabbable knob in front of the item (+z). Hidden when locked. */}
          {!locked && (
            <group position={[0, 0.02, dM / 2 + 0.35]}>
              <mesh onPointerDown={onRotDown} onPointerMove={onRotMove} onPointerUp={onRotUp}>
                <sphereGeometry args={[0.075, 20, 16]} />
                <meshStandardMaterial color="#1f6dd0" roughness={0.4} metalness={0.1} />
              </mesh>
              {/* small ring under the knob to read as a rotate affordance */}
              <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
                <torusGeometry args={[0.11, 0.012, 10, 28]} />
                <meshStandardMaterial color="#1f6dd0" roughness={0.5} />
              </mesh>
            </group>
          )}

          {/* Floating toolbar above the item: lock + delete. */}
          <Html position={[0, hM + 0.32, 0]} center distanceFactor={9} zIndexRange={[40, 0]}>
            {/* Stop pointer events here so a click on the toolbar can't bubble to
                the R3F floor "deselect" plane (its onPointerDown fires BEFORE the
                button's onClick, deselecting + unmounting the toolbar mid-click —
                which made lock/delete intermittently do nothing). */}
            <div
              className="item-toolbar"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            >
              <button
                className={`tool-btn${item.locked ? ' on' : ''}`}
                onClick={(ev) => {
                  ev.stopPropagation()
                  updateFurniture(item.id, { locked: !item.locked })
                }}
                title={item.locked ? 'Locked — click to unlock' : 'Lock in place'}
              >
                {item.locked ? '🔒' : '🔓'}
              </button>
              <button
                className="tool-btn danger"
                onClick={(ev) => {
                  ev.stopPropagation()
                  removeFurniture(item.id)
                }}
                title="Delete"
              >
                <svg viewBox="0 0 24 24" width="15" height="15">
                  <path
                    fill="currentColor"
                    d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h1v-8h-1zm3 0v8h1v-8h-1z"
                  />
                </svg>
              </button>
            </div>
          </Html>
        </>
      )}

      {/* Per-item lock indicator — shown when a piece is INDIVIDUALLY pinned and not selected. In
          Light Mode EVERY piece is locked, so per-item badges would spray 🔒 over the whole scene
          (clutter); a single canvas pill communicates the global lock instead (see RoomView). */}
      {item.locked && !selected && !lightMode && (
        <Html position={[0, hM + 0.12, 0]} center distanceFactor={9} zIndexRange={[8, 0]}>
          <div className="lock-badge" title="Locked">🔒</div>
        </Html>
      )}
    </group>
  )
}

export function FurnitureEditor(): JSX.Element {
  const corners = useStore((s) => s.design.corners)
  const furniture = useStore((s) => s.design.furniture)
  const selectFurniture = useStore((s) => s.selectFurniture)
  const frame = useMemo(() => makeFrame(corners), [corners])

  return (
    <group>
      {/* Click on empty floor to deselect. A large invisible plane just under the
          furniture hitboxes catches pointer-downs that miss every item. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.0005, 0]}
        onPointerDown={() => selectFurniture(null)}
      >
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {furniture.map((item) =>
        ARCHETYPE_MAP[item.archetype] ? (
          <FurnitureGizmo key={item.id} item={item} frame={frame} />
        ) : null,
      )}
    </group>
  )
}
