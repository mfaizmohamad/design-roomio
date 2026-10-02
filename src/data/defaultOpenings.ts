/**
 * Default doors + windows for a room (Agent C). Persona genre presets and freshly
 * added rooms used to load as sealed boxes (openings: []); this gives every room a
 * sensible door + window(s) out of the box, geometry-driven so it works for any
 * footprint. Fully editable afterward (the user can move/resize/remove them).
 *
 * Wall ids are deterministic (`w{i}` from deriveWalls, keyed on corner index), so
 * openings generated here match the walls the store re-derives on load.
 */
import type { Opening, OpeningStyle, Vec2 } from '../types'
import { deriveWalls } from '../geometry/walls'
import { OPENING_MAP } from './openings'

let seq = 0
function oid(): string {
  seq = (seq + 1) % Number.MAX_SAFE_INTEGER
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `op-${crypto.randomUUID().slice(0, 8)}`
  } catch {
    /* fall through */
  }
  return `op-${seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * A door (offset from centre) plus one or two windows on distinct walls. Each
 * opening's width is clamped to fit its wall, so narrow rooms still get valid
 * openings instead of clipped/oversized ones.
 */
export function defaultOpenings(corners: Vec2[]): Opening[] {
  const walls = deriveWalls(corners)
  if (walls.length === 0) return []
  const out: Opening[] = []

  const place = (style: OpeningStyle, wallIndex: number, t: number) => {
    const w = walls[wallIndex]
    if (!w) return
    const def = OPENING_MAP[style]
    if (!def) return
    const maxW = w.length * 0.8 // leave room at the wall ends
    if (maxW < 40) return // wall too short for any opening
    const width = Math.min(def.width, maxW)
    out.push({
      id: oid(),
      kind: def.kind,
      style,
      wallId: w.id,
      t,
      width,
      height: def.height,
      sill: def.sill,
    })
  }

  // Door on the first wall, offset from centre so it doesn't sit dead-behind
  // centre-placed furniture (e.g. a bed headboard).
  place('single', 0, 0.35)
  // Window opposite the door (a big one if the wall is wide enough)…
  if (walls.length >= 3) place(walls[2].length >= 220 ? 'windowDouble' : 'windowSingle', 2, 0.5)
  // …and a second window on an adjacent wall for cross-light.
  if (walls.length >= 2) place('windowSingle', 1, 0.5)

  return out
}
