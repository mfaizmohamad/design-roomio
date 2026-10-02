// WebGL context-loss handling for the 3D stage (CODE-05).
//
// three.js already re-initialises the scene when the browser fires
// `webglcontextrestored`, so the common GPU-reset case recovers by itself —
// but during the loss window (and in the rare case the browser never restores
// the context) the viewport is a silent black rectangle. This overlay tells
// the user what happened and offers a "Restart 3D view" (Canvas remount) and
// a full page reload.

import { useEffect, type CSSProperties } from 'react'
import { useThree } from '@react-three/fiber'
import { create } from 'zustand'

export const useWebglContext = create<{ lost: boolean }>(() => ({ lost: false }))

/** Mount INSIDE the <Canvas>: listens on the canvas element's context events. */
export function ContextLossWatcher() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const onLost = (e: Event) => {
      // preventDefault tells the browser we want a webglcontextrestored event.
      e.preventDefault()
      useWebglContext.setState({ lost: true })
    }
    const onRestored = () => useWebglContext.setState({ lost: false })
    el.addEventListener('webglcontextlost', onLost, false)
    el.addEventListener('webglcontextrestored', onRestored, false)
    return () => {
      el.removeEventListener('webglcontextlost', onLost)
      el.removeEventListener('webglcontextrestored', onRestored)
    }
  }, [gl])
  return null
}

const overlay: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(30, 29, 27, 0.55)',
  backdropFilter: 'blur(2px)',
  zIndex: 20,
  fontFamily: 'var(--font, ui-sans-serif, system-ui, sans-serif)',
  padding: 24,
}

const card: CSSProperties = {
  width: 400,
  maxWidth: '92%',
  background: '#fff',
  borderRadius: 18,
  padding: '30px 30px 26px',
  boxShadow: '0 18px 48px rgba(0, 0, 0, 0.3)',
  textAlign: 'center',
}

/** Mount OUTSIDE the <Canvas> (same positioned parent). `onRestart` should
 *  remount the Canvas — a fresh canvas element gets a fresh WebGL context. */
export function ContextLossOverlay({ onRestart }: { onRestart: () => void }) {
  const lost = useWebglContext((s) => s.lost)
  if (!lost) return null
  return (
    <div style={overlay} role="alert" data-testid="webgl-lost-overlay">
      <div style={card}>
        <div style={{ fontSize: 30, marginBottom: 10 }} aria-hidden>
          🎛️
        </div>
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.01em', marginBottom: 8 }}>
          3D view paused
        </div>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-2, #56544f)', margin: '0 0 18px' }}>
          The graphics context was lost — this can happen after a GPU reset or heavy load.
          It usually comes back on its own; if not, restart the 3D view. Your design is safe.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="btn btn-primary" style={{ flex: '1 1 auto' }} onClick={onRestart}>
            Restart 3D view
          </button>
          <button className="btn btn-ghost" style={{ flex: 'none' }} onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      </div>
    </div>
  )
}
