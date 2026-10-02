// Performance invariants for house-wide lighting. The sun is the PRIMARY (and by default
// ONLY) shadow caster; per-room lights are non-shadowing; ambient is one global fill.
// These pure helpers let us assert "framerate holds" structurally (no per-room shadow maps).

import type { LightingState } from './types'

/** Total shadow-casting lights in the scene = sun (if enabled) + any room light with castShadow. */
export function sceneShadowCasterCount(state: LightingState): number {
  const sun = state.sun.enabled ? 1 : 0
  let roomCasters = 0
  for (const room of Object.values(state.rooms)) {
    for (const l of room.lights) if (l.castShadow && l.enabled !== false) roomCasters++
  }
  return sun + roomCasters
}

/** Total positioned (non-ambient) lights that get rendered as real lights. */
export function scenePositionedLightCount(state: LightingState): number {
  let n = 0
  for (const room of Object.values(state.rooms)) {
    for (const l of room.lights) if (l.layer !== 'ambient' && l.enabled !== false) n++
  }
  return n
}

/**
 * A house is "performance-healthy" when shadow casters stay capped — the sun plus at most a
 * small number of opt-in room shadow casters — regardless of how many rooms are lit.
 */
export function isPerformanceHealthy(state: LightingState, maxShadowCasters = 3): boolean {
  return sceneShadowCasterCount(state) <= maxShadowCasters
}
