import { useStore } from '../store'
import { PRESETS } from '../geometry/presets'

export function Step1Shape() {
  const shape = useStore((s) => s.design.shape)
  const setShape = useStore((s) => s.setShape)
  return (
    <div>
      <div className="preset-grid">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className={`preset${shape === p.id ? ' active' : ''}`}
            onClick={() => setShape(p.id)}
          >
            <span className="preset-icon">
              <svg viewBox="0 0 100 80">
                <path d={p.icon} />
              </svg>
            </span>
            <span className="preset-label">{p.label}</span>
          </button>
        ))}
      </div>
      <p className="hint">
        Pick a footprint to start. You'll fine-tune the exact wall lengths in the next step.
      </p>
    </div>
  )
}
