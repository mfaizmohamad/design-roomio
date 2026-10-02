import { describe, expect, it } from 'vitest'
import { buildWallParts, deriveWalls, pointOnWall } from '../geometry/walls'
import { buildWallGeometry } from './wallGeometry'
import type { Vec2 } from '../types'

const rectangle: Vec2[] = [{ x: 0, z: 0 }, { x: 400, z: 0 }, { x: 400, z: 300 }, { x: 0, z: 300 }]

describe('wall corner joins', () => {
  for (const corners of [rectangle, [...rectangle].reverse()]) {
    it(`meets at a mitre without overlapping faces (${corners === rectangle ? 'forward' : 'reverse'} winding)`, () => {
      const walls = deriveWalls(corners)
      for (const wall of walls) {
        const part = buildWallParts(wall, [], 270, 12)[0]
        const geometry = buildWallGeometry(part, wall, walls, 12)
        const p = geometry.getAttribute('position')
        const base = pointOnWall(wall, part.uCenter / wall.length)
        const footprint = new Set<string>()
        for (let i = 0; i < p.count; i++) {
          const x = base.x + 100 * (p.getX(i) * wall.dirX + p.getZ(i) * wall.dirZ)
          const z = base.z + 100 * (p.getX(i) * wall.dirZ - p.getZ(i) * wall.dirX)
          footprint.add(`${Math.round(x)},${Math.round(z)}`)
        }
        // Each end joins the inner and outer offset corners, rather than
        // extending a rectangular cap over its neighbour's visible face.
        const allowed = new Set(['-6,-6', '6,6', '406,-6', '394,6', '406,306', '394,294', '-6,306', '6,294'])
        expect(footprint.size).toBe(4)
        for (const vertex of footprint) expect(allowed.has(vertex), vertex).toBe(true)
        geometry.dispose()
      }
    })
  }

  it('keeps the clear width and head height of a doorway', () => {
    const walls = deriveWalls(rectangle)
    const wall = walls[0]
    const parts = buildWallParts(wall, [{ id: 'door', kind: 'door', style: 'single', wallId: 'w0', t: 0.5, width: 90, height: 210, sill: 0 }], 270, 12)
    for (const part of parts) {
      const geometry = buildWallGeometry(part, wall, walls, 12)
      const positions = geometry.getAttribute('position')
      for (let i = 0; i < positions.count; i++) {
        const u = part.uCenter + positions.getX(i) * 100
        const v = part.vCenter + positions.getY(i) * 100
        expect(u > 155.001 && u < 244.999 && v < 209.999).toBe(false)
      }
      geometry.dispose()
    }
  })
})
