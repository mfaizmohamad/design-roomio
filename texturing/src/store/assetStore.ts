/**
 * Agent H — content-addressed asset store (H5 / brief §5 "store a reference, not a giant
 * embedded image"). The design persists only sha256 REFERENCES (on FurnitureItem.texture);
 * the actual map/photo bytes live here, keyed by content hash, so identical photos dedupe
 * and the design envelope + history snapshots stay small.
 *
 * Built behind Agent C's StorageAdapter shape (async getItem/setItem/removeItem/keys) so it
 * inherits C's quota-safe degrade and the future cloud-adapter swap. Values are STRINGS
 * (data-URLs), matching C's "the caller serializes; values are strings" contract. In the
 * browser, back this with an IndexedDB adapter for large blobs; the API above is unchanged.
 */
import { assetRefOf } from '../pipeline/sha256'
import { isAssetRef, type AssetRef } from '../contract'

/** Mirror of Agent C's StorageAdapter (persistence/src/storage/adapter.ts), async + string. */
export interface StorageAdapter {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
}

export const ASSET_PREFIX = 'roomio.asset.'

function hexOf(ref: AssetRef): string {
  return ref.slice('sha256:'.length)
}
function keyForRef(ref: AssetRef): string {
  return ASSET_PREFIX + hexOf(ref)
}
function refForKey(key: string): AssetRef {
  return 'sha256:' + key.slice(ASSET_PREFIX.length)
}

/** In-memory StorageAdapter — the test/fallback backend (mirrors C's degrade target). */
export class MemoryAdapter implements StorageAdapter {
  private m = new Map<string, string>()
  async getItem(key: string): Promise<string | null> {
    return this.m.has(key) ? this.m.get(key)! : null
  }
  async setItem(key: string, value: string): Promise<void> {
    this.m.set(key, value)
  }
  async removeItem(key: string): Promise<void> {
    this.m.delete(key)
  }
  async keys(prefix = ''): Promise<string[]> {
    const out: string[] = []
    for (const k of this.m.keys()) if (k.startsWith(prefix)) out.push(k)
    return out
  }
}

export class AssetStore {
  constructor(private adapter: StorageAdapter = new MemoryAdapter()) {}

  /** Store a string asset (e.g. a data-URL). Returns its content-hash AssetRef. Dedupes:
   *  storing identical content twice writes once and returns the same ref. */
  async put(value: string): Promise<AssetRef> {
    const ref = assetRefOf(new TextEncoder().encode(value))
    const key = keyForRef(ref)
    // content-addressed: if present, it is byte-identical, so skip the write.
    if ((await this.adapter.getItem(key)) === null) {
      await this.adapter.setItem(key, value)
    }
    return ref
  }

  /** Retrieve a stored asset by ref, or null if absent / not a valid ref. */
  async get(ref: AssetRef): Promise<string | null> {
    if (!isAssetRef(ref)) return null
    return this.adapter.getItem(keyForRef(ref))
  }

  async has(ref: AssetRef): Promise<boolean> {
    return (await this.get(ref)) !== null
  }

  /** Remove one asset. Caller is responsible for ref-counting (no design still uses it). */
  async remove(ref: AssetRef): Promise<void> {
    if (!isAssetRef(ref)) return
    await this.adapter.removeItem(keyForRef(ref))
  }

  /** All asset refs currently in the store. */
  async listRefs(): Promise<AssetRef[]> {
    const ks = await this.adapter.keys(ASSET_PREFIX)
    return ks.map(refForKey)
  }

  /**
   * Garbage-collect: remove every stored asset whose ref is NOT in `keep`.
   * Caller passes the union of asset_id + map refs across all live designs (H5 lifecycle;
   * Agent C's repository.remove path is the natural place to trigger this).
   */
  async gc(keep: Iterable<AssetRef>): Promise<number> {
    const keepSet = new Set<string>()
    for (const r of keep) if (isAssetRef(r)) keepSet.add(r)
    let removed = 0
    for (const ref of await this.listRefs()) {
      if (!keepSet.has(ref)) {
        await this.remove(ref)
        removed++
      }
    }
    return removed
  }
}
