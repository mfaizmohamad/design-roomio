/**
 * Version history (brief §3 "optional but high-trust") — lightweight restore
 * points so a bad edit can be rolled back to "yesterday's layout." Pure helpers
 * over the envelope's `history[]`; the session decides WHEN to snapshot.
 *
 * Snapshots store a full SceneEnvelope copy (no nested history) so a restore is
 * total. History is capped (oldest auto-snapshots dropped first; manual
 * checkpoints are kept preferentially).
 */
import type { RoomioDesign, VersionSnapshot } from './types'
import { cloneScene } from './factory'

export const MAX_HISTORY = 15
/** Minimum gap between automatic snapshots (ms) so autosave doesn't spam history. */
export const AUTO_SNAPSHOT_GAP_MS = 90_000

/** Build a snapshot of a design's current scene at its current rev. */
export function makeSnapshot(d: RoomioDesign, kind: 'auto' | 'manual', at: number, label?: string): VersionSnapshot {
  return {
    rev: d.rev,
    at,
    kind,
    ...(label ? { label } : {}),
    scene: cloneScene(d.scene),
    thumbnail: d.thumbnail,
  }
}

/** Cap the list: keep all manual checkpoints, drop oldest autos beyond the limit. */
export function capHistory(history: VersionSnapshot[]): VersionSnapshot[] {
  if (history.length <= MAX_HISTORY) return history
  const overflow = history.length - MAX_HISTORY
  let dropped = 0
  const kept: VersionSnapshot[] = []
  for (const snap of history) {
    if (dropped < overflow && snap.kind === 'auto') {
      dropped++
      continue
    }
    kept.push(snap)
  }
  // If still over (many manual checkpoints), drop oldest regardless.
  return kept.slice(Math.max(0, kept.length - MAX_HISTORY))
}

/**
 * Append a snapshot to a design's history (immutably), returning the new design.
 * Skips a no-op duplicate (same rev already at the tail).
 */
export function pushHistory(d: RoomioDesign, snap: VersionSnapshot): RoomioDesign {
  const history = d.history ?? []
  const tail = history[history.length - 1]
  if (tail && tail.rev === snap.rev && tail.kind === snap.kind && !snap.label) return d
  return { ...d, history: capHistory([...history, snap]) }
}

/** Should an automatic snapshot be taken now? (throttled by AUTO_SNAPSHOT_GAP_MS) */
export function shouldAutoSnapshot(d: RoomioDesign, now: number): boolean {
  const history = d.history ?? []
  const lastAuto = [...history].reverse().find((s) => s.kind === 'auto')
  if (!lastAuto) return true
  return now - lastAuto.at >= AUTO_SNAPSHOT_GAP_MS
}

/**
 * Restore a design's scene from a history snapshot. Returns a new design whose
 * scene is the snapshot's (deep-copied) — caller saves it as a NEW rev so the
 * restore is itself recorded (history is never destroyed by a restore).
 */
export function restoreFrom(d: RoomioDesign, rev: number): RoomioDesign | null {
  const snap = (d.history ?? []).find((s) => s.rev === rev)
  if (!snap) return null
  return { ...d, scene: cloneScene(snap.scene), thumbnail: snap.thumbnail }
}
