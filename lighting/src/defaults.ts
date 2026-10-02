// Default room lighting: every room gets a sensible, editable, LAYERED setup the
// moment it exists (never a dark box). Pure — produces Light[] from room geometry.

import type { Light, RoomLighting } from './types'
import { warmthToHex } from './colorTemp'

export interface RoomLightInput {
  /** room id (RoomDesign.id or House room_id). */
  id: string
  /** room center in WORLD METERS [x,z]. */
  centerM: [number, number]
  /** wall height in METERS (used to hang the ceiling light). */
  wallHeightM: number
  /** include an accent layer (wall wash) for full three-layer coverage. */
  withAccent?: boolean
  /** longest room half-extent in meters (to place an accent wash); optional. */
  halfSpanM?: number
}

/**
 * Build the default layered lights for a room:
 *  - ambient: HemisphereLight fill (sky + ground) so nothing is pitch black.
 *  - task:    one warm ceiling light at room center near the ceiling.
 *  - accent:  (optional) a soft wall-wash for depth.
 *
 * Satisfies the three-layer model and passes A's "needs layered lighting" rule
 * (>=1 task AND an ambient fill). Room lights default to NON-shadow-casting; the
 * sun is the primary shadow caster (performance discipline).
 */
export function createDefaultRoomLights(room: RoomLightInput): Light[] {
  const [cx, cz] = room.centerM
  const ceilingY = Math.max(0.2, room.wallHeightM - 0.1)

  const lights: Light[] = [
    {
      id: `${room.id}__amb_fill`,
      type: 'hemisphere',
      layer: 'ambient',
      color: '#ffffff',
      groundColor: '#cfcbc2',
      intensity: 0.85,
      isDefault: true,
      enabled: true,
    },
    {
      id: `${room.id}__ceil_1`,
      type: 'ceiling',
      layer: 'task',
      warmth: 'warm',
      colorTempK: 2700,
      color: warmthToHex('warm'),
      intensity: 0.95,
      castShadow: false,
      isDefault: true,
      enabled: true,
      pos: [cx, ceilingY, cz],
    },
  ]

  if (room.withAccent) {
    const span = room.halfSpanM ?? 1.5
    lights.push({
      id: `${room.id}__accent_1`,
      type: 'wall_wash',
      layer: 'accent',
      warmth: 'warm',
      colorTempK: 3000,
      color: warmthToHex('warm'),
      intensity: 0.35,
      castShadow: false,
      isDefault: true,
      enabled: true,
      pos: [cx, ceilingY * 0.75, cz - span * 0.85],
      target: [cx, 0, cz - span],
    })
  }

  return lights
}

export function createDefaultRoomLighting(room: RoomLightInput): RoomLighting {
  return { lights: createDefaultRoomLights(room) }
}

/** Re-tint all warm/cool-preset lights in a room (the warm/cool UI toggle). */
export function applyWarmth(lights: Light[], warmth: 'warm' | 'neutral' | 'cool'): Light[] {
  return lights.map((l) =>
    l.layer === 'ambient' ? l : { ...l, warmth, color: warmthToHex(warmth) },
  )
}
