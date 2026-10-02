import type { OpeningKind, OpeningStyle } from '../types'

export interface OpeningDef {
  style: OpeningStyle
  kind: OpeningKind
  name: string
  width: number // cm
  height: number // cm
  sill: number // cm above floor
  leaves: number // number of door/sash leaves (0 = an open passage, frame only)
  glass: number // 0..1 fraction of the leaf that is glazed
  /** divided-lite grid per leaf [cols, rows] (defaults: window 2×2, glazed door 1×3/1×4) */
  grid?: [number, number]
  /** muntin bar thickness scale (1 = default). Grille windows use thin dark bars. */
  barScale?: number
}

export const DOOR_DEFS: OpeningDef[] = [
  { style: 'single', kind: 'door', name: 'Single Panel Door', width: 85, height: 205, sill: 0, leaves: 1, glass: 0 },
  { style: 'glass', kind: 'door', name: 'Glass Door', width: 90, height: 205, sill: 0, leaves: 1, glass: 0.7 },
  { style: 'french', kind: 'door', name: 'French Double Door', width: 150, height: 210, sill: 0, leaves: 2, glass: 0.8 },
  { style: 'double', kind: 'door', name: 'Double Panel Door', width: 160, height: 205, sill: 0, leaves: 2, glass: 0 },
  { style: 'bifold', kind: 'door', name: 'Bifold Panel Double Door', width: 180, height: 205, sill: 0, leaves: 4, glass: 0 },
  { style: 'glassDouble', kind: 'door', name: 'Glass Double Door', width: 170, height: 210, sill: 0, leaves: 2, glass: 0.85 },
  // Aluminum sliding balcony door: two full-glass sashes, one big lite each.
  { style: 'slider', kind: 'door', name: 'Sliding Glass Door', width: 240, height: 212, sill: 0, leaves: 2, glass: 0.94, grid: [1, 1] },
  // Open passage — frame/jamb only, no leaves (the open-kitchen entry of a flat).
  { style: 'passage', kind: 'door', name: 'Open Passage', width: 220, height: 210, sill: 0, leaves: 0, glass: 0 },
]

export const WINDOW_DEFS: OpeningDef[] = [
  { style: 'windowSingle', kind: 'window', name: 'Glass Window Single', width: 95, height: 120, sill: 95, leaves: 1, glass: 0.9 },
  { style: 'windowDouble', kind: 'window', name: 'Glass Window Double', width: 175, height: 130, sill: 90, leaves: 2, glass: 0.9 },
  // Safety-grille casement (ubiquitous in Indian flats): one sash, dense thin bars.
  { style: 'windowGrille', kind: 'window', name: 'Grille Window', width: 170, height: 150, sill: 85, leaves: 1, glass: 0.94, grid: [3, 4], barScale: 0.45 },
  // Balcony railing band: full-width glass with slim posts (reads as glass railing).
  { style: 'windowRail', kind: 'window', name: 'Glass Railing Band', width: 300, height: 110, sill: 95, leaves: 1, glass: 0.96, grid: [4, 1], barScale: 0.6 },
]

export const OPENING_DEFS: OpeningDef[] = [...DOOR_DEFS, ...WINDOW_DEFS]

export const OPENING_MAP: Record<string, OpeningDef> = Object.fromEntries(
  OPENING_DEFS.map((d) => [d.style, d]),
)
