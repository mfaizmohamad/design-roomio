// Open a multi-storey home from the registry (data/homes) in 3D: load every
// level into the house session and land on the whole-house view, all storeys
// stacked. Shared by the Furnish-panel selector, the style picker and the
// ?home=<id>[&level=<n>] deep link.

import { useHouse } from './three/houseSession'
import { useHouseView, type LevelFilter } from './three/houseViewMode'
import { useLighting } from '../lighting/src/store'

export function openHome(homeId: string, levelFilter: LevelFilter = 'all'): boolean {
  if (!useHouse.getState().loadHome(homeId)) return false
  // Late-afternoon sun: low enough to rake through double-height glazing and
  // jali screens — the golden look of both reference walkthroughs.
  const lighting = useLighting.getState()
  lighting.setTimeOfDay(0.62)
  lighting.setMaxElevation(45)
  const view = useHouseView.getState()
  view.setLevelFilter(levelFilter)
  view.setMode('house')
  return true
}

/** Parse a ?level= value: a storey index, else every storey ('all'). */
export function parseLevelFilter(v: string | null): LevelFilter {
  const n = v == null ? NaN : Number(v)
  return Number.isInteger(n) && n >= 0 ? n : 'all'
}
