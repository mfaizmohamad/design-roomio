import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Scene } from './Scene'
import { LightingControls } from '../ui/LightingControls'
import { useLighting } from '../store'

// Expose the store for the headless verify script (harness only).
;(window as unknown as { __lighting: typeof useLighting }).__lighting = useLighting

const params = new URLSearchParams(window.location.search)
const MULTI = params.has('multi')
const ROOF = params.has('roof')
const LOWCAM = params.has('lowcam') // place the camera below the ceiling to reveal the roof
const ROOM_B_X = 4.2 // matches Scene.ROOM_B_OFFSET_X

function App() {
  // Every room gets sensible default lights the moment it exists (Pillar 1 / L-1).
  useEffect(() => {
    const s = useLighting.getState()
    s.ensureRoom({ id: 'r_demo', centerM: [0, 0], wallHeightM: 2.7 })
    if (MULTI) s.ensureRoom({ id: 'r_demo_b', centerM: [ROOM_B_X, 0], wallHeightM: 2.7 })
    // Default the controls on so the harness shows them; the app would default bar/north off.
    s.toggleBar(true)
    s.toggleNorth(true)
  }, [])

  const camera = MULTI
    ? { position: [7.5, 5.2, 7.5] as [number, number, number], fov: 42, near: 0.1, far: 200 }
    : LOWCAM
      ? { position: [2.6, 1.2, 3.2] as [number, number, number], fov: 55, near: 0.1, far: 200 }
      : { position: [4.2, 3.4, 5.2] as [number, number, number], fov: 40, near: 0.1, far: 200 }
  const target: [number, number, number] = MULTI ? [ROOM_B_X / 2, 0.8, 0] : LOWCAM ? [0, 2.2, -0.5] : [0, 0.8, 0]

  return (
    <>
      <Canvas shadows flat dpr={[1, 2]} gl={{ antialias: true, preserveDrawingBuffer: true }} camera={camera}>
        <color attach="background" args={['#cdccc9']} />
        <Scene multi={MULTI} roof={ROOF} />
        <OrbitControls makeDefault target={target} enableDamping maxPolarAngle={LOWCAM ? Math.PI : Math.PI / 2.05} />
      </Canvas>
      <LightingControls />
      <EditingHint />
    </>
  )
}

/**
 * Stand-in for A's bottom "drag/rotate/resize" furniture hint (src/wizard/Furnish.tsx).
 * Hidden in Light Mode — mirrors what A wires via showEditingHints(lightMode).
 */
function EditingHint() {
  const lightMode = useLighting((s) => s.lightMode)
  if (lightMode) return null
  return (
    <p
      className="hint"
      style={{
        position: 'fixed',
        bottom: 96,
        left: '50%',
        transform: 'translateX(-50%)',
        margin: 0,
        padding: '8px 16px',
        borderRadius: 10,
        background: 'rgba(20,22,26,0.6)',
        color: '#e8e3d8',
        font: '13px ui-sans-serif, system-ui, sans-serif',
        zIndex: 9,
        maxWidth: 520,
        textAlign: 'center',
      }}
    >
      Click a piece to add it, then drag, rotate, resize and recolor it. Furniture snaps to walls
      and won't pass through them.
    </p>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
