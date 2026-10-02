/**
 * Agent H harness — interactive demo of the photo→texture pipeline (brief §8 acceptance):
 * pick a piece → "from a photo" → crop+seamless+de-lit PBR maps applied to its fabric/wood
 * slot, responding to room lighting → adjust tiling scale + rotation → accept → revert.
 * Lights mirror A's baseline (LEARNINGS) so the material reads under real lighting.
 */
import { useEffect, type CSSProperties } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Sofa, Table, Tub } from './Furniture'
import { useTextureStore } from './textureStore'

function Lights() {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#cfcbc2', 1.05]} />
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[7, 13, 8]}
        intensity={1.35}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={0.5}
        shadow-camera-far={48}
        shadow-bias={-0.0004}
      />
    </>
  )
}

function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[12, 12]} />
      <meshStandardMaterial color="#d9d6cf" roughness={0.95} />
    </mesh>
  )
}

function Scene() {
  return (
    <Canvas
      shadows
      flat
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      camera={{ position: [2.6, 1.9, 3.2], fov: 42, near: 0.1, far: 200 }}
    >
      <color attach="background" args={['#cdccc9']} />
      <Lights />
      <Floor />
      <Sofa position={[-1.45, 0, -0.3]} />
      <Table position={[1.7, 0, -0.5]} />
      <Tub position={[0.4, 0, 1.7]} />
      <OrbitControls makeDefault target={[0, 0.4, 0.3]} />
    </Canvas>
  )
}

function btn(active = false): CSSProperties {
  return {
    padding: '7px 11px',
    border: '1px solid #b9b4a8',
    borderRadius: 7,
    background: active ? '#2c2f33' : '#fff',
    color: active ? '#fff' : '#222',
    cursor: 'pointer',
    fontSize: 13,
  }
}

function Panel() {
  const s = useTextureStore()
  const mode = s.mode[s.target]
  // expose an imperative API for headless verify
  useEffect(() => {
    ;(window as any).__tex = {
      apply: (k: 'fabric' | 'wood') => useTextureStore.getState().applyFromPhoto(k),
      accept: () => useTextureStore.getState().accept(),
      revert: () => useTextureStore.getState().revert(),
      setTarget: (t: 'sofa' | 'table') => useTextureStore.getState().setTarget(t),
      setRepeatCm: (n: number) => useTextureStore.getState().setRepeatCm(n),
      state: () => {
        const st = useTextureStore.getState()
        return {
          target: st.target,
          mode: st.mode[st.target],
          targeted: st.lastTargeted,
          repeatCm: st.repeatCm,
          repeatX: st.lastRepeatX,
          triplanar: st.lastTriplanar,
        }
      },
    }
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        left: 16,
        width: 270,
        padding: 14,
        borderRadius: 12,
        background: 'rgba(255,255,255,0.94)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 2 }}>🪡 Texture from a photo</div>
      <div style={{ color: '#666', fontSize: 12, marginBottom: 10 }}>Agent H · suggestion → preview → accept → revert</div>

      <div style={{ fontSize: 12, color: '#444', marginBottom: 4 }}>Piece</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <button style={btn(s.target === 'sofa')} onClick={() => s.setTarget('sofa')}>3-seater sofa</button>
        <button style={btn(s.target === 'table')} onClick={() => s.setTarget('table')}>Table</button>
        <button style={btn(s.target === 'tub')} onClick={() => s.setTarget('tub')}>Tub (triplanar)</button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button style={btn()} onClick={() => s.applyFromPhoto('fabric')}>Fabric photo →</button>
        <button style={btn()} onClick={() => s.applyFromPhoto('wood')}>Wood photo →</button>
      </div>

      <div style={{ fontSize: 12, color: '#444' }}>
        Tiling density (cm/tile): <b>{s.repeatCm}</b>
      </div>
      <input type="range" min={10} max={120} value={s.repeatCm} onChange={(e) => s.setRepeatCm(+e.target.value)} style={{ width: '100%' }} />
      <div style={{ fontSize: 12, color: '#444' }}>
        Rotation: <b>{s.rotationDeg}°</b>
      </div>
      <input type="range" min={0} max={180} value={s.rotationDeg} onChange={(e) => s.setRotationDeg(+e.target.value)} style={{ width: '100%' }} />

      <div style={{ display: 'flex', gap: 6, margin: '10px 0 6px' }}>
        <button style={btn()} disabled={mode === 'default'} onClick={() => s.accept()}>✓ Accept</button>
        <button style={btn()} disabled={mode === 'default'} onClick={() => s.revert()}>↩ Revert to default</button>
      </div>
      <div style={{ fontSize: 12, color: '#666' }}>
        Status: <b>{mode}</b>
        {mode !== 'default' ? ` · ${s.lastTargeted} mesh${s.lastTargeted === 1 ? '' : 'es'} textured` : ''}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Scene />
      <Panel />
    </div>
  )
}
