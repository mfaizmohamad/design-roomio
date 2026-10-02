import { describe, expect, it } from 'vitest'
import { coercePublishedManifest } from './releaseManifest'

const releaseId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const homeId = '33333333-3333-4333-8333-333333333333'
const versionId = '44444444-4444-4444-8444-444444444444'

const room = {
  id: 'room-1', name: 'Living', unit: 'cm', shape: 'rect',
  corners: [{ x: 0, z: 0 }, { x: 400, z: 0 }, { x: 400, z: 300 }, { x: 0, z: 300 }],
  wallHeight: 270, wallThickness: 12,
  openings: [], materials: { wallColor: '#fff', floorTexture: 'oak' },
  furniture: [], createdAt: 1, updatedAt: 1,
}
const home = { ...room, id: 'home-data', name: 'Synthetic home', house: {
  version: 1, activeId: room.id, homeId: null,
  levels: [{ label: 'Ground', elevationCm: 0 }],
  rooms: [{ id: room.id, type: 'living', level: 0, design: room }],
  viewMode: 'house', levelFilter: 'all',
  lighting: { version: '1.0', timeOfDay: 0.5, northOffsetDeg: 0,
    barVisible: false, northVisible: false, lightMode: false,
    sun: { enabled: true, maxElevationDeg: 60, warmthShift: true, intensityScale: 1, domeRadiusM: 30 },
    shadow: { mapSize: 2048, bias: 0, normalBias: 0, type: 'PCFSoft' },
    rooms: {}, fillScale: 1 },
} }
const asset = { versionId, url: `/api/releases/${releaseId}/assets/${versionId}`,
  sha256: 'a'.repeat(64), measuredCm: { w: 80, d: 60, h: 70 } }
const manifest = () => ({ id: releaseId, version: 1, projectId, homeId,
  homeRevision: 1, home, claims: [{ id: 'title', label: 'Home', value: 'Synthetic home' }],
  assets: [asset] })

describe('published viewer boundary', () => {
  it('accepts a complete synthetic home with a pinned same-origin asset', () => {
    const result = coercePublishedManifest(manifest(), releaseId)
    expect(result?.home.house?.rooms).toHaveLength(1)
    expect(result?.assets[0].versionId).toBe(versionId)
  })
  it('rejects a different release ID and a non-allowlisted asset URL', () => {
    expect(coercePublishedManifest(manifest(), projectId)).toBeNull()
    expect(coercePublishedManifest({ ...manifest(), assets: [{ ...asset, url: 'https://example.test/chair.glb' }] }, releaseId)).toBeNull()
    expect(coercePublishedManifest({ ...manifest(), assets: [{ ...asset, url: `/api/releases/${projectId}/assets/${versionId}` }] }, releaseId)).toBeNull()
  })
  it('rejects missing or malformed whole-home data', () => {
    expect(coercePublishedManifest({ ...manifest(), home: null }, releaseId)).toBeNull()
    expect(coercePublishedManifest({ ...manifest(), home: { ...home, house: { ...home.house, rooms: [] } } }, releaseId)).toBeNull()
  })
})
