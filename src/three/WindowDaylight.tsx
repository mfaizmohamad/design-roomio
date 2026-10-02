// WindowDaylight (Agent G) — makes the WINDOW the light source when the lamps are off.
//
// The physically-correct model for "light comes in through the window" (see the offline-renderer
// "light portal" standard: Blender Cycles / Arnold / V-Ray / Corona all put an inward-facing light
// primitive on the window plane): for each real window aperture we place
//   1) a THREE.RectAreaLight sized to the opening, aimed INTO the room — the soft, area-shaped
//      "sky" fill that is brightest at the opening and falls off with distance (a RectAreaLight
//      casts no raster shadow, but it produces the directional bright-near/dim-far daylight
//      gradient on its own; the sun — left on by LightsSync — casts the actual hard window shaft
//      through the wall hole, and in the path-traced beauty shot BOTH the rect and the emissive
//      pane below are MIS-sampled physical emitters that cast real shafts).
//   2) a thin EMISSIVE "sky" pane at the aperture, tagged so MaterialEnhancer keeps it glowing
//      with the lamps off (it blooms into the bright window you see, and feeds the path tracer).
//
// Only rendered when the lamps are OFF, so the established lamps-on look is untouched. Windows are
// real holes in the walls (walls.ts buildWallParts), and the placement math mirrors Openings3D.
//
// Cross-island: reads the app store (openings/walls/frame) + Agent G's useRender.lightsOn, and
// reuses Agent G's <AreaLight>. RectAreaLightUniformsLib.init() is already called in <RealismLayer>.

import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useStore } from '../store'
import { useRender } from '../../rendering/src/store'
import { useLighting } from '../../lighting/src/store'
import { AreaLight } from '../../rendering/src/r3f/AreaLight'
import { makeFrame } from './coords'
import { pointOnWall } from '../geometry/walls'
import { sampleSun } from '../../lighting/src/sun'
import { getSkyBackdropTexture } from './envTextures'

// Cool overcast-daylight tint (~6500K) for the window sky.
const SKY_COLOR = '#cfe0ff'
const PANE_COLOR = '#eaf2ff'
// RectAreaLight strength AT FULL DAYLIGHT on a sun-facing window (legacy/non-physical units, matching
// E's rig + the harness window). Scaled per-window by `windowDaylight()` below so it tracks the sun's
// elevation (time of day) and the window's facing — a back-lit or dusk window is dim, not blazing.
const AREA_INTENSITY = 4.5
// FINAL emissive of the sky pane AT FULL DAYLIGHT (MaterialEnhancer no longer boosts window panes —
// it leaves this exactly as authored). The pane is textured with the SAME sky→horizon→greenery
// gradient the <WindowExterior> backdrop uses (see getSkyBackdropTexture), so the lamps-off window is
// a glowing VIEW WITH DETAIL — cool blue-white top, warmer/greener low — not a flat white slab. The
// gradient's own texels are <1, and the brightest band (hazy horizon) stays well under the 1.0 HDR
// bloom threshold at this intensity, so the pane reads bright-with-detail rather than blooming out.
// Scaled per-window below so the glass dims toward dusk / on the shaded side instead of always glowing.
const PANE_EMISSIVE = 0.98
// Pane slightly inset from the aperture so the painted window frame reads around the glow.
const PANE_INSET = 0.9

// How much daylight a window admits, in [0, ~1.2], as a function of the sun.
//   timeFactor  — sun elevation / time of day: 1 at noon, 0 at dawn/dusk/night (or sun disabled).
//   facing      — how head-on the sun hits THIS window (dot of the sun direction with the window's
//                 OUTWARD normal): 1 when the sun stares straight in, 0 when it's behind/parallel.
// A window always admits some diffuse SKY (SKY_BASE) during the day; a sun-facing one additionally
// gets the DIRECT beam (DIRECT·facing). Both vanish at night, so windows are never a constant source.
const SKY_BASE = 0.32
const DIRECT = 1.0
export function windowDaylight(timeFactor: number, facing: number): number {
  if (timeFactor <= 0) return 0
  return timeFactor * (SKY_BASE + DIRECT * Math.max(0, facing))
}

interface WindowLight {
  id: string
  /** RectAreaLight position: at the interior wall face. */
  lightPos: [number, number, number]
  /** world point the area light faces (further into the room, along the inward normal). */
  target: [number, number, number]
  /** emissive pane position: at the exterior wall face, behind the glass. */
  panePos: [number, number, number]
  /** Y-rotation that lays the pane flat in the wall plane (same convention as Openings3D). */
  paneRotY: number
  width: number
  height: number
  /** wall midpoint (world m) + inward normal — for the open-dollhouse camera-facing cull. */
  wallMid: [number, number]
  nx: number
  nz: number
}

export function WindowDaylight() {
  const openings = useStore((s) => s.design.openings)
  const walls = useStore((s) => s.walls)
  const corners = useStore((s) => s.design.corners)
  const wallThickness = useStore((s) => s.design.wallThickness)
  const lightsOn = useRender((s) => s.lightsOn)
  // Light Mode (E) is the sun-through-windows presentation, so it always drives the window daylight —
  // as does the plain lamps-off toggle (G).
  const lightMode = useLighting((s) => s.lightMode)
  // Sun state — window brightness must track the SUN (elevation/time + which way it faces), not be a
  // constant. Same inputs Sun.tsx uses, so the window daylight and the actual sun stay in lock-step.
  const timeOfDay = useLighting((s) => s.timeOfDay)
  const northOffsetDeg = useLighting((s) => s.northOffsetDeg)
  const sun = useLighting((s) => s.sun)

  const frame = useMemo(() => makeFrame(corners), [corners])
  // Same procedural sky→horizon→greenery gradient the exterior backdrop uses — mapped onto the
  // emissive pane so the lamps-off window glows as a detailed VIEW, not a featureless bright slab.
  const skyTex = getSkyBackdropTexture()

  // Sample the sun once per change: gives elevation-based intensity + its dome position (direction).
  const sunLight = useMemo(() => {
    const s = sampleSun(timeOfDay, {
      maxElevationDeg: sun.maxElevationDeg,
      northOffsetDeg,
      domeRadiusM: sun.domeRadiusM,
      warmthShift: sun.warmthShift,
    })
    // Daytime strength: 0 when the sun is switched off or below the horizon, else its elevation factor
    // (further scaled by the sun dimmer). This is what makes a dusk / sun-off window go dark.
    const timeFactor =
      sun.enabled && !s.belowHorizon ? s.intensityFactor * (sun.intensityScale ?? 1) : 0
    // Unit vector pointing TOWARD the sun (for per-window facing). Horizontal components are what a
    // vertical window "sees"; a high noon sun has a small horizontal component (little direct beam,
    // mostly diffuse sky), a low sun a large one (strong raking beam through whichever window faces it).
    const len = Math.hypot(...s.position) || 1
    const dir: [number, number, number] = [s.position[0] / len, s.position[1] / len, s.position[2] / len]
    return { timeFactor, dir, color: s.color }
  }, [timeOfDay, northOffsetDeg, sun.maxElevationDeg, sun.domeRadiusM, sun.warmthShift, sun.enabled, sun.intensityScale])

  const windows = useMemo<WindowLight[]>(() => {
    const half = wallThickness / 100 / 2 // half wall thickness, meters
    const out: WindowLight[] = []
    for (const o of openings) {
      if (o.kind !== 'window') continue
      const w = walls.find((ww) => ww.id === o.wallId)
      if (!w) continue
      const p = pointOnWall(w, o.t)
      const [wx, wz] = frame.toWorld(p.x, p.z)
      const cy = (o.sill + o.height / 2) / 100
      // w.nx/w.nz is the only reliably-INWARD normal (deriveWalls flips it toward the centroid,
      // robust on concave L/T/U plans). Do NOT derive facing from rotY.
      const nx = w.nx
      const nz = w.nz
      const [mx, mz] = frame.toWorld(w.midX, w.midZ)
      out.push({
        id: o.id,
        lightPos: [wx + nx * half, cy, wz + nz * half],
        target: [wx + nx * (half + 1), cy, wz + nz * (half + 1)],
        panePos: [wx - nx * half, cy, wz - nz * half],
        paneRotY: Math.atan2(-w.dirZ, w.dirX),
        width: o.width / 100,
        height: o.height / 100,
        wallMid: [mx, mz],
        nx,
        nz,
      })
    }
    return out
  }, [openings, walls, frame, wallThickness])

  // Open-dollhouse cull: hide a window's emissive pane when its wall faces AWAY from the camera
  // (matches Room.tsx's OpeningsLayer), so a pane never floats in the foreground once its wall is
  // culled. The RectAreaLight is left on so the room's illumination stays stable as the camera orbits.
  const paneGroup = useRef<THREE.Group>(null)
  useFrame((state) => {
    const g = paneGroup.current
    if (!g) return
    const vx = state.camera.position.x
    const vz = state.camera.position.z
    g.children.forEach((child, i) => {
      const wd = windows[i]
      if (!wd) return
      child.visible = wd.nx * (vx - wd.wallMid[0]) + wd.nz * (vz - wd.wallMid[1]) > -0.05
    })
  })

  // Scope to daylight-only presentations — Light Mode (sun-only) OR lamps-off: the window becomes the
  // light source only then, leaving the established lamps-on editing look untouched.
  const daylightOnly = lightMode || !lightsOn
  if (!daylightOnly || windows.length === 0) return null

  return (
    <>
      {/* Area lights — intensity scales with the sun (elevation × this window's facing), so a window
          only pours in light when the sun is actually up and shining toward it. */}
      {windows.map((wd) => {
        // Sun direction dotted with the window's OUTWARD normal (−inward): 1 = sun stares straight in.
        const facing = sunLight.dir[0] * -wd.nx + sunLight.dir[2] * -wd.nz
        const bright = windowDaylight(sunLight.timeFactor, facing)
        return (
          <AreaLight
            key={wd.id}
            position={wd.lightPos}
            target={wd.target}
            width={wd.width}
            height={wd.height}
            color={SKY_COLOR}
            intensity={AREA_INTENSITY * bright}
          />
        )
      })}
      {/* Emissive "sky" panes — brightness tracks the same per-window daylight, so the glass dims
          toward dusk and on the shaded side instead of always glowing. Camera-facing culled. */}
      <group ref={paneGroup}>
        {windows.map((wd) => {
          const facing = sunLight.dir[0] * -wd.nx + sunLight.dir[2] * -wd.nz
          const bright = windowDaylight(sunLight.timeFactor, facing)
          return (
            <mesh key={wd.id} position={wd.panePos} rotation={[0, wd.paneRotY, 0]}>
              <planeGeometry args={[wd.width * PANE_INSET, wd.height * PANE_INSET]} />
              <meshStandardMaterial
                map={skyTex}
                color={PANE_COLOR}
                emissive={'#ffffff'}
                emissiveMap={skyTex}
                // Emissive = gradient texel × white × intensity; texels<1 keep the brightest band under
                // the 1.0 bloom threshold. Small floor (0.08) so the glass never goes pure black, then
                // scales with daylight so the view dims toward dusk / on the shaded side.
                emissiveIntensity={PANE_EMISSIVE * Math.min(1, 0.08 + bright)}
                roughness={1}
                metalness={0}
                side={THREE.DoubleSide}
                userData={{ __roomioWindow: true }}
              />
            </mesh>
          )
        })}
      </group>
    </>
  )
}
