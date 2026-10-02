import * as THREE from 'three'
import type { Wall } from '../types'
import type { WallPart } from '../geometry/walls'

/**
 * Build a wall part in local metres, with mitred polygon corners. Openings keep
 * their exact clear dimensions; only the extended ends of the wall are shaped.
 * Adjacent box walls used to overlap by their full thickness, leaving coplanar
 * end faces that flickered as white stripes through a neighbouring finish.
 */
export function buildWallGeometry(part: WallPart, wall: Wall, walls: Wall[], thickness: number): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(part.lenU / 100, part.lenV / 100, thickness / 100)
  const index = walls.indexOf(wall)
  if (index < 0 || walls.length < 3) return geometry
  const previous = walls[(index + walls.length - 1) % walls.length]
  const next = walls[(index + 1) % walls.length]
  const slope = (other: Wall) => {
    const denominator = wall.dirX * other.dirZ - wall.dirZ * other.dirX
    if (Math.abs(denominator) < 1e-6) return 0
    return (1 - wall.dirX * other.dirX - wall.dirZ * other.dirZ) / denominator
  }
  const start = part.uCenter - part.lenU / 2
  const end = part.uCenter + part.lenU / 2
  const positions = geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i)
    const depthCm = positions.getZ(i) * 100
    if (x < 0 && start < 0) {
      positions.setX(i, (depthCm * slope(previous) - part.uCenter) / 100)
    } else if (x > 0 && end > wall.length) {
      positions.setX(i, (wall.length + depthCm * slope(next) - part.uCenter) / 100)
    }
  }
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
