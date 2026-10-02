/**
 * One-time, NON-DESTRUCTIVE import of pre-persistence saves (brief §7 backward
 * compat: "old single-room saves still load"). Before this feature, Agent A stored
 * designs as a localStorage map under `roomio.designs.v1` = { [id]: RoomDesign }.
 * On first run we wrap each of those into the new envelope and add them to the
 * library — without touching or deleting the original key (so nothing is lost and
 * the old app keeps working).
 *
 * Idempotent: a done-flag is set so we migrate at most once; existing designs are
 * never overwritten.
 */
import type { DesignRepository } from './repository'
import type { StorageAdapter } from './adapter'
import { migrateToEnvelope } from '../envelope/migrate'

export const LEGACY_KEY = 'roomio.designs.v1'
const DONE_FLAG = 'roomio.legacy.imported.v1'

/** Returns how many legacy designs were imported (0 if none / already done). */
export async function importLegacyDesigns(repo: DesignRepository, adapter: StorageAdapter): Promise<number> {
  // Run at most once (persisted). Set the flag up-front so a mid-way crash can't
  // re-import duplicates on the next run.
  if (await adapter.getItem(DONE_FLAG)) return 0
  const raw = await adapter.getItem(LEGACY_KEY)
  await adapter.setItem(DONE_FLAG, '1')
  if (!raw) return 0

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 0
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 0

  let imported = 0
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    const env = migrateToEnvelope(value) // bare RoomDesign → one-room-house envelope
    if (!env) continue
    if (await repo.has(env.design_id)) continue // never overwrite an existing design
    await repo.save(env)
    imported++
  }
  return imported
}
