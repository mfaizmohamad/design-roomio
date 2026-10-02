import { useEffect, useMemo } from 'react'
import { pointOnWall, type WallPart } from '../geometry/walls'
import type { Wall } from '../types'
import type { Frame } from './coords'
import { buildWallGeometry } from './wallGeometry'
import { WallSurfaceMaterial } from './WallMaterial'

/** Shared wall renderer so room editing and house previews use identical joins. */
export function WallPartMesh({ part, wall, walls, frame, thickness, color, texture }: {
  part: WallPart
  wall: Wall
  walls: Wall[]
  frame: Frame
  thickness: number
  color: string
  texture?: string
}) {
  const geometry = useMemo(() => buildWallGeometry(part, wall, walls, thickness), [part, wall, walls, thickness])
  useEffect(() => () => geometry.dispose(), [geometry])
  const base = pointOnWall(wall, part.uCenter / wall.length)
  const [x, z] = frame.toWorld(base.x, base.z)
  return (
    <mesh geometry={geometry} position={[x, part.vCenter / 100, z]} rotation={[0, Math.atan2(-wall.dirZ, wall.dirX), 0]} castShadow receiveShadow>
      <WallSurfaceMaterial wallColor={color} wallTexture={texture} part={part} />
    </mesh>
  )
}
