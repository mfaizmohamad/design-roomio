import { describe, it, expect } from 'vitest'
import { AssetStore, MemoryAdapter, ASSET_PREFIX } from './assetStore'
import { isAssetRef } from '../contract'

describe('content-addressed asset store', () => {
  it('put returns a valid content-hash ref and round-trips', async () => {
    const s = new AssetStore()
    const ref = await s.put('data:image/png;base64,AAAABBBB')
    expect(isAssetRef(ref)).toBe(true)
    expect(await s.get(ref)).toBe('data:image/png;base64,AAAABBBB')
    expect(await s.has(ref)).toBe(true)
  })

  it('dedupes identical content (same ref, single write)', async () => {
    const mem = new MemoryAdapter()
    const s = new AssetStore(mem)
    const r1 = await s.put('hello-texture')
    const r2 = await s.put('hello-texture')
    expect(r1).toBe(r2)
    const keys = await mem.keys(ASSET_PREFIX)
    expect(keys.length).toBe(1) // stored once
  })

  it('distinct content → distinct refs', async () => {
    const s = new AssetStore()
    expect(await s.put('a')).not.toBe(await s.put('b'))
  })

  it('get on a bad ref returns null (no throw)', async () => {
    const s = new AssetStore()
    expect(await s.get('not-a-ref')).toBe(null)
    expect(await s.get('sha256:short')).toBe(null)
    expect(await s.has('nope')).toBe(false)
  })

  it('remove deletes one asset', async () => {
    const s = new AssetStore()
    const ref = await s.put('xyz')
    await s.remove(ref)
    expect(await s.has(ref)).toBe(false)
  })

  it('listRefs returns valid refs for everything stored', async () => {
    const s = new AssetStore()
    const a = await s.put('one')
    const b = await s.put('two')
    const refs = await s.listRefs()
    expect(refs.sort()).toEqual([a, b].sort())
    refs.forEach((r) => expect(isAssetRef(r)).toBe(true))
  })

  it('gc removes orphans and keeps referenced assets', async () => {
    const s = new AssetStore()
    const keep = await s.put('still-used')
    await s.put('orphan-1')
    await s.put('orphan-2')
    const removed = await s.gc([keep])
    expect(removed).toBe(2)
    expect(await s.has(keep)).toBe(true)
    expect((await s.listRefs()).length).toBe(1)
  })
})
