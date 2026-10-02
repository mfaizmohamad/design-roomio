// HeroRender (G5, optional stretch) — the ONE place real ray tracing belongs: a NON-real-time,
// progressive path-traced "beauty shot" that accumulates while the camera is held STATIC, and falls
// back to the rasterized real-time view the moment the camera moves. Never the interactive default.
//
// Render-loop ownership: this registers a priority>0 useFrame, which puts R3F in manual-render mode.
// While hero is active, RealismPost returns null (the EffectComposer unmounts), so ONLY the path
// tracer writes the canvas. While hero is inactive, the EffectComposer (also priority 1) renders and
// this useFrame no-ops. The path trace already does GI/AO/soft-shadows/emissive glow physically, so
// the raster post pipeline is correctly suspended during it (no double-darken/double-bloom).
//
// Uses three-gpu-pathtracer's WebGLPathTracer on the EXISTING renderer; reads scene.environment (G's
// IBL) for sky/ambient bounce; exports the converged still via the existing preserveDrawingBuffer canvas.

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import type { WebGLPathTracer } from 'three-gpu-pathtracer'
import { useRender } from '../store'
import { setHeroExporter } from './heroBus'

// The path tracer is HEAVY and only needed on demand, so it is code-split (dynamic import on first
// activation) — it never bloats the app's main bundle.

// Grace period before declaring the GPU unable to path-trace. The first renderSample includes a big
// shader compile + BVH build, so allow a generous window; overridable for diagnostics via a global.
function heroWatchdogMs(): number {
  // 25s: real GPUs land the first sample in <1s; software GL (SwiftShader) takes ~18s for the first
  // sample (shader compile + BVH build) then climbs — so 25s lets slow-but-working GPUs through and
  // only bails on a GPU that genuinely can't drive the tracer. Overridable for diagnostics.
  return (typeof window !== 'undefined' && (window as unknown as { __heroWatchdogMs?: number }).__heroWatchdogMs) || 25000
}

function matricesClose(a: THREE.Matrix4, b: THREE.Matrix4, eps = 1e-5): boolean {
  const ae = a.elements
  const be = b.elements
  let d = 0
  for (let i = 0; i < 16; i++) d += Math.abs(ae[i] - be[i])
  return d < eps
}

export function HeroRender() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const heroActive = useRender((s) => s.heroActive)
  const targetSamples = useRender((s) => s.settings.heroRender.samples)
  const bounces = useRender((s) => s.settings.heroRender.bounces)

  const tracerRef = useRef<WebGLPathTracer | null>(null)
  const camSnapshot = useRef(new THREE.Matrix4())
  const sessionRef = useRef(false) // setScene done for the current hero session?

  // Register the PNG exporter for the DOM controls (reads the converged canvas).
  useEffect(() => {
    setHeroExporter(() => {
      try {
        return gl.domElement.toDataURL('image/png')
      } catch {
        return null
      }
    })
    return () => setHeroExporter(null)
  }, [gl])

  // Dispose the tracer when the layer unmounts.
  useEffect(() => {
    return () => {
      tracerRef.current?.dispose()
      tracerRef.current = null
    }
  }, [])

  // Enter / leave hero mode.
  useEffect(() => {
    if (!heroActive) {
      sessionRef.current = false
      return
    }
    // Path tracing needs WebGL2 (+ float render targets). Otherwise stay on the raster view.
    if (!gl.capabilities.isWebGL2) {
      useRender.getState().setHeroSupported(false)
      useRender.getState().setHeroActive(false)
      return
    }
    useRender.getState().setHeroSupported(true)

    let cancelled = false
    let watchdog: ReturnType<typeof setTimeout> | undefined
    void (async () => {
      // Code-split: fetch the path tracer only on first activation.
      const { WebGLPathTracer } = await import('three-gpu-pathtracer')
      if (cancelled) return
      let tracer = tracerRef.current
      if (!tracer) {
        tracer = new WebGLPathTracer(gl)
        tracerRef.current = tracer
      }
      tracer.bounces = bounces
      tracer.renderToCanvas = true
      // Static-camera hero → accumulate at full resolution (no dynamic low-res proxy), so every
      // sample refines the same full-res image and it converges cleanly.
      tracer.dynamicLowRes = false
      // Heavy: builds the BVH + bakes materials/lights/env (scene.environment = G's IBL).
      tracer.setScene(scene, camera)
      camSnapshot.current.copy(camera.matrixWorld)
      useRender.getState().setHeroSamples(0)
      sessionRef.current = true

      // Watchdog: a GPU may report WebGL2 yet not actually drive the tracer's float targets (e.g.
      // software GL) — samples never advance. Don't hang on "Rendering… 0": fall back gracefully.
      watchdog = setTimeout(() => {
        if (useRender.getState().heroActive && useRender.getState().heroSamples === 0) {
          useRender.getState().setHeroSupported(false)
          useRender.getState().setHeroActive(false)
        }
      }, heroWatchdogMs())
    })()

    return () => {
      cancelled = true
      if (watchdog) clearTimeout(watchdog)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroActive])

  useFrame(() => {
    if (!heroActive || !sessionRef.current) return
    const tracer = tracerRef.current
    if (!tracer) return
    // Fall back to real-time raster the moment the camera moves.
    camera.updateMatrixWorld()
    if (!matricesClose(camera.matrixWorld, camSnapshot.current)) {
      useRender.getState().setHeroActive(false)
      return
    }
    if (tracer.samples < targetSamples) {
      tracer.renderSample()
      useRender.getState().setHeroSamples(Math.floor(tracer.samples))
    }
    // converged: stop sampling; the image persists on the canvas (preserveDrawingBuffer).
  }, 1)

  return null
}
