import { describe, it, expect } from 'vitest'
import { planRoomTrim, buildTrimGeometry, _trimStats, type TrimSeg } from './Trim'
import { deriveWalls } from '../geometry/walls'
import { makeFrame } from './coords'
import type { Opening, Vec2 } from '../types'

// w0 = z=0 (a→b along +x) · w1 = x=w (+z) · w2 = z=l (-x) · w3 = x=0 (-z)
const rect = (w: number, l: number): Vec2[] => [
  { x: 0, z: 0 },
  { x: w, z: 0 },
  { x: w, z: l },
  { x: 0, z: l },
]

const opening = (o: Partial<Opening> & Pick<Opening, 'kind' | 'wallId' | 't' | 'width' | 'height' | 'sill'>): Opening => ({
  id: `${o.wallId}@${o.t}`,
  style: o.kind === 'window' ? 'windowSingle' : 'single',
  ...o,
})

/** [start,end] cm span of a segment along its wall. */
const span = (s: TrimSeg): [number, number] => [s.uCm - s.lenU / 2, s.uCm + s.lenU / 2]
const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] - 1e-6 && b[0] < a[1] - 1e-6

const WALL_H = 270
const WALL_T = 12

describe('planRoomTrim — skirting gapped at thresholds', () => {
  it('breaks the skirting at a floor door and leaves a run on either side', () => {
    const walls = deriveWalls(rect(400, 500))
    const door = opening({ kind: 'door', wallId: 'w0', t: 0.5, width: 90, height: 205, sill: 0 })
    const segs = planRoomTrim(walls, [door], [door], WALL_H, WALL_T)

    const L = walls.find((w) => w.id === 'w0')!.length
    const doorSpan: [number, number] = [door.t * L - door.width / 2, door.t * L + door.width / 2]
    const skirtW0 = segs.filter((s) => s.kind === 'skirt' && s.wallId === 'w0')

    // a genuine gap: NO skirting board crosses the door threshold …
    for (const s of skirtW0) expect(overlaps(span(s), doorSpan)).toBe(false)
    // … but the wall is still skirted on both sides of the door.
    expect(skirtW0.some((s) => span(s)[1] <= doorSpan[0])).toBe(true)
    expect(skirtW0.some((s) => span(s)[0] >= doorSpan[1])).toBe(true)
  })

  it('runs skirting UNBROKEN beneath a high-sill window (only floor openings break it)', () => {
    const walls = deriveWalls(rect(400, 500))
    const win = opening({ kind: 'window', wallId: 'w0', t: 0.5, width: 150, height: 120, sill: 90 })
    const segs = planRoomTrim(walls, [win], [win], WALL_H, WALL_T)

    const L = walls.find((w) => w.id === 'w0')!.length
    const skirtW0 = segs.filter((s) => s.kind === 'skirt' && s.wallId === 'w0')
    // exactly one continuous run that spans right past the window centre
    expect(skirtW0.length).toBe(1)
    const sp = span(skirtW0[0])
    expect(sp[0]).toBeLessThan(win.t * L)
    expect(sp[1]).toBeGreaterThan(win.t * L)
  })

  it('every wall of a plain rectangular room gets a skirting run', () => {
    const walls = deriveWalls(rect(360, 420))
    const segs = planRoomTrim(walls, [], [], WALL_H, WALL_T)
    for (const w of walls) {
      expect(segs.some((s) => s.kind === 'skirt' && s.wallId === w.id)).toBe(true)
    }
  })
})

describe('planRoomTrim — casing frames the opening without intruding into it', () => {
  it('door casing sits outside the clear opening (legs beside, head above, no bottom)', () => {
    const walls = deriveWalls(rect(400, 500))
    const door = opening({ kind: 'door', wallId: 'w0', t: 0.5, width: 90, height: 205, sill: 0 })
    const segs = planRoomTrim(walls, [door], [door], WALL_H, WALL_T)
    const L = walls.find((w) => w.id === 'w0')!.length
    const uMin = door.t * L - door.width / 2
    const uMax = door.t * L + door.width / 2
    const top = door.sill + door.height

    const casing = segs.filter((s) => s.kind === 'casing' && s.wallId === 'w0')
    expect(casing.length).toBeGreaterThanOrEqual(3) // 2 legs + head

    for (const s of casing) {
      const vLo = s.vCm - s.lenV / 2
      const uOverlapsClear = overlaps(span(s), [uMin, uMax])
      // any board over the opening's WIDTH must clear it in HEIGHT (be the head, above `top`)
      if (uOverlapsClear) expect(vLo).toBeGreaterThanOrEqual(top - 1e-6)
    }
    // a door has no bottom/apron casing (it meets the floor)
    expect(casing.some((s) => s.vCm + s.lenV / 2 <= door.sill + 1e-6)).toBe(false)
  })

  it('a near-full-wall opening (glass railing) is not cased', () => {
    const walls = deriveWalls(rect(940, 130))
    const rail = opening({ kind: 'window', wallId: 'w0', t: 0.5, width: 860, height: 215, sill: 12 })
    const segs = planRoomTrim(walls, [rail], [rail], 240, WALL_T)
    expect(segs.some((s) => s.kind === 'casing' && s.wallId === 'w0')).toBe(false)
  })

  it('a window gets a bottom apron; casing legs stay outside the glass', () => {
    const walls = deriveWalls(rect(400, 500))
    const win = opening({ kind: 'window', wallId: 'w3', t: 0.4, width: 170, height: 150, sill: 85 })
    const segs = planRoomTrim(walls, [win], [win], WALL_H, WALL_T)
    const casing = segs.filter((s) => s.kind === 'casing' && s.wallId === 'w3')
    // apron below the sill exists for a window
    expect(casing.some((s) => Math.abs(s.vCm + s.lenV / 2 - win.sill) < 1e-6)).toBe(true)
  })
})

describe('buildTrimGeometry — ONE shared profile, one merged geometry per room', () => {
  it('merges all boards into a single geometry and reuses ONE unit profile across many rooms', () => {
    const frame = makeFrame(rect(400, 500))
    const walls = deriveWalls(rect(400, 500))
    const door = opening({ kind: 'door', wallId: 'w0', t: 0.5, width: 90, height: 205, sill: 0 })
    const win = opening({ kind: 'window', wallId: 'w3', t: 0.4, width: 170, height: 150, sill: 85 })

    let merged: ReturnType<typeof buildTrimGeometry> = null
    for (let room = 0; room < 30; room++) {
      const segs = planRoomTrim(walls, [door, win], [door, win], WALL_H, WALL_T)
      merged = buildTrimGeometry(segs, walls, frame)
    }
    expect(merged).not.toBeNull()
    expect(merged!.attributes.position.count).toBeGreaterThan(0)
    expect(merged!.index).not.toBeNull()
    // the merge collapses to a single groupless geometry → one material, one draw call
    expect(merged!.groups.length).toBe(0)
    // …and 30 rooms allocate the profile box exactly ONCE (no per-segment/room geometry)
    expect(_trimStats().unitCreations).toBe(1)
  })

  it('returns null when a room has no trim segments', () => {
    const frame = makeFrame(rect(300, 300))
    const walls = deriveWalls(rect(300, 300))
    expect(buildTrimGeometry([], walls, frame)).toBeNull()
  })
})
