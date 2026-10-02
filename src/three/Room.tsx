import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useStore } from '../store'
import { bbox, buildWallParts } from '../geometry/walls'
import { makeFrame } from './coords'
import { getFloorTexture } from './textures'
import { OpeningMesh } from './Openings3D'
import { FloorSurfaceMaterial } from './FloorMaterial'
import { WallPartMesh } from './WallPartMesh'
import { RoomTrim } from './Trim'
import type { Wall } from '../types'

function FloorMesh() {
  const corners = useStore((s) => s.design.corners)
  const floorId = useStore((s) => s.design.materials.floorTexture)

  const geom = useMemo(() => {
    const frame = makeFrame(corners)
    const pts = corners.map((c) => {
      const [x, z] = frame.toWorld(c.x, c.z)
      return new THREE.Vector2(x, z)
    })
    const tris = THREE.ShapeUtils.triangulateShape(pts, [])
    const positions: number[] = []
    const uvs: number[] = []
    const normals: number[] = []
    const { texture, areaCm } = getFloorTexture(floorId)
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
  }, [corners, floorId])

  return (
    <mesh geometry={geom.g} receiveShadow position={[0, 0, 0]}>
      <FloorSurfaceMaterial floorId={floorId} texture={geom.texture} />
    </mesh>
  )
}

function WallGroup({ wall, walls, frame }: { wall: Wall; walls: Wall[]; frame: ReturnType<typeof makeFrame> }) {
  const height = useStore((s) => s.design.wallHeight)
  const thickness = useStore((s) => s.design.wallThickness)
  const wallColor = useStore((s) => s.design.materials.wallColor)
  const wallTexture = useStore((s) => s.design.materials.wallTexture)
  const openings = useStore((s) => s.design.openings)

  const parts = useMemo(
    () => buildWallParts(wall, openings.filter((o) => o.wallId === wall.id), height, thickness),
    [wall, openings, height, thickness],
  )

  return (
    <group>
      {parts.map((p, i) => (
        <WallPartMesh key={i} part={p} wall={wall} walls={walls} frame={frame}
          thickness={thickness} color={wallColor} texture={wallTexture} />
      ))}
    </group>
  )
}

function WallsMesh() {
  const corners = useStore((s) => s.design.corners)
  const walls = useStore((s) => s.walls)
  const frame = useMemo(() => makeFrame(corners), [corners])
  const groupRef = useRef<THREE.Group>(null)

  // Open-dollhouse: hide walls whose interior face points away from the camera.
  useFrame((state) => {
    const g = groupRef.current
    if (!g) return
    const vx = state.camera.position.x
    const vz = state.camera.position.z
    g.children.forEach((child, i) => {
      const w = walls[i]
      if (!w) return
      const [mx, mz] = frame.toWorld(w.midX, w.midZ)
      const dot = w.nx * (vx - mx) + w.nz * (vz - mz)
      child.visible = dot > -0.05
    })
  })

  return (
    <group ref={groupRef}>
      {walls.map((w) => (
        <WallGroup key={w.id} wall={w} walls={walls} frame={frame} />
      ))}
    </group>
  )
}

function OpeningsLayer() {
  const corners = useStore((s) => s.design.corners)
  const walls = useStore((s) => s.walls)
  const allOpenings = useStore((s) => s.design.openings)
  const height = useStore((s) => s.design.wallHeight)
  const thickness = useStore((s) => s.design.wallThickness)
  const frame = useMemo(() => makeFrame(corners), [corners])
  const groupRef = useRef<THREE.Group>(null)
  // `bare` openings are the far side of a shared-wall cut — hole only, no frame
  // mesh (a coincident second frame would z-fight the near side's).
  const openings = useMemo(() => allOpenings.filter((o) => !o.bare), [allOpenings])

  // Match the wall cull: hide an opening when its wall faces away from the camera.
  useFrame((state) => {
    const g = groupRef.current
    if (!g) return
    const vx = state.camera.position.x
    const vz = state.camera.position.z
    g.children.forEach((child, i) => {
      const o = openings[i]
      const w = o && walls.find((ww) => ww.id === o.wallId)
      if (!w) {
        child.visible = true
        return
      }
      const [mx, mz] = frame.toWorld(w.midX, w.midZ)
      child.visible = w.nx * (vx - mx) + w.nz * (vz - mz) > -0.05
    })
  })

  return (
    <group ref={groupRef}>
      {openings.map((o) => {
        const wall = walls.find((w) => w.id === o.wallId)
        return (
          <group key={o.id}>
            {wall && (
              <OpeningMesh
                opening={o}
                wall={wall}
                frame={frame}
                wallHeight={height}
                wallThickness={thickness}
              />
            )}
          </group>
        )
      })}
    </group>
  )
}

/** Skirting + door/window casing (+ slim cornice) as one merged mesh — the cheap
 *  finish that stops wall/floor & opening junctions reading as a bare box. Shares
 *  the RoomTrim component with the whole-house view so the two never diverge. */
function TrimLayer() {
  const corners = useStore((s) => s.design.corners)
  const walls = useStore((s) => s.walls)
  const openings = useStore((s) => s.design.openings)
  const wallHeight = useStore((s) => s.design.wallHeight)
  const wallThickness = useStore((s) => s.design.wallThickness)
  const frame = useMemo(() => makeFrame(corners), [corners])
  // Skirting/cornice break at ANY hole; casing frames only real (non-bare) openings.
  const frameOpenings = useMemo(() => openings.filter((o) => !o.bare), [openings])

  return (
    <RoomTrim
      walls={walls}
      frame={frame}
      wallHeight={wallHeight}
      wallThickness={wallThickness}
      holeOpenings={openings}
      frameOpenings={frameOpenings}
    />
  )
}

export function Room() {
  return (
    <group>
      <FloorMesh />
      <WallsMesh />
      <OpeningsLayer />
      <TrimLayer />
    </group>
  )
}

export { bbox }
