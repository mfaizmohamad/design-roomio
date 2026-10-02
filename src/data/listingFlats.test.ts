import { describe, it, expect } from 'vitest'
import { LISTING_FLATS } from './listingFlats'
import { ARCHETYPE_MAP } from './archetypes'
import { FLOOR_MAP } from './materials'
import { OPENING_MAP } from './openings'
import { ROOM_TYPES } from '../../multi-room/src/index'

const FLATS = Object.values(LISTING_FLATS)

describe('listing replica flats — data integrity', () => {
  it('at least one replica exists (Kothrud 2BHK)', () => {
    expect(LISTING_FLATS['4550925665232147']).toBeTruthy()
  })

  for (const flat of FLATS) {
    describe(flat.title, () => {
      it('room types, floors, wall textures and archetypes are all real ids', () => {
        for (const r of flat.rooms) {
          expect(ROOM_TYPES, `${r.name} type`).toContain(r.type)
          expect(FLOOR_MAP[r.floor], `${r.name} floor '${r.floor}'`).toBeTruthy()
          if (r.wallTexture) expect(FLOOR_MAP[r.wallTexture], `${r.name} wallTexture`).toBeTruthy()
          if (r.ceiling?.texture) expect(FLOOR_MAP[r.ceiling.texture], `${r.name} ceiling`).toBeTruthy()
          expect(r.wall).toMatch(/^#[0-9a-fA-F]{6}$/)
          for (const f of r.furniture) {
            expect(ARCHETYPE_MAP[f.a], `${r.name} archetype '${f.a}'`).toBeTruthy()
          }
        }
      })

      it('rooms do not overlap and tile their bounding box (gapless plan)', () => {
        const rects = flat.rooms.map((r) => ({
          name: r.name,
          x0: r.x - r.w / 2,
          x1: r.x + r.w / 2,
          z0: r.z - r.l / 2,
          z1: r.z + r.l / 2,
        }))
        const EPS = 1
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i], b = rects[j]
            const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
            const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0)
            expect(ox > EPS && oz > EPS, `'${a.name}' overlaps '${b.name}'`).toBe(false)
          }
        }
        const minX = Math.min(...rects.map((r) => r.x0))
        const maxX = Math.max(...rects.map((r) => r.x1))
        const minZ = Math.min(...rects.map((r) => r.z0))
        const maxZ = Math.max(...rects.map((r) => r.z1))
        const sum = flat.rooms.reduce((s, r) => s + r.w * r.l, 0)
        expect(sum).toBeCloseTo((maxX - minX) * (maxZ - minZ), -2)
      })

      it('every opening references a real wall (w0–w3), a known style, and fits its wall', () => {
        for (const r of flat.rooms) {
          for (const o of r.openings) {
            expect(['w0', 'w1', 'w2', 'w3'], `${r.name} wallId`).toContain(o.wallId)
            expect(OPENING_MAP[o.style], `${r.name} style '${o.style}'`).toBeTruthy()
            expect(o.t).toBeGreaterThan(0)
            expect(o.t).toBeLessThan(1)
            const wallLen = o.wallId === 'w0' || o.wallId === 'w2' ? r.w : r.l
            const u = o.t * wallLen
            expect(u - o.width / 2, `${r.name} ${o.style} start`).toBeGreaterThanOrEqual(-1)
            expect(u + o.width / 2, `${r.name} ${o.style} end`).toBeLessThanOrEqual(wallLen + 1)
          }
        }
      })

      it('every walkable inter-room opening has a matching hole on the neighbour (bare pairing)', () => {
        // For each authored walkable opening, compute its world center on its wall
        // and require SOME opening in another room within 2cm of the same point
        // (the coincident wall's cut). Exterior walls have no neighbour → skipped.
        type W = { room: string; x: number; z: number; width: number; bare: boolean }
        const world: W[] = []
        const exterior: W[] = []
        const bounds = {
          minX: Math.min(...flat.rooms.map((r) => r.x - r.w / 2)),
          maxX: Math.max(...flat.rooms.map((r) => r.x + r.w / 2)),
          minZ: Math.min(...flat.rooms.map((r) => r.z - r.l / 2)),
          maxZ: Math.max(...flat.rooms.map((r) => r.z + r.l / 2)),
        }
        for (const r of flat.rooms) {
          const x0 = r.x - r.w / 2
          const z0 = r.z - r.l / 2
          for (const o of r.openings) {
            if (o.sill > 15) continue // windows tested visually, doors must pair
            let x = 0, z = 0
            if (o.wallId === 'w0') { x = x0 + o.t * r.w; z = z0 }
            else if (o.wallId === 'w1') { x = x0 + r.w; z = z0 + o.t * r.l }
            else if (o.wallId === 'w2') { x = x0 + r.w - o.t * r.w; z = z0 + r.l }
            else { x = x0; z = z0 + r.l - o.t * r.l }
            const onBoundary =
              Math.abs(x - bounds.minX) < 1 || Math.abs(x - bounds.maxX) < 1 ||
              Math.abs(z - bounds.minZ) < 1 || Math.abs(z - bounds.maxZ) < 1
            ;(onBoundary ? exterior : world).push({ room: r.name, x, z, width: o.width, bare: !!o.bare })
          }
        }
        for (const o of world) {
          const partner = world.find(
            (p) => p.room !== o.room && Math.hypot(p.x - o.x, p.z - o.z) < 2 && Math.abs(p.width - o.width) < 1,
          )
          expect(partner, `${o.room} walkable opening at (${o.x},${o.z}) has no paired hole`).toBeTruthy()
          if (partner) expect(o.bare !== partner.bare, `exactly one of the pair at (${o.x},${o.z}) must be bare`).toBe(true)
        }
      })
    })
  }
})
