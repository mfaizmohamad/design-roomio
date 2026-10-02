/**
 * Aggregates the kitchen/bathroom (and other) fixtures Roomio doesn't model yet,
 * so we can log a single REQUEST -> ASSET in roomio.txt and meanwhile fall back to
 * the Placeholder Box. Don't block on missing assets (brief §3).
 */
import { ROOM_TYPE_LIST, type Essential } from './roomTypes'
import type { RoomType } from '../types'

export interface AssetGap {
  type: RoomType
  essential: Essential
}

/** Every essential, across all room types, that has no modeled archetype yet. */
export function allAssetGaps(): AssetGap[] {
  const gaps: AssetGap[] = []
  for (const info of ROOM_TYPE_LIST) {
    for (const e of info.essentials) {
      if (e.archetype === null) gaps.push({ type: info.type, essential: e })
    }
  }
  return gaps
}

/** A human-readable summary for the roomio.txt REQUEST -> ASSET entry. */
export function assetRequestSummary(): string {
  const byType = new Map<RoomType, string[]>()
  for (const { type, essential } of allAssetGaps()) {
    if (!byType.has(type)) byType.set(type, [])
    byType.get(type)!.push(essential.label)
  }
  return [...byType.entries()].map(([t, labels]) => `${t}: ${labels.join(', ')}`).join(' | ')
}
