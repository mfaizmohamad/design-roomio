// A multi-storey home: an ordered list of levels, each a set of replica rooms
// (same authoring contract as listingFlats.ts — see the header there).
//
// To add a home: follow docs/home-authoring-pipeline.md (legend → adjacency
// table → area check → questions → author → circulation tests → visual check).
// Then write one file exporting a MultiLevelHome and register it in
// ./index.ts. Nothing else changes — the house session stacks the levels at
// their elevations, the Furnish panel lists it, ?home=<id> deep-links it.
//
// Storey rules (checked for EVERY registered home by homes.test.ts):
//  - `elevationCm` is the level's finished floor above the ground floor; a
//    level's rooms normally use wallHeight == next level's elevation − this one.
//  - a double-height room lives on the LOWER level with wallHeight spanning both
//    storeys; the upper level simply has no room over it (the void).
//  - an opening on a wall shared ACROSS storeys (an upstairs door onto the void)
//    is authored on both rooms like any shared wall, the tall room's side `bare`
//    with sill = the upper level's elevation + the opening's own sill.

import type { ReplicaRoom } from '../listingFlats'

export interface HomeLevelSpec {
  /** short user-facing name, e.g. 'Ground floor' */
  label: string
  /** finished-floor height above the ground floor (cm); level 0 is 0 */
  elevationCm: number
  rooms: ReplicaRoom[]
}

export interface MultiLevelHome {
  id: string
  title: string
  emoji: string
  blurb: string
  /** provenance: what this reproduces (not shown to users) */
  reference: string
  /** Source and measurement limits for customer-facing dimension review. */
  planNote?: string
  /** bottom-up: levels[0] is the entry storey */
  levels: HomeLevelSpec[]
}

export const Q = Math.PI / 2
export const DARK_FRAME = '#3a3c3e'
export const WOOD_FRAME = '#6e4f37'
export const RAIL = '#b9b4ab' // brushed-steel glass-railing frame
