// RealismLayer — the SINGLE drop-in. Mount it as a child of the app's existing <Canvas>
// (alongside E's <LightingRig>) and the scene becomes photographic:
//   <IBL/>             image-based lighting → scene.environment (ambient bounce + reflections)
//   <MaterialEnhancer/> runtime PBR upgrade of existing materials (envMapIntensity + emissive boost)
//   <RealismPost/>     EffectComposer: N8AO + selective Bloom + Exposure + ACESFilmic tone mapping
//
// NO Canvas-prop changes are needed (the `flat` Canvas is exactly the right base). E owns the
// lights + shadows; this owns how they look. `enabled={false}` renders nothing — the flat baseline,
// for side-by-side comparison.

import { useMemo } from 'react'
import { RectAreaLightUniformsLib } from 'three-stdlib'
import { IBL } from './IBL'
import { MaterialEnhancer } from './MaterialEnhancer'
import { RealismPost } from './RealismPost'
import { HeroRender } from './HeroRender'
import { LightsSync } from './LightsSync'

export interface RealismLayerProps {
  enabled?: boolean
}

export function RealismLayer({ enabled = true }: RealismLayerProps) {
  // RectAreaLight uniforms must be initialized exactly once, before any area light renders
  // (area-light window/panel fills land in G3). useMemo runs during render → before children paint.
  useMemo(() => RectAreaLightUniformsLib.init(), [])

  if (!enabled) return null

  return (
    <>
      <IBL />
      <MaterialEnhancer />
      <LightsSync />
      <RealismPost />
      <HeroRender />
    </>
  )
}
