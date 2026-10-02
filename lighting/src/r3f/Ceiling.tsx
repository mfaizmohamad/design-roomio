// Ceiling / roof for a room. Two parts:
//   1) a SHADOW ROOF — always present, invisible to the camera (colorWrite off) but castShadow
//      on, so the sun can't light or cast shadows into a windowless interior (the roof shadows it).
//      Wall windows still let low-angle sun in (they're holes in the walls, not the roof).
//   2) a VISUAL CEILING with recessed downlight discs — hidden in the default (high) view, fading in
//      when the camera drops below the ceiling (you're looking up from inside). These are purely
//      VISUAL: the room is lit by the sun + IBL, not by electric ceiling fixtures.

import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { warmthToHex } from '../colorTemp'

export interface CeilingProps {
  /** room polygon in world meters: [x, z] per corner. */
  cornersWorld: [number, number][]
  /** ceiling height in meters (wall height). */
  heightM: number
  /** visual ceiling tint (default plaster '#e8e3d8'). */
  visualColor?: string
  /** optional cladding texture (e.g. wood planks) — overrides the flat tint.
   *  Provide `textureAreaM` = the texture's real-world span in meters. */
  textureMap?: THREE.Texture | null
  textureAreaM?: number
  /** downlight discs: the default multi-disc 'grid', one centred 'single'
   *  (a balcony's round recessed light), or 'none'. */
  downlights?: 'grid' | 'single' | 'none'
}

function buildShapeGeometry(cornersWorld: [number, number][], uvAreaM = 1): THREE.BufferGeometry {
  const pts = cornersWorld.map(([x, z]) => new THREE.Vector2(x, z))
  const tris = THREE.ShapeUtils.triangulateShape(pts, [])
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  for (const tri of tris) {
    for (const idx of tri) {
      const v = pts[idx]
      positions.push(v.x, 0, v.y)
      normals.push(0, -1, 0) // face down (toward the interior)
      uvs.push(v.x / uvAreaM, v.y / uvAreaM) // physical world-scale uvs (like floors)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return g
}

function pointInPolygon(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function Ceiling({
  cornersWorld,
  heightM,
  visualColor = '#e8e3d8',
  textureMap = null,
  textureAreaM = 1.6,
  downlights = 'grid',
}: CeilingProps) {
  const geom = useMemo(
    () => buildShapeGeometry(cornersWorld, textureAreaM),
    [cornersWorld, textureAreaM],
  )

  // Grid of recessed downlight DISCS inside the polygon (~one per 1.6 m) — purely the visual ceiling
  // detail you see looking up. The room is lit by the sun + IBL, not electric ceiling fixtures.
  // 'single' = one centred disc (a balcony's round recessed light); 'none' = bare.
  const discs = useMemo(() => {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity
    for (const [x, z] of cornersWorld) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
    }
    const w = maxX - minX
    const d = maxZ - minZ
    if (downlights === 'none') return [] as [number, number][]
    if (downlights === 'single') {
      const cx = (minX + maxX) / 2
      const cz = (minZ + maxZ) / 2
      return (pointInPolygon(cx, cz, cornersWorld) ? [[cx, cz]] : []) as [number, number][]
    }
    const nx = Math.max(2, Math.min(4, Math.round(w / 1.6)))
    const nz = Math.max(2, Math.min(4, Math.round(d / 1.6)))
    const ds: [number, number][] = []
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = minX + (w * (i + 0.5)) / nx
        const z = minZ + (d * (j + 0.5)) / nz
        if (pointInPolygon(x, z, cornersWorld)) ds.push([x, z])
      }
    }
    return ds
  }, [cornersWorld, downlights])

  const visualRef = useRef<THREE.Group>(null)
  const opacity = useRef(0)
  const dirVec = useRef(new THREE.Vector3())
  const discColor = warmthToHex('warm')

  // Reveal the visual ceiling ONLY when the camera is actually looking UP at it (and roughly at
  // or below ceiling height) — e.g. an interior / flythrough view. During the normal downward
  // orbit (the default and all editing), the camera looks down, so the roof stays hidden and
  // never blocks the room or shows as a slab. The invisible shadow roof always blocks the sun.
  useFrame((state, delta) => {
    const cam = state.camera
    const dir = cam.getWorldDirection(dirVec.current)
    const lookingUp = dir.y > 0.12
    const nearOrBelowCeiling = cam.position.y < heightM + 0.4
    const target = lookingUp && nearOrBelowCeiling ? 1 : 0
    // time-based fade (~full in ¼s) so slow renderers still reach full opacity
    opacity.current += (target - opacity.current) * Math.min(1, (delta || 0.016) * 8)
    const g = visualRef.current
    if (!g) return
    g.visible = opacity.current > 0.02
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined
      if (m && 'opacity' in m) {
        ;(m as THREE.Material & { opacity: number }).opacity = opacity.current
      }
    })
  })

  return (
    <group>
      {/* 1) shadow roof — casts shadow to block the sun, but NEVER draws or occludes the camera
             view (colorWrite + depthWrite off), so no roof slab ever appears from the top. */}
      <mesh geometry={geom} position={[0, heightM, 0]} castShadow>
        <meshBasicMaterial colorWrite={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {/* 2) visual ceiling + glowing downlight discs — fade in when camera drops inside */}
      <group ref={visualRef} visible={false}>
        {/* unlit so the ceiling never renders as a dark slab regardless of interior lighting */}
        <mesh geometry={geom} position={[0, heightM, 0]}>
          {/* keyed on the map so switching flat⇄textured recompiles the material
              (assigning `map` onto a live material won't rebuild its shader).
              A CLAD ceiling (wood planks) is a real lit surface — standard
              material so it shades like the walls; the flat plaster stays
              unlit so it never reads as a dark slab. */}
          {textureMap ? (
            <meshStandardMaterial
              key={textureMap.uuid}
              map={textureMap}
              roughness={1}
              metalness={0}
              side={THREE.DoubleSide}
              transparent
              opacity={0}
              userData={{ __roomioNoEnv: true }}
            />
          ) : (
            <meshBasicMaterial
              key="flat"
              color={visualColor}
              side={THREE.DoubleSide}
              transparent
              opacity={0}
            />
          )}
        </mesh>
        {discs.map(([x, z], i) => (
          <mesh key={i} position={[x, heightM - 0.02, z]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[downlights === 'single' ? 0.14 : 0.1, 20]} />
            <meshBasicMaterial color={downlights === 'single' ? '#fff6e0' : discColor} side={THREE.DoubleSide} transparent opacity={0} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
