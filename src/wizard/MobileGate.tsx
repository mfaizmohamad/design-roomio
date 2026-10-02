// Small-screen gate for the 3D design stages (RESP-01). Below ~700px the editor's
// side panel + canvas + floating tool panels can't coexist (the canvas collapses to a
// ~90px sliver and controls land off-screen), so instead of silently breaking we show
// a branded "larger screen" gate — while the 2D screens (start, auth, listings) stay
// fully usable on phones.

import { useEffect, useState } from 'react'
import { useStore } from '../store'

/** The 3D editor needs at least this many CSS px of viewport width to be usable. */
export const MIN_DESIGN_WIDTH = 700

const QUERY = `(max-width: ${MIN_DESIGN_WIDTH - 1}px)`

/** True while the viewport is too narrow for the 3D design stages. Live — flips on
 *  resize/rotation so the editor appears the moment the window is big enough. */
export function useSmallScreen(): boolean {
  const [small, setSmall] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const onChange = (e: MediaQueryListEvent) => setSmall(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return small
}

export function MobileGate() {
  const setStage = useStore((s) => s.setStage)
  return (
    <div className="mobile-gate">
      <div className="mobile-gate-card">
        <div className="brand" style={{ marginBottom: 0 }}>
          <span className="dot" />
          Roomio
        </div>
        <div className="mobile-gate-art" aria-hidden="true">
          🛋️
        </div>
        <h1 className="mobile-gate-title">Roomio works best on a larger screen</h1>
        <p className="mobile-gate-copy">
          The 3D room designer needs more space than this screen can give it. Open Roomio on a
          laptop or a bigger tablet to design in 3D — your saved rooms will be waiting.
        </p>
        <p className="mobile-gate-meanwhile">Meanwhile, on this device you can</p>
        <div className="mobile-gate-actions">
          <button className="btn btn-primary" onClick={() => setStage('listings')}>
            Browse flat listings
          </button>
          <button className="btn btn-ghost" onClick={() => setStage('start')}>
            Back to your saved rooms
          </button>
        </div>
      </div>
    </div>
  )
}
