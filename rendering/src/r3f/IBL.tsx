// Image-based lighting (IBL): a procedural neutral-interior environment baked into
// scene.environment via drei <Environment> + <Lightformer> children — NO external/CDN file,
// so it works offline, headless (verify), and in-app. This gives all PBR (MeshStandard/Physical)
// materials soft ambient bounce + real reflections — the single biggest "it looks like a real
// room" lever.
//
// Strength is a single dial: environmentIntensity = ibl.intensity (scene.environmentIntensity).
// per-material envMapIntensity stays 1.0 (MaterialEnhancer) so the two don't double-scale.
//
// SEAM WITH E: scene.environment ADDS image-based ambient on top of E's hemisphere+ambient fill.
// To avoid double-ambient blowout we keep intensity modest by default (0.55) and DO NOT set the
// scene background (background={false}) — E/A own <color attach="background">. The ideal end-state
// (E reduces the flat fill, IBL provides the ambient) is a co-tune REQUEST to E; until then this
// complements rather than replaces.

import { Environment, Lightformer } from '@react-three/drei'
import { useRender } from '../store'

export function IBL() {
  const baseIntensity = useRender((s) => s.settings.ibl.intensity)
  const lightsOn = useRender((s) => s.lightsOn)
  // "Lamps off" is now DAYLIGHT-ONLY mode: rather than crushing the ambient to a dim WARM residual
  // (which read as leftover electric fill), keep a modest COOL "sky bounce" so shadow cores read
  // cool-neutral (the warm-sun / cool-shadow chiaroscuro of real window light) and undersides
  // aren't pure black — while the window area light + sun provide the direction. Kept modest so it
  // doesn't flatten the fall-into-shadow gradient. The user's slider value is preserved (runtime factor).
  const daylight = !lightsOn
  const intensity = daylight ? baseIntensity * 0.5 : baseIntensity

  // Warm interior fill when the lamps are on; cool overcast-sky fill when they're off.
  const bg = daylight ? '#2b3040' : '#3b3b42'
  const ceil = daylight ? '#dbe6ff' : '#fff3e2'
  const leftFill = daylight ? '#cdddff' : '#ffe9cf'
  const rightFill = daylight ? '#dfe7ff' : '#dfe7ff'
  const floorFill = daylight ? '#cdd6e6' : '#e8e2d6'

  return (
    <Environment frames={1} resolution={256} background={false} environmentIntensity={intensity}>
      {/* base ambient tone of the env cube (the env's own "sky", NOT the scene background) */}
      <color attach="background" args={[bg]} />

      {/* dominant soft ceiling fill — the overhead bounce that reads as room light from above */}
      <Lightformer
        form="rect"
        intensity={daylight ? 1.1 : 1.6}
        color={ceil}
        scale={[14, 10, 1]}
        position={[0, 7, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      />
      {/* two side fills — gentle directional reflection + wall bounce */}
      <Lightformer
        form="rect"
        intensity={0.85}
        color={leftFill}
        scale={[9, 6, 1]}
        position={[-7, 2.5, 0]}
        rotation={[0, Math.PI / 2, 0]}
      />
      <Lightformer
        form="rect"
        intensity={0.7}
        color={rightFill}
        scale={[9, 6, 1]}
        position={[7, 2.5, 0]}
        rotation={[0, -Math.PI / 2, 0]}
      />
      {/* dim floor bounce so undersides aren't pure black */}
      <Lightformer
        form="rect"
        intensity={0.28}
        color={floorFill}
        scale={[14, 10, 1]}
        position={[0, -3.5, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      />
    </Environment>
  )
}
