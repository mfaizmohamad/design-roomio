/**
 * The Roomio save ENVELOPE — Agent C owns this; each agent owns a slice inside it.
 *
 * One design = one envelope. It composes the FULL scene so a saved design is the
 * whole dwelling, not just one room:
 *   scene.house    → Agent C's House (which embeds Agent A's RoomDesign per room)
 *   scene.lighting → Agent E's LightingState (or null ⇒ E renders its defaults)
 *
 * It is VERSIONED so old saves keep loading (see migrate.ts): a bare RoomDesign
 * (today's single-room save), a bare House, or Agent A's localStorage design-map
 * all normalize forward into a current envelope.
 *
 * Published as shared/save_envelope_schema.json (v1.0). Additive + forward-compatible:
 * unknown fields are preserved on round-trip; consumers ignore what they don't know.
 */
import type { House, LightingStateLike } from '../scene/slices'

/** Current envelope format version. Bump only on a breaking shape change. */
export const ENVELOPE_VERSION = '1.0' as const

/** Access level for a shared design. Defaults to the SAFE option (view). */
export type ShareAccess = 'private' | 'view' | 'edit'

export interface ShareState {
  /** What a link grants. `private` = not shared; first share defaults to `view`. */
  access: ShareAccess
  /** Opaque token for the view-only SHOWCASE link (read-only walkthrough). */
  view_link_id: string | null
  /** Opaque token for an edit link (only meaningful with a backend; null local-first). */
  edit_link_id: string | null
}

/** A lightweight restore point (version-history stretch). Stores a full scene copy. */
export interface VersionSnapshot {
  rev: number
  at: number
  /** 'auto' = periodic autosnapshot; 'manual' = a named checkpoint (Ctrl/Cmd-S). */
  kind: 'auto' | 'manual'
  label?: string
  scene: SceneEnvelope
  thumbnail: string | null
}

/** The composed scene: every agent's slice in one place. */
export interface SceneEnvelope {
  /** Agent C — the whole house; embeds Agent A's RoomDesign at rooms[].interior. */
  house: House
  /** Agent E — lighting/time-of-day, keyed by room_id. null ⇒ E's built-in defaults. */
  lighting: LightingStateLike | null
}

/** The full saved design. This is exactly what a `.roomio` file contains. */
export interface RoomioDesign {
  /**
   * Envelope format version (string), for migration. Typed as a plain string
   * (not the literal) because the envelope is contractually forward-compatible:
   * a newer Roomio may write '2.0', and an older client must preserve that
   * version (and any unknown fields) rather than silently downgrade it.
   */
  schema_version: string
  design_id: string
  name: string
  createdAt: number
  updatedAt: number
  /** Monotonic save revision; increments on every successful save. Drives history. */
  rev: number
  /** Auto-generated PNG data-URL of the scene (so the library always looks current). */
  thumbnail: string | null
  scene: SceneEnvelope
  share: ShareState
  /** Optional lightweight restore points (stretch). Capped; oldest dropped first. */
  history?: VersionSnapshot[]
}

/** Lightweight card for the My Designs grid (no heavy scene payload). */
export interface DesignSummary {
  design_id: string
  name: string
  updatedAt: number
  createdAt: number
  rev: number
  thumbnail: string | null
  /** room count for the card subtitle ("3 rooms"). */
  roomCount: number
}

export function freshShareState(): ShareState {
  return { access: 'private', view_link_id: null, edit_link_id: null }
}

/** Project the heavy envelope down to a card summary for the library grid. */
export function toSummary(d: RoomioDesign): DesignSummary {
  return {
    design_id: d.design_id,
    name: d.name,
    updatedAt: d.updatedAt,
    createdAt: d.createdAt,
    rev: d.rev,
    thumbnail: d.thumbnail,
    roomCount: d.scene.house.rooms.length,
  }
}
