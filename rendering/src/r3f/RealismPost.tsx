// The post-processing pipeline — the EffectComposer that turns a flatly-rendered scene
// photographic. Mounts as a CHILD of the app's existing <Canvas shadows flat> (no Canvas-prop
// changes): `flat` keeps the renderer at NoToneMapping so this composer owns tone mapping exactly
// once (the v2 composer even force-sets NoToneMapping during its own render).
//
// Effect ORDER (top→bottom = render order):
//   1) N8AO        — ambient occlusion (soft contact darkening); off at "low", halfRes at medium.
//   2) Bloom       — selective glow on HDR-bright emitters only (luminanceThreshold ~1.0).
//   3) Exposure    — pre-tonemap linear exposure (G's compensation knob; doesn't touch E's lights).
//   4) ToneMapping — ACES_FILMIC, LAST. Maps linear HDR → filmic, outputs sRGB. No extra gamma pass.
//
// HalfFloat buffer (composer default) keeps everything linear-HDR until tone mapping, which is what
// makes the selective-bloom-by-luminance trick work. While a path-traced hero still accumulates,
// the whole composer is suspended (the tracer does GI/AO/soft-shadows/glow physically).
//
// PERF (from adversarial review): two churn/leak hazards are handled here —
//   • Exposure is driven IMPERATIVELY (callback ref + store subscription), NOT as a React prop, so
//     dragging the exposure slider never re-instantiates the effect or recompiles the EffectPass.
//   • The composer's GPU render targets are explicitly disposed when `multisampling` forces a rebuild
//     (and on unmount) — the @react-three/postprocessing v2 wrapper recreates but never disposes the
//     orphaned composer, which otherwise leaks VRAM on repeated quality toggles.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer, N8AO, Bloom, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useRender } from '../store'
import { Exposure, ExposureEffectImpl } from './ExposureEffect'

const N8AO_QUALITY = {
  high: 'high',
  medium: 'medium',
  low: 'low',
} as const

// Map the settings' string mode → the postprocessing enum. Neutral (Khronos PBR-Neutral) is the
// preset default: it keeps warm wood/window HUE and desaturates only the highlight roll-off, so
// finishes read true and daylight panes stop blowing to featureless white (ACES desaturates
// midtones and crushes highlights toward white). Unknown/future modes fall back to ACES_FILMIC.
const TONE_MAPPING_MODE: Record<string, ToneMappingMode> = {
  ACESFilmic: ToneMappingMode.ACES_FILMIC,
  AgX: ToneMappingMode.AGX,
  Neutral: ToneMappingMode.NEUTRAL,
  Reinhard: ToneMappingMode.REINHARD,
  None: ToneMappingMode.LINEAR,
}

export function RealismPost() {
  const heroActive = useRender((s) => s.heroActive)
  // STRUCTURAL selectors only — RealismPost must NOT re-render on exposure changes (which are driven
  // imperatively below), or the effects array + EffectPass chain rebuild on every slider tick.
  const aoEnabled = useRender((s) => s.settings.post.ao.enabled)
  const aoRadius = useRender((s) => s.settings.post.ao.radius)
  const aoIntensity = useRender((s) => s.settings.post.ao.intensity)
  const bloomEnabled = useRender((s) => s.settings.post.bloom.enabled)
  const bloomThreshold = useRender((s) => s.settings.post.bloom.threshold)
  const bloomStrength = useRender((s) => s.settings.post.bloom.strength)
  const bloomRadius = useRender((s) => s.settings.post.bloom.radius)
  const multisampling = useRender((s) => s.settings.post.multisampling)
  const quality = useRender((s) => s.settings.quality)
  // Tone-mapping mode is a STRUCTURAL selector (a string, changes rarely) — it belongs in the
  // effects useMemo so a mode switch rebuilds the ToneMapping effect. Exposure stays imperative.
  const toneMappingMode = useRender((s) => s.settings.toneMapping.mode)

  // Imperative exposure: callback ref seeds on (re)attach; a store subscription updates the uniform
  // in place — no React re-render, no effect rebuild.
  const exposureRef = useRef<ExposureEffectImpl | null>(null)
  const setExposureRef = useCallback((eff: ExposureEffectImpl | null) => {
    exposureRef.current = eff
    if (eff) eff.exposure = useRender.getState().settings.toneMapping.exposure
  }, [])
  useEffect(() => {
    const apply = () => {
      if (exposureRef.current) {
        exposureRef.current.exposure = useRender.getState().settings.toneMapping.exposure
      }
    }
    apply()
    return useRender.subscribe(apply)
  }, [])

  // Dispose the orphaned composer's GPU targets on rebuild (multisampling change) + unmount.
  const composerRef = useRef<{ dispose?: () => void } | null>(null)
  useEffect(() => {
    const c = composerRef.current
    return () => {
      c?.dispose?.()
    }
  }, [multisampling])

  // Effects rebuild ONLY on structural changes (which effects exist + their preset scalars).
  const effects = useMemo(() => {
    const arr: JSX.Element[] = []
    if (aoEnabled) {
      arr.push(
        <N8AO
          key="ao"
          aoRadius={aoRadius}
          intensity={aoIntensity}
          distanceFalloff={1}
          quality={N8AO_QUALITY[quality]}
          halfRes={quality !== 'high'}
        />,
      )
    }
    if (bloomEnabled) {
      arr.push(
        <Bloom
          key="bloom"
          mipmapBlur
          intensity={bloomStrength}
          luminanceThreshold={bloomThreshold}
          luminanceSmoothing={0.15}
          radius={bloomRadius}
        />,
      )
    }
    // wrapEffect types the ref as the class, but R3F forwards the instance at runtime — cast.
    arr.push(<Exposure key="exposure" ref={setExposureRef as never} />)
    arr.push(
      <ToneMapping
        key="tonemap"
        mode={TONE_MAPPING_MODE[toneMappingMode] ?? ToneMappingMode.ACES_FILMIC}
      />,
    )
    return arr
  }, [aoEnabled, aoRadius, aoIntensity, bloomEnabled, bloomThreshold, bloomStrength, bloomRadius, quality, toneMappingMode, setExposureRef])

  // Suspend the raster post pipeline while the path tracer renders (avoid double-process).
  if (heroActive) return null

  return (
    <EffectComposer
      ref={composerRef as never}
      multisampling={multisampling}
      frameBufferType={THREE.HalfFloatType}
      enableNormalPass={false}
    >
      {effects}
    </EffectComposer>
  )
}
