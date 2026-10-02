import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FURNITURE_ASSETS, resolveFurnitureAsset } from './furniture'
import { useHouse } from '../three/houseSession'

const chair = FURNITURE_ASSETS['sample-damask-chair-v1']

describe('illustrative GLB asset contract', () => {
  it('pins an embedded, bounded GLB to its reviewed hash and version', () => {
    const bytes = readFileSync('public/assets/furniture/chair-damask-purplegold-v1.glb')
    expect(bytes.length).toBe(chair.bytes)
    expect(bytes.length).toBeLessThan(2.1 * 1024 * 1024)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(chair.sha256)
    expect(bytes.toString('ascii', 0, 4)).toBe('glTF')
    expect(bytes.readUInt32LE(4)).toBe(2)
    expect(bytes.readUInt32LE(8)).toBe(bytes.length)
    const jsonLength = bytes.readUInt32LE(12)
    expect(bytes.toString('ascii', 16, 20)).toBe('JSON')
    const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength)) as {
      buffers: { uri?: string }[]; images: { uri?: string }[];
      extensionsRequired?: string[]; meshes: { primitives: { indices?: number; attributes: { POSITION: number } }[] }[];
      accessors: { count: number }[]
    }
    expect(gltf.buffers.every((buffer) => buffer.uri === undefined)).toBe(true)
    expect(gltf.images.every((image) => image.uri === undefined)).toBe(true)
    expect(gltf.extensionsRequired ?? []).toEqual([])
    const triangles = gltf.meshes.flatMap((mesh) => mesh.primitives).reduce((sum, primitive) =>
      sum + gltf.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3, 0)
    expect(triangles).toBe(chair.triangles)
    expect(triangles).toBeLessThan(40_000)
  })

  it('rejects unknown versions and footprints that would stretch the mesh', () => {
    expect(resolveFurnitureAsset({ assetRef: { assetVersionId: 'retired-v1' }, ...chair.boundsCm })).toEqual({ ok: false, reason: 'unknown-version' })
    expect(resolveFurnitureAsset({ assetRef: { assetVersionId: chair.id }, ...chair.boundsCm }).ok).toBe(true)
    expect(resolveFurnitureAsset({ assetRef: { assetVersionId: chair.id }, w: 55, d: chair.boundsCm.d, h: chair.boundsCm.h })).toEqual({ ok: false, reason: 'dimensions-mismatch' })
  })

  it('keeps the pinned version through Embercrest load and a saved-home reopen', () => {
    useHouse.getState().loadHome('embercrest')
    const room = useHouse.getState().rooms.find((entry) => entry.design.name === 'Living & Dining')!
    const placed = room.design.furniture.find((item) => item.assetRef?.assetVersionId === chair.id)!
    expect(resolveFurnitureAsset(placed).ok).toBe(true)
    const snapshot = useHouse.getState().snapshotDesign()
    useHouse.getState().loadSavedDesign(JSON.parse(JSON.stringify(snapshot)))
    const reopened = useHouse.getState().rooms.find((entry) => entry.design.name === 'Living & Dining')!
      .design.furniture.find((item) => item.id === placed.id)!
    expect(reopened.assetRef).toEqual({ assetVersionId: chair.id })
    expect(reopened).toMatchObject({ w: chair.boundsCm.w, d: chair.boundsCm.d, h: chair.boundsCm.h })
  })
})
