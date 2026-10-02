// Drives Agent E's lighting store from the global `lightsOn` flag. "Lights off" now means
// "lamps off → the room is lit ONLY by daylight through the window", the physically-correct inverse
// of the old behavior:
//   1. The electric task/accent room fixtures turn off across every room (as before).
//   2. The SUN IS LEFT ALONE — daylight is owned by E's time-of-day bar. Killing the sun with the
//      lamps (the old line) removed the ONLY daylight source and the only shadow caster, which is
//      exactly backwards for "light comes from the window". Now the sun keeps shining through the
//      real wall apertures (holes cut by buildWallParts), casting the window shaft.
//   3. E's always-on flat FILL (hardcoded hemisphere + ambient + ceiling downlights) is scaled DOWN
//      via fillScale, so the room falls into shadow away from the window instead of staying
//      uniformly lit. WindowDaylight (src/three) adds the per-window area light + emissive sky pane.
// The emissive bulb GLOW is still gated off in MaterialEnhancer (tagged window panes are exempt).
//
// Cross-island: reads Agent E's useLighting store (same singleton the app's <LightingRig> reads;
// zustand is deduped at the app root). No-op in the standalone harness (its lights aren't in E's
// store — the harness Scene reads `lightsOn` directly instead).

import { useEffect } from 'react'
import { useRender } from '../store'
import { useLighting } from '../../../lighting/src/store'

// How far to collapse E's always-on flat fill when the lamps are off (but NOT in Light Mode). Low
// enough that window daylight clearly dominates, but a non-zero floor so a plain windowless/night
// lamps-off scene isn't pitch black.
const DAYLIGHT_FILL_SCALE = 0.2

/**
 * Light Mode (E) is a pure "trace the sun through the windows" presentation, so it collapses E's
 * flat fill to ZERO — only the sun + the per-window daylight illuminate the room. Plain lamps-off
 * (G's independent toggle, no windows required) keeps a low floor so it isn't pitch black.
 */
export function flatFillScale(lightMode: boolean, lightsOn: boolean): number {
  if (lightMode) return 0
  return lightsOn ? 1 : DAYLIGHT_FILL_SCALE
}

/** The electric task/accent fixtures are dark in any daylight-only presentation — Light Mode
 *  (sun-only) OR the lamps switched off. */
export function fixturesLit(lightMode: boolean, lightsOn: boolean): boolean {
  return lightsOn && !lightMode
}

export function LightsSync() {
  const lightsOn = useRender((s) => s.lightsOn)
  const lightMode = useLighting((s) => s.lightMode)

  useEffect(() => {
    const ls = useLighting.getState()
    const lit = fixturesLit(lightMode, lightsOn)
    // Task/accent room lights (the electric fixtures) on/off across every room.
    for (const [roomId, room] of Object.entries(ls.rooms)) {
      for (const l of room.lights) {
        if (l.layer === 'ambient') continue // ambient fill is governed by fillScale below
        const currentlyOn = l.enabled !== false
        if (currentlyOn !== lit) {
          ls.updateLight(roomId, l.id, { enabled: lit })
        }
      }
    }
    // Collapse E's always-on flat fill for daylight-only presentations so the sun/window contrast is
    // visible (the sun toggle alone can't darken E's hardcoded fill). The sun is deliberately NOT
    // touched here: daylight is owned by the time-of-day bar.
    ls.setFillScale?.(flatFillScale(lightMode, lightsOn))
  }, [lightsOn, lightMode])

  return null
}
