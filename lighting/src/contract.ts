// The cross-agent layered-lighting predicate (Agent E <-> Agent A).
//
// A's suggestion engine derives the 'light' role from FURNITURE (model==='lamp')
// and fires "No light source" / "Only one light source — layer ambient+task+accent".
// E lights every room with real ambient + task (+accent) renderer lights, which are
// NOT lamp furniture. This pure predicate lets A's engine treat a room E lights as
// lit + layered, so it passes those rules out of the box.
//
// A: import this (or mirror it) and consult it before firing the light rules.

import type { Light } from './types'

export interface LightingSatisfaction {
  /** at least one enabled light that actually emits. */
  hasLight: boolean
  /** layered = >=1 task light AND an ambient fill (the single-overhead fix). */
  isLayered: boolean
  /** full three-layer coverage (ambient + task + accent). */
  isFullyLayered: boolean
  layers: { ambient: number; task: number; accent: number }
}

function emits(l: Light): boolean {
  return l.enabled !== false && l.intensity > 0
}

/** Evaluate a room's lights against A's lighting rules. */
export function roomLightingSatisfaction(lights: Light[] | undefined): LightingSatisfaction {
  const ls = (lights ?? []).filter(emits)
  const layers = { ambient: 0, task: 0, accent: 0 }
  for (const l of ls) layers[l.layer]++

  const hasLight = ls.length > 0
  const isLayered = layers.task >= 1 && layers.ambient >= 1
  const isFullyLayered = isLayered && layers.accent >= 1

  return { hasLight, isLayered, isFullyLayered, layers }
}

// ---------------------------------------------------------------------------
// Light Mode (presentation) <-> furniture editing (Agent E <-> Agent A / B).
//
// "Light Mode" is a global presentation flag (lighting store). While it's on, the user
// is playing with light and must not accidentally move the layout: ALL furniture is
// locked and the editing hints are hidden. Furniture's own `locked` flags are NOT
// mutated, so turning Light Mode off returns every piece to its prior (default) state.

/** A piece is non-interactive when it is pinned OR Light Mode is on. A reads this in
 *  FurnitureEditor (`if (furnitureLocked(item, lightMode)) return` on drag/rotate/resize). */
export function furnitureLocked(item: { locked?: boolean } | undefined, lightMode: boolean): boolean {
  return lightMode || !!item?.locked
}

/** Whether the editing hints / move-furniture affordances should be shown. A reads this
 *  in Furnish (`{showEditingHints(lightMode) && <p className="hint">…</p>}`). */
export function showEditingHints(lightMode: boolean): boolean {
  return !lightMode
}
