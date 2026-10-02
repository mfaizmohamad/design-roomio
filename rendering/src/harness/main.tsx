// Standalone harness entry — renders the furnished room with the RealismLayer + the app-facing
// <RenderControls> panel, and exposes window.__rendering for headless verify (mirrors lighting's
// window.__lighting). The realism on/off toggle is harness-only (flat baseline vs realism, for
// side-by-side proof).
//
// URL params: ?flat (start on the flat baseline), ?q=high|medium|low (start quality).

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { HarnessScene } from './Scene'
import { FurnitureProbe } from './FurnitureProbe'
import { RealismLayer } from '../r3f/RealismLayer'
import { RenderControls } from '../ui/RenderControls'
import { useRender } from '../store'
import type { RenderQuality } from '../types'

const params = new URLSearchParams(location.search)
const startFlat = params.get('flat') != null
const startQuality = (params.get('q') as RenderQuality | null) ?? 'high'
const probe = params.get('probe') === 'furniture' // render A's real furniture for new-furniture QA

function btn(active: boolean): CSSProperties {
  return {
    padding: '7px 12px',
    borderRadius: 8,
    border: '1px solid rgba(0,0,0,0.15)',
    background: active ? '#111' : '#fff',
    color: active ? '#fff' : '#23211e',
    font: '12px ui-sans-serif, system-ui, sans-serif',
    fontWeight: 700,
    cursor: 'pointer',
  }
}

function App() {
  const [realism, setRealism] = useState(!startFlat)
  const lightsOn = useRender((s) => s.lightsOn)
  const quality = useRender((s) => s.settings.quality)
  const realismRef = useRef(realism)
  realismRef.current = realism

  // Apply the starting quality once.
  useEffect(() => {
    useRender.getState().setQuality(startQuality)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Expose a headless-verify API + the store.
  useEffect(() => {
    ;(window as unknown as { __rendering: unknown }).__rendering = {
      store: useRender,
      setRealism,
      getRealism: () => realismRef.current,
      setLights: (b: boolean) => useRender.getState().setLightsOn(b),
      getLights: () => useRender.getState().lightsOn,
      setQuality: (q: RenderQuality) => useRender.getState().setQuality(q),
      setExposure: (e: number) => useRender.getState().setExposure(e),
      setEnvIntensity: (i: number) => useRender.getState().setEnvIntensity(i),
    }
  }, [])

  return (
    <>
      <Canvas
        shadows
        flat
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={{ position: probe ? [1.6, 1.4, 2.6] : [4.2, 3.0, 4.6], fov: 40, near: 0.1, far: 200 }}
      >
        <color attach="background" args={['#cdccc9']} />
        {probe ? <FurnitureProbe /> : <HarnessScene lightsOn={lightsOn} />}
        <RealismLayer enabled={realism} />
        <OrbitControls
          makeDefault
          target={probe ? [0, 0.45, 0] : [0, 0.7, 0]}
          enableDamping
          dampingFactor={0.13}
          maxPolarAngle={Math.PI / 2.05}
        />
      </Canvas>

      {/* harness-only: flat baseline vs realism comparison toggle + status */}
      <div style={{ position: 'fixed', top: 12, left: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button style={btn(realism)} onClick={() => setRealism((r) => !r)}>
          {realism ? '✨ Realism ON' : '▢ Flat baseline'}
        </button>
        <button style={btn(lightsOn)} onClick={() => useRender.getState().toggleLights()} title="Toggle lights — light + glow change together">
          {lightsOn ? '💡 Lights on' : '🌙 Lights off'}
        </button>
        <span
          style={{
            font: '11px ui-monospace, monospace',
            color: '#444',
            background: 'rgba(255,255,255,0.7)',
            padding: '3px 6px',
            borderRadius: 6,
          }}
        >
          {realism ? `PBR·IBL·ACES·AO·Bloom (${quality})` : 'flat / NoToneMapping'}
        </span>
      </div>

      {/* the app-facing render panel (also exercised here) — hidden in probe mode for a clear view */}
      {!probe && <RenderControls />}
    </>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
