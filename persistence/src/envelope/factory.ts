/**
 * Constructors for envelopes: a brand-new design and a duplicate.
 *
 * New designs are NEVER blocked on a name — they start "Untitled room", autosave
 * immediately, and rename later (brief §4, PS-7). Duplicate is "use this as a
 * starting point": a deep copy with a fresh identity and a PRIVATE share state
 * (you never inherit someone's share links, PS-8 reversibility / no leak).
 */
import { ENVELOPE_VERSION, freshShareState, type RoomioDesign } from './types'
import type { House, LightingStateLike } from '../scene/slices'
import { uid } from '../util/id'

export const UNTITLED = 'Untitled room'

export interface CreateDesignInput {
  house: House
  lighting?: LightingStateLike | null
  name?: string
  /** Override the clock (tests). Defaults to Date.now(). */
  now?: number
}

export function createDesign(input: CreateDesignInput): RoomioDesign {
  const now = input.now ?? Date.now()
  return {
    schema_version: ENVELOPE_VERSION,
    design_id: uid('design'),
    name: input.name ?? input.house.name ?? UNTITLED,
    createdAt: now,
    updatedAt: now,
    rev: 1,
    thumbnail: null,
    scene: { house: input.house, lighting: input.lighting ?? null },
    share: freshShareState(),
  }
}

/** Deep structural clone (envelopes are plain JSON, so this is total + safe). */
export function cloneScene<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/**
 * Duplicate a design as a new, independent, PRIVATE design. The copy gets a new
 * design_id, a "(copy)" name, reset revision, and a fresh (un-shared) share state
 * so a duplicate can never leak the original's view/edit links.
 */
export function duplicateDesign(src: RoomioDesign, now = Date.now()): RoomioDesign {
  const scene = cloneScene(src.scene)
  return {
    schema_version: ENVELOPE_VERSION,
    design_id: uid('design'),
    name: copyName(src.name),
    createdAt: now,
    updatedAt: now,
    rev: 1,
    thumbnail: src.thumbnail,
    scene,
    share: freshShareState(),
  }
}

function copyName(name: string): string {
  const base = (name || UNTITLED).trim()
  return /\(copy( \d+)?\)$/.test(base) ? `${base} (copy)` : `${base} (copy)`
}
