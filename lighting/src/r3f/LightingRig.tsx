// LightingRig — the single drop-in that replaces A's local <Lights> inside the <Canvas>.
// Renders: ONE global ambient fill (hemisphere + low ambient) so nothing is pitch black
// and shadows aren't pure black; per-room task/accent lights; and the sun.
//
// Ambient is intentionally GLOBAL (not stacked per-room) so a multi-room house doesn't
// over-brighten or pay for N hemisphere lights. Per-room ambient entries still exist in
// the state (for editability + A's layered-lighting predicate); the rig uses a
// representative one for the scene fill.

import { useLighting } from '../store'
import { Sun } from './Sun'
import { RoomLights } from './RoomLights'

export interface LightingRigProps {
  /** half-extent of the whole house in meters (for the sun's shadow frustum). */
  houseHalfExtentM: number
  /** renderer-tuned base sun intensity at noon (legacy units). */
  baseIntensity?: number
  /**
   * When set, render ONLY this room's lights (the app edits one room at a time, all
   * centered at the origin — so rendering every room's lights would stack them and
   * over-brighten as rooms are added). Omit for the multi-room house model where each
   * room sits at its own footprint.
   */
  activeRoomId?: string
}

export function LightingRig({ houseHalfExtentM, baseIntensity, activeRoomId }: LightingRigProps) {
  const rooms = useLighting((s) => s.rooms)
  // Global flat-fill multiplier — G drives this down for "lamps off → daylight only" so the room
  // falls into shadow from the window instead of the always-on fill keeping it uniformly lit.
  const fillScale = useLighting((s) => s.fillScale)

  const entries =
    activeRoomId != null
      ? rooms[activeRoomId]
        ? ([[activeRoomId, rooms[activeRoomId]]] as const)
        : []
      : (Object.entries(rooms) as [string, (typeof rooms)[string]][])

  const ambientLights = entries
    .flatMap(([, r]) => r.lights)
    .filter((l) => l.layer === 'ambient' && l.enabled !== false && l.intensity > 0)

  const fill = ambientLights[0]
  const skyColor = fill?.color ?? '#ffffff'
  const groundColor = fill?.groundColor ?? '#cfcbc2'
  const hemiIntensity = fill?.intensity ?? 0.85

  return (
    <>
      {/* Global ambient fill so no surface is pure black (pairs with the sun's shadows).
          Sized so a roofed/sun-blocked interior is still comfortably lit, never a dark box. */}
      <hemisphereLight color={skyColor} groundColor={groundColor} intensity={hemiIntensity * fillScale} />
      <ambientLight intensity={0.32 * fillScale} />

      {/* Per-room task/accent lights (only the active room in single-room mode). */}
      {entries.map(([id, r]) => (
        <RoomLights key={id} lights={r.lights} />
      ))}

      {/* The sun. */}
      <Sun houseHalfExtentM={houseHalfExtentM} baseIntensity={baseIntensity} />
    </>
  )
}
