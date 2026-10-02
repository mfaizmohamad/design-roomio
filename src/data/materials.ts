// Wall color swatches (matches the Step-4 reference palette) and floor textures.
// Floor textures are generated procedurally (see three/textures.ts) so the app
// has zero external asset dependencies.

import type { SurfaceKind } from '../three/furnitureTextures'

export interface WallColor {
  id: string
  name: string
  hex: string
}

export const WALL_COLORS: WallColor[] = [
  { id: 'white', name: 'Pure white', hex: '#f4f1ea' },
  { id: 'sand', name: 'Warm sand', hex: '#d6c6a8' },
  { id: 'blush', name: 'Soft blush', hex: '#e8cdbf' },
  { id: 'terracotta', name: 'Terracotta', hex: '#b85c38' },
  { id: 'brick', name: 'Brick red', hex: '#7c3b34' },
  { id: 'sky', name: 'Pale sky', hex: '#bcd0d6' },
  { id: 'steel', name: 'Steel blue', hex: '#4f7488' },
  { id: 'sage', name: 'Sage green', hex: '#8fa07a' },
  { id: 'stone', name: 'Stone grey', hex: '#7c7b76' },
  { id: 'taupe', name: 'Taupe', hex: '#9a8167' },
  { id: 'plum', name: 'Dusty plum', hex: '#6f5168' },
  { id: 'pine', name: 'Pine green', hex: '#3f6b5b' },
]

export type FloorKind = 'wood' | 'tile' | 'concrete'

export interface FloorTexture {
  id: string
  name: string
  kind: FloorKind
  /** base color hex */
  base: string
  /** secondary tone for grain / grout */
  accent: string
  /** plank or tile size in cm */
  cell: number
  /** PBR roughness for the rendered surface (default 0.82 — matte). Polished
   *  stone reads glossy at ~0.1–0.2. */
  roughness?: number
  /** draw marble-style veining (previously hardcoded to the 'marble-tile' id) */
  veined?: boolean
  /** terrazzo-style speckle flecks on tile (the white speckled wall tile of
   *  Indian kitchens/utility areas) */
  speckled?: boolean
  /** mirror-like screen-space reflection strength 0..1 (glossy vitrified look);
   *  0/absent = plain material */
  reflect?: number
  /** PBR finish family used to synthesise the {albedo, +Y normal, roughness}
   *  map-set (see three/furnitureTextures.ts). Falls back to a sensible default
   *  derived from `kind`/flags when absent (see three/textures.ts). */
  surface?: SurfaceKind
}

export const FLOOR_TEXTURES: FloorTexture[] = [
  // --- Wood --- (real oak/walnut veneer: anisotropic straight grain)
  { id: 'natural-oak', name: 'Natural oak', kind: 'wood', base: '#c79a62', accent: '#a87f49', cell: 22, surface: 'wood' },
  { id: 'light-oak', name: 'Light oak', kind: 'wood', base: '#d9bd8c', accent: '#c2a06a', cell: 22, surface: 'wood' },
  { id: 'grey-wood', name: 'Grey wood', kind: 'wood', base: '#a39c92', accent: '#857e74', cell: 22, surface: 'wood' },
  { id: 'walnut', name: 'Walnut', kind: 'wood', base: '#7c5536', accent: '#5e3f27', cell: 22, surface: 'wood' },
  { id: 'cherry', name: 'Red cherry', kind: 'wood', base: '#a85636', accent: '#8a4026', cell: 22, surface: 'wood' },
  { id: 'espresso', name: 'Espresso', kind: 'wood', base: '#3f2f25', accent: '#2c2019', cell: 22, surface: 'wood' },
  { id: 'honey', name: 'Honey pine', kind: 'wood', base: '#cda05c', accent: '#b07f3c', cell: 18, surface: 'wood' },
  { id: 'ash', name: 'Pale ash', kind: 'wood', base: '#cabfa6', accent: '#b0a487', cell: 18, surface: 'wood' },
  { id: 'chevron', name: 'Smoked oak', kind: 'wood', base: '#9a7548', accent: '#7a5a33', cell: 20, surface: 'wood' },
  // --- Tile --- (grid + grout, per-tile hue jitter; marble ones get domain-warped veins)
  { id: 'white-tile', name: 'White tile', kind: 'tile', base: '#e8e6e1', accent: '#cfccc4', cell: 40, surface: 'tile' },
  { id: 'grey-tile', name: 'Grey tile', kind: 'tile', base: '#bdbcb8', accent: '#9d9c97', cell: 40, surface: 'tile' },
  { id: 'sand-tile', name: 'Sand tile', kind: 'tile', base: '#d8cdb8', accent: '#bcae93', cell: 40, surface: 'tile' },
  { id: 'slate-tile', name: 'Slate tile', kind: 'tile', base: '#6f7174', accent: '#54565a', cell: 40, surface: 'tile' },
  { id: 'marble-tile', name: 'Marble', kind: 'tile', base: '#ebe9e6', accent: '#cdd1d4', cell: 50, veined: true, surface: 'marble' },
  { id: 'check-tile', name: 'Checker', kind: 'tile', base: '#e4e2dc', accent: '#3a3a3a', cell: 30, surface: 'tile' },
  // --- Listing-replica finishes (Kothrud 2BHK: glossy grey-veined vitrified
  // marble floors, marble-clad kitchen walls, teak balcony deck + plank ceiling).
  // Base/accent sampled from the listing photos.
  { id: 'glossy-marble', name: 'Glossy grey marble', kind: 'tile', base: '#bcbdb6', accent: '#8f9188', cell: 80, veined: true, roughness: 0.14, reflect: 0.5, surface: 'marble' },
  { id: 'marble-wall', name: 'Marble wall tile', kind: 'tile', base: '#cbccc6', accent: '#a3a59d', cell: 80, veined: true, roughness: 0.24, surface: 'marble' },
  { id: 'glossy-white-tile', name: 'Glossy white tile', kind: 'tile', base: '#eae8e3', accent: '#d5d3cc', cell: 60, roughness: 0.12, reflect: 0.45, surface: 'ceramic' },
  { id: 'ivory-marble', name: 'Ivory marble', kind: 'tile', base: '#ded3bd', accent: '#c3b697', cell: 80, veined: true, roughness: 0.16, reflect: 0.4, surface: 'marble' },
  { id: 'speckle-tile', name: 'Speckled wall tile', kind: 'tile', base: '#eeece6', accent: '#8f8d86', cell: 30, speckled: true, roughness: 0.3, surface: 'tile' },
  { id: 'teak-plank', name: 'Teak deck plank', kind: 'wood', base: '#b0764c', accent: '#7e4e2e', cell: 14, roughness: 0.55, surface: 'wood' },
  { id: 'wood-plank-ceiling', name: 'Stained wood boards', kind: 'wood', base: '#3a2820', accent: '#221510', cell: 11, roughness: 1, surface: 'wood' },
  // Room-type accent tiles (used by the flat templates so bathrooms/kitchens read distinctly).
  { id: 'blue-tile', name: 'Ocean blue tile', kind: 'tile', base: '#3f7fb0', accent: '#2c5f88', cell: 20, surface: 'tile' },
  { id: 'terracotta-tile', name: 'Terracotta tile', kind: 'tile', base: '#c07b52', accent: '#a15f3c', cell: 30, surface: 'tile' },
  // --- Concrete / soft --- (mottled matte stone)
  { id: 'light-concrete', name: 'Light concrete', kind: 'concrete', base: '#cdcac4', accent: '#b6b3ac', cell: 100, surface: 'stone' },
  { id: 'mid-concrete', name: 'Concrete', kind: 'concrete', base: '#a8a6a1', accent: '#94928d', cell: 100, surface: 'stone' },
  { id: 'dark-concrete', name: 'Dark concrete', kind: 'concrete', base: '#6d6c69', accent: '#5a5956', cell: 100, surface: 'stone' },
]

export const FLOOR_MAP: Record<string, FloorTexture> = Object.fromEntries(
  FLOOR_TEXTURES.map((f) => [f.id, f]),
)

export const DEFAULT_WALL_COLOR = WALL_COLORS[0].hex
export const DEFAULT_FLOOR = 'natural-oak'
