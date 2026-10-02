/**
 * Forward-migration: normalize ANY historical save shape into a current envelope.
 *
 * The CARDINAL RULE (brief §7): old saves must keep loading. We accept, in order:
 *   1. A current envelope (schema_version '1.0' with a `scene`).
 *   2. A top-level { house, lighting } object (envelope without the wrapper fields).
 *   3. A bare House (multi-room save).
 *   4. A bare RoomDesign (today's single-room save).
 *   5. Agent A's localStorage design-map { [id]: RoomDesign }.
 * Anything unrecognizable returns null (caller decides what to do — never throws).
 *
 * Unknown fields are preserved; missing fields get sane defaults. This is the only
 * place that knows how to read the past, so adding a future format = one new branch.
 */
import {
  ENVELOPE_VERSION,
  freshShareState,
  type RoomioDesign,
  type SceneEnvelope,
  type ShareAccess,
  type ShareState,
  type VersionSnapshot,
} from './types'
import type { House, LightingStateLike } from '../scene/slices'
import { coerceHouse } from '../scene/coerce'
import { capHistory } from './history'
import { uid } from '../util/id'

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}
function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v ? v : fallback
}

function coerceShare(v: unknown): ShareState {
  if (!isObj(v)) return freshShareState()
  const access: ShareAccess =
    v.access === 'view' || v.access === 'edit' || v.access === 'private'
      ? v.access
      : 'private'
  return {
    access,
    view_link_id: typeof v.view_link_id === 'string' ? v.view_link_id : null,
    edit_link_id: typeof v.edit_link_id === 'string' ? v.edit_link_id : null,
  }
}

function coerceLighting(v: unknown): LightingStateLike | null {
  return isObj(v) ? (v as LightingStateLike) : null
}

function coerceHistory(v: unknown): VersionSnapshot[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: VersionSnapshot[] = []
  for (const s of v) {
    if (!isObj(s)) continue
    const house = coerceHouse((s.scene as Record<string, unknown> | undefined)?.house ?? s.scene)
    if (!house) continue
    out.push({
      rev: isFiniteNumber(s.rev) ? s.rev : 0,
      at: isFiniteNumber(s.at) ? s.at : Date.now(),
      kind: s.kind === 'manual' ? 'manual' : 'auto',
      label: typeof s.label === 'string' ? s.label : undefined,
      scene: { house, lighting: coerceLighting((s.scene as Record<string, unknown>)?.lighting) },
      thumbnail: typeof s.thumbnail === 'string' ? s.thumbnail : null,
    })
  }
  // Use the SAME cap + manual-checkpoint-preserving eviction as the runtime
  // (history.ts capHistory), so a save→reload round-trip is deterministic and
  // never drops an older manual restore point by mere recency.
  return out.length ? capHistory(out) : undefined
}

/** Build a complete envelope around a known-good House + lighting + metadata. */
function envelopeFrom(
  house: House,
  lighting: LightingStateLike | null,
  meta: Partial<RoomioDesign>,
): RoomioDesign {
  const createdAt = isFiniteNumber(meta.createdAt) ? meta.createdAt : house.createdAt ?? Date.now()
  const updatedAt = isFiniteNumber(meta.updatedAt) ? meta.updatedAt : house.updatedAt ?? createdAt
  const scene: SceneEnvelope = { house, lighting }
  return {
    schema_version: ENVELOPE_VERSION,
    design_id: str(meta.design_id, house.house_id || uid('design')),
    name: str(meta.name, house.name || 'Untitled room'),
    createdAt,
    updatedAt,
    rev: isFiniteNumber(meta.rev) ? meta.rev : 1,
    thumbnail: typeof meta.thumbnail === 'string' ? meta.thumbnail : null,
    scene,
    share: meta.share ?? freshShareState(),
    ...(meta.history ? { history: meta.history } : {}),
  }
}

/**
 * The one function callers use on load/import. Returns a current envelope or null.
 */
export function migrateToEnvelope(value: unknown): RoomioDesign | null {
  // (1) current (or near-current) envelope: has a `scene` wrapper
  if (isObj(value) && isObj(value.scene)) {
    const scene = value.scene as Record<string, unknown>
    const house = coerceHouse(scene.house)
    if (!house) return null
    const env = envelopeFrom(house, coerceLighting(scene.lighting), {
      design_id: value.design_id as string,
      name: value.name as string,
      createdAt: value.createdAt as number,
      updatedAt: value.updatedAt as number,
      rev: value.rev as number,
      thumbnail: value.thumbnail as string,
      share: coerceShare(value.share),
      history: coerceHistory(value.history),
    })
    // Forward-compat (types.ts contract: "unknown fields preserved on round-trip"):
    // carry through any unknown top-level keys a NEWER Roomio added, and never
    // downgrade the version — preserve the source's (possibly higher) schema_version
    // so re-saving in an older client doesn't silently strip v2 data.
    const KNOWN = new Set([
      'schema_version', 'design_id', 'name', 'createdAt', 'updatedAt', 'rev', 'thumbnail', 'scene', 'share', 'history',
    ])
    const extras: Record<string, unknown> = {}
    for (const k of Object.keys(value)) if (!KNOWN.has(k)) extras[k] = value[k]
    return { ...extras, ...env, schema_version: str(value.schema_version, ENVELOPE_VERSION) }
  }

  // (2) a flat { house, lighting } (envelope without the wrapper fields)
  if (isObj(value) && (isObj(value.house) || looksLikeHouseTop(value))) {
    const house = coerceHouse(value.house ?? value)
    if (house) {
      return envelopeFrom(house, coerceLighting(value.lighting), {
        design_id: value.design_id as string,
        name: (value.name as string) ?? house.name,
        createdAt: value.createdAt as number,
        updatedAt: value.updatedAt as number,
        share: coerceShare(value.share),
      })
    }
  }

  // (3)/(4)/(5) bare House, bare RoomDesign, or A's design-map — coerceHouse handles all
  const house = coerceHouse(value)
  if (house) {
    return envelopeFrom(house, null, { name: house.name })
  }

  return null
}

/** True when `v` is itself a House-shaped object (has rooms[]). */
function looksLikeHouseTop(v: Record<string, unknown>): boolean {
  return Array.isArray(v.rooms)
}
