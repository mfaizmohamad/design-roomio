import { ARCHETYPE_MAP } from '../data/archetypes'
import type { FurnitureItem } from '../types'

// ───────────────────────────────────────────────────────────────────────────
// Functional ROLES layer.
//
// The suggestion rulebook reasons about what a room *functionally* has — a place
// to sit, a light, a rug, a focal anchor — not about specific archetype ids.
// This map is the bridge: it tags each archetype with the roles it can fill, so
// rules stay data-driven and the corpus can grow without touching rule logic.
//
// A single archetype can carry several roles (a sectional is both `seating` and
// a `focal_candidate`). Roles are derived from the catalog's category + model +
// a few explicit id sets, so adding a catalog entry usually needs no change here.
// ───────────────────────────────────────────────────────────────────────────

export type Role =
  | 'seating' // primary lounge seating (a place to sit and relax)
  | 'bed' // a real bed (sleeping necessity)
  | 'light' // a lamp / light source
  | 'rug' // an area rug
  | 'greenery' // a live plant / tree
  | 'coffee_or_side' // occasional table that completes a seating group
  | 'nightstand' // bedside surface
  | 'screen' // a TV / display
  | 'focal_candidate' // a piece strong enough to anchor the room
  | 'desk' // a work/gaming desk surface
  | 'display_shelf' // open shelving for collections (figures, manga, memorabilia)
  | 'bar' // bar cart / drinks cabinet / bar counter & stools
  | 'storage' // any storage piece

// Lounge seating: sofas + comfortable chairs + the bean bag. Dining chairs,
// stools, benches, poufs and rigid ottomans are intentionally excluded — they
// don't satisfy "a place to sit and relax" (R2).
const SEATING_CHAIRS = new Set([
  'chair-arm',
  'chair-accent',
  'chair-lounge',
  'chair-wingback',
  'chair-papasan',
  'chair-egg',
  'chair-rocking',
  'chair-gaming',
  'ottoman-bean',
])

const COFFEE_OR_SIDE = new Set([
  'table-coffee',
  'table-side',
  'table-end',
  'table-nesting',
  'ottoman-rect', // upholstered storage ottoman commonly used as a coffee table
])

// A side/end table next to a bed reads as a nightstand too.
const NIGHTSTAND = new Set(['storage-nightstand', 'table-side', 'table-end', 'table-nesting'])

const DISPLAY_SHELF = new Set([
  'storage-bookcase',
  'storage-shelving',
  'storage-cube',
  'storage-wall-shelf',
  'storage-ladder',
])

const BAR = new Set([
  'storage-barcart',
  'storage-drinks-cabinet',
  'table-bar',
  'stool-bar',
  'stool-counter',
])

// Strong "anchor the room" pieces beyond TVs (large/statement seating + media walls).
const FOCAL_FURNITURE = new Set([
  'sofa-sectional',
  'sofa-u',
  'sofa-chesterfield',
  'storage-media',
  'storage-tv',
  'decor-mirror', // oversized/sunburst statement mirror
])

const DESK_IDS = new Set([
  'desk-writing',
  'desk-office',
  'desk-l',
  'desk-corner',
  'desk-standing',
  'table-vanity',
])

/** All functional roles an archetype id can fill. */
export function rolesOf(archetypeId: string): Set<Role> {
  const a = ARCHETYPE_MAP[archetypeId]
  const roles = new Set<Role>()
  if (!a) return roles

  // seating
  if (a.category === 'sofa' || SEATING_CHAIRS.has(a.id)) roles.add('seating')
  // bed (real beds only — sleeper sofas/daybeds stay seating)
  if (a.category === 'bed') roles.add('bed')
  // light
  if (a.model === 'lamp' || a.model === 'chandelier') roles.add('light')
  // rug
  if (a.model === 'rug') roles.add('rug')
  // greenery
  if (a.model === 'plant') roles.add('greenery')
  // occasional table
  if (COFFEE_OR_SIDE.has(a.id)) roles.add('coffee_or_side')
  // nightstand
  if (NIGHTSTAND.has(a.id)) roles.add('nightstand')
  // screen
  if (a.model === 'tv') roles.add('screen')
  // desk
  if (DESK_IDS.has(a.id)) roles.add('desk')
  // display shelving
  if (DISPLAY_SHELF.has(a.id)) roles.add('display_shelf')
  // bar
  if (BAR.has(a.id)) roles.add('bar')
  // storage
  if (a.category === 'storage') roles.add('storage')
  // focal candidate: any screen, plus statement furniture
  if (roles.has('screen') || FOCAL_FURNITURE.has(a.id)) roles.add('focal_candidate')

  return roles
}

/** Does this item carry the given role? */
export function itemHasRole(item: FurnitureItem, role: Role): boolean {
  return rolesOf(item.archetype).has(role)
}

/** Count items in the room carrying a role. */
export function countRole(furniture: FurnitureItem[], role: Role): number {
  let n = 0
  for (const f of furniture) if (rolesOf(f.archetype).has(role)) n++
  return n
}

/** Does the room contain at least one item with the role? */
export function hasRole(furniture: FurnitureItem[], role: Role): boolean {
  return countRole(furniture, role) > 0
}
