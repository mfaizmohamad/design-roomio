import { describe, it, expect } from 'vitest'
import { composeTexture } from './compose'
import { syntheticFabricPhoto, syntheticWoodPhoto } from './synth'
import { wrapSeamScore } from './tile'
import { illuminationSpread } from './delight'
import { extractSurfacePatch } from './crop'
import { AssetStore, MemoryAdapter } from '../store/assetStore'
import { buildAppliedTexture, resolveMaps, refsOf, type ImageEncoder } from '../store/persist'
import { isAssetRef, type AppliedTexture } from '../contract'

// deterministic, content-sensitive stub encoder (browser uses canvas.toDataURL instead)
const encode: ImageEncoder = (img) =>
  `${img.width}x${img.height}:${img.data.length}:${img.data[0]},${img.data[1]},${img.data[(img.data.length >> 1) & ~3]}`

describe('composeTexture (T1→T2 orchestration)', () => {
  it('produces seamless, de-lit albedo + roughness + normal from a fabric photo', () => {
    const photo = syntheticFabricPhoto([150, 95, 80], { width: 256, height: 200, seed: 3 })
    const { patch: rawCrop } = extractSurfacePatch(photo, [20, 20, 200, 150], 256, 200, 96)
    const out = composeTexture(photo, { bbox: [20, 20, 200, 150], resultW: 256, resultH: 200, patchPx: 96 })

    expect(out.albedo.width).toBe(96)
    expect(out.roughness.width).toBe(96)
    expect(out.normal.width).toBe(96)
    expect(['fabric', 'wood', 'metal']).toContain(out.kind)
    // seamless survives de-light (delta field is wrap-blurred → toroidal)
    expect(wrapSeamScore(out.albedo)).toBeLessThan(wrapSeamScore(rawCrop))
    // de-lit: baked lighting gradient flattened vs the raw crop
    expect(illuminationSpread(out.albedo)).toBeLessThan(illuminationSpread(rawCrop))
  })

  it('infers wood for a strong-grain photo', () => {
    const wood = syntheticWoodPhoto([150, 110, 70], { width: 256, height: 200, seed: 7 })
    const out = composeTexture(wood, { bbox: [16, 16, 220, 160], resultW: 256, resultH: 200, patchPx: 96 })
    expect(out.kind).toBe('wood')
  })
})

describe('persistence: build → save(JSON) → reload → resolve (T-9, brief §5)', () => {
  async function makeApplied(store: AssetStore): Promise<AppliedTexture> {
    const photo = syntheticFabricPhoto([150, 95, 80], { seed: 3 })
    const composed = composeTexture(photo, { bbox: [20, 20, 200, 150], resultW: 256, resultH: 200, patchPx: 64 })
    return buildAppliedTexture(composed, store, encode, { slot: 'body', archetypeId: 'sofa-3' })
  }

  it('AppliedTexture carries only references (no bytes) and points at real stored assets', async () => {
    const store = new AssetStore()
    const tex = await makeApplied(store)
    expect(isAssetRef(tex.asset_id)).toBe(true)
    for (const ref of [tex.maps.albedo, tex.maps.roughness, tex.maps.normal]) {
      expect(isAssetRef(ref)).toBe(true)
      expect(await store.has(ref)).toBe(true)
    }
    expect(tex.slot).toBe('body')
    expect(tex.source?.archetype_id).toBe('sofa-3')
  })

  it('survives a save/reload: JSON round-trip keeps refs; the asset store resolves them', async () => {
    const store = new AssetStore()
    const tex = await makeApplied(store)
    // simulate persisting inside a RoomDesign furniture item → envelope → localStorage
    const reloaded: AppliedTexture = JSON.parse(JSON.stringify(tex))
    expect(reloaded).toEqual(tex) // small + lossless
    const maps = await resolveMaps(reloaded, store) // store persists separately (survives reload)
    expect(maps.albedo).not.toBeNull()
    expect(maps.roughness).not.toBeNull()
    expect(maps.normal).not.toBeNull()
  })

  it('content-addressed: re-texturing the same photo dedupes to the same refs', async () => {
    const mem = new MemoryAdapter()
    const store = new AssetStore(mem)
    const a = await makeApplied(store)
    const b = await makeApplied(store)
    expect(b.maps).toEqual(a.maps) // same content → same refs
    // 4 distinct assets (albedo, roughness, normal, crop) stored once each
    expect((await mem.keys('roomio.asset.')).length).toBe(4)
  })

  it('gc keeps a live texture’s assets and reclaims orphans', async () => {
    const store = new AssetStore()
    const tex = await makeApplied(store)
    await store.put(encode(syntheticWoodPhoto())) // an orphan
    const removed = await store.gc(refsOf(tex))
    expect(removed).toBeGreaterThanOrEqual(1)
    for (const ref of refsOf(tex)) expect(await store.has(ref)).toBe(true)
  })
})
