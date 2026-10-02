/**
 * DesignRepository — CRUD for whole-design envelopes over a StorageAdapter.
 *
 * One envelope per key (`roomio.design.<id>`). Listing scans keys and projects
 * each envelope to a lightweight summary (no index to drift out of sync — mirrors
 * A's readMap approach, robust to partial corruption). Load runs forward-migration
 * so old saves open. Save is the durable write the autosave engine calls.
 */
import type { RoomioDesign, DesignSummary } from '../envelope/types'
import { toSummary } from '../envelope/types'
import { migrateToEnvelope } from '../envelope/migrate'
import type { StorageAdapter } from './adapter'

const KEY_PREFIX = 'roomio.design.'
const keyFor = (id: string) => `${KEY_PREFIX}${id}`

export class DesignRepository {
  constructor(private adapter: StorageAdapter) {}

  get backend(): string {
    return this.adapter.kind
  }

  /** All saved designs as summaries, newest-edited first. Skips corrupt entries. */
  async list(): Promise<DesignSummary[]> {
    const keys = await this.adapter.keys(KEY_PREFIX)
    const out: DesignSummary[] = []
    for (const k of keys) {
      const raw = await this.adapter.getItem(k)
      if (!raw) continue
      const env = safeMigrate(raw)
      if (env) out.push(toSummary(env))
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** Load one design (migrating legacy shapes forward); null if absent/corrupt. */
  async load(id: string): Promise<RoomioDesign | null> {
    const raw = await this.adapter.getItem(keyFor(id))
    if (!raw) return null
    return safeMigrate(raw)
  }

  /** Durable write of an envelope. Rejects on failure so autosave can retry. */
  async save(d: RoomioDesign): Promise<void> {
    await this.adapter.setItem(keyFor(d.design_id), JSON.stringify(d))
  }

  /** Remove one design. */
  async remove(id: string): Promise<void> {
    await this.adapter.removeItem(keyFor(id))
  }

  /** Does a design exist? (cheap existence check) */
  async has(id: string): Promise<boolean> {
    return (await this.adapter.getItem(keyFor(id))) !== null
  }
}

function safeMigrate(raw: string): RoomioDesign | null {
  try {
    return migrateToEnvelope(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}
