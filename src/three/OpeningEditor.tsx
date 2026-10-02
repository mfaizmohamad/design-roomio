import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { useStore } from '../store'
import { makeFrame } from './coords'
import { pointOnWall } from '../geometry/walls'
import { useFloorRay, useControlsToggle, pointToWallT } from './interaction'
import type { Wall, Opening } from '../types'

function nearestWall(p: THREE.Vector3, walls: Wall[], frame: ReturnType<typeof makeFrame>): Wall {
  let best = walls[0]
  let bestD = Infinity
  for (const w of walls) {
    const [ax, az] = frame.toWorld(w.a.x, w.a.z)
    const [bx, bz] = frame.toWorld(w.b.x, w.b.z)
    const dx = bx - ax
    const dz = bz - az
    const len2 = dx * dx + dz * dz || 1
    let t = ((p.x - ax) * dx + (p.z - az) * dz) / len2
    t = Math.max(0, Math.min(1, t))
    const cx = ax + dx * t
    const cz = az + dz * t
    const d = (p.x - cx) ** 2 + (p.z - cz) ** 2
    if (d < bestD) {
      bestD = d
      best = w
    }
  }
  return best
}

/** Invisible clickable strip along a wall used to place a new opening. */
function PlacementStrip({ wall, frame }: { wall: Wall; frame: ReturnType<typeof makeFrame> }) {
  const placingStyle = useStore((s) => s.placingStyle)
  const addOpening = useStore((s) => s.addOpening)
  const setPlacingStyle = useStore((s) => s.setPlacingStyle)
  const height = useStore((s) => s.design.wallHeight)
  const [hover, setHover] = useState(false)

  const [mx, mz] = frame.toWorld(wall.midX, wall.midZ)
  const inset = 0.04
  const angleY = Math.atan2(-wall.dirZ, wall.dirX)

  return (
    <group position={[mx + wall.nx * inset, height / 200, mz + wall.nz * inset]} rotation={[0, angleY, 0]}>
      <mesh
        onPointerOver={(e) => {
          e.stopPropagation()
          setHover(true)
        }}
        onPointerOut={() => setHover(false)}
        onClick={(e) => {
          e.stopPropagation()
          if (!placingStyle) return
          const t = pointToWallT(e.point, wall, frame)
          addOpening(placingStyle, wall.id, t)
          setPlacingStyle(null)
        }}
      >
        <boxGeometry args={[wall.length / 100, height / 100, 0.06]} />
        <meshBasicMaterial color="#f3b700" transparent opacity={hover ? 0.22 : 0.06} depthWrite={false} />
      </mesh>
    </group>
  )
}

function OpeningGizmo({ opening, frame }: { opening: Opening; frame: ReturnType<typeof makeFrame> }) {
  const walls = useStore((s) => s.walls)
  const selectedId = useStore((s) => s.selectedOpeningId)
  const selectOpening = useStore((s) => s.selectOpening)
  const moveOpening = useStore((s) => s.moveOpening)
  const removeOpening = useStore((s) => s.removeOpening)
  const beginGesture = useStore((s) => s.beginGesture)
  const endGesture = useStore((s) => s.endGesture)
  const floorRay = useFloorRay()
  const toggleControls = useControlsToggle()
  const dragging = useRef(false)

  const wall = walls.find((w) => w.id === opening.wallId)
  if (!wall) return null
  const selected = selectedId === opening.id

  const pt = pointOnWall(wall, opening.t)
  const [x, z] = frame.toWorld(pt.x, pt.z)
  const yCenter = (opening.sill + opening.height / 2) / 100
  const angleY = Math.atan2(-wall.dirZ, wall.dirX)

  return (
    <group position={[x, yCenter, z]} rotation={[0, angleY, 0]}>
      {/* invisible hitbox for select + drag */}
      <mesh
        onPointerDown={(e) => {
          e.stopPropagation()
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          selectOpening(opening.id)
          dragging.current = true
          beginGesture()
          toggleControls(false)
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return
          e.stopPropagation()
          const hit = floorRay(e.clientX, e.clientY)
          if (!hit) return
          const w = nearestWall(hit, walls, frame)
          const t = pointToWallT(hit, w, frame)
          moveOpening(opening.id, w.id, t)
        }}
        onPointerUp={(e) => {
          if (dragging.current) endGesture()
          dragging.current = false
          toggleControls(true)
          ;(e.target as Element).releasePointerCapture?.(e.pointerId)
        }}
      >
        <boxGeometry args={[opening.width / 100, opening.height / 100, 0.34]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* selection outline */}
      {selected && (
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(opening.width / 100 + 0.04, opening.height / 100 + 0.04, 0.36)]} />
          <lineBasicMaterial color="#f3b700" linewidth={2} />
        </lineSegments>
      )}

      {selected && (
        <Html position={[0, opening.height / 200 + 0.28, 0]} center distanceFactor={9} zIndexRange={[40, 0]}>
          <button
            className="trash-btn"
            onClick={(ev) => {
              ev.stopPropagation()
              removeOpening(opening.id)
            }}
            title="Delete"
          >
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path
                fill="currentColor"
                d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h1v-8h-1zm3 0v8h1v-8h-1z"
              />
            </svg>
          </button>
        </Html>
      )}
    </group>
  )
}

export function OpeningEditor() {
  const corners = useStore((s) => s.design.corners)
  const walls = useStore((s) => s.walls)
  const openings = useStore((s) => s.design.openings)
  const placingStyle = useStore((s) => s.placingStyle)
  const frame = useMemo(() => makeFrame(corners), [corners])

  return (
    <group>
      {placingStyle && walls.map((w) => <PlacementStrip key={`p-${w.id}`} wall={w} frame={frame} />)}
      {openings.map((o) => (
        <OpeningGizmo key={o.id} opening={o} frame={frame} />
      ))}
    </group>
  )
}
