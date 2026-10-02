import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { FlythroughController } from '../../camera-flythrough/src/engine/FlythroughController'

/** Touch-first device: no mouse to pointer-lock and usually no keyboard. */
const isCoarsePointer = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches

const PAD: Array<{ code: string; label: string; area: string }> = [
  { code: 'KeyW', label: 'Forward', area: 'up' },
  { code: 'KeyA', label: 'Left', area: 'left' },
  { code: 'KeyD', label: 'Right', area: 'right' },
  { code: 'KeyS', label: 'Back', area: 'down' },
]
const ARROWS: Record<string, string> = { up: '▲', left: '◀', right: '▶', down: '▼' }

/**
 * Overlay shown over the 3D stage during a walkthrough: an Exit button, and either
 * keyboard/mouse hints (desktop) or a hold-to-move pad plus a drag-to-look layer
 * (touch). Desktop look-around is the engine's own pointer lock: SceneBridge locks
 * the mouse on a canvas click.
 */
export function WalkOverlay({ controller, onExit }: { controller: FlythroughController; onExit: () => void }) {
  const [touch] = useState(isCoarsePointer)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)

  // A held pad button whose pointerup never arrives (finger slid off, tab hidden)
  // would keep walking forever — release every key when the overlay goes away.
  useEffect(() => () => PAD.forEach((k) => controller.setWalkKey(k.code, false)), [controller])

  const onLookDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onLookMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    controller.walkLook(e.clientX - d.x, e.clientY - d.y)
    d.x = e.clientX
    d.y = e.clientY
  }
  const onLookEnd = () => {
    drag.current = null
  }

  return (
    <div className="walk-overlay">
      {touch && (
        <div
          className="walk-look"
          aria-hidden="true"
          onPointerDown={onLookDown}
          onPointerMove={onLookMove}
          onPointerUp={onLookEnd}
          onPointerCancel={onLookEnd}
        />
      )}
      <button className="walk-exit" onClick={onExit}>✕ Exit walk</button>
      {touch ? (
        <>
          <div className="walk-pad" role="group" aria-label="Move">
            {PAD.map((k) => {
              const press = (down: boolean) => controller.setWalkKey(k.code, down)
              return (
                <button
                  key={k.code}
                  className={`walk-pad-${k.area}`}
                  aria-label={k.label}
                  onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); press(true) }}
                  onPointerUp={() => press(false)}
                  onPointerCancel={() => press(false)}
                  onLostPointerCapture={() => press(false)}
                  onContextMenu={(e) => e.preventDefault()}
                >{ARROWS[k.area]}</button>
              )
            })}
          </div>
          <p className="walk-hint">Drag to look around · hold the arrows to walk</p>
        </>
      ) : (
        <p className="walk-hint">
          <b>Click the view</b> to look around · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys to walk · <kbd>Esc</kbd> frees the mouse
        </p>
      )}
    </div>
  )
}
