// Time-of-day section (Pillar 3). Scrubbing arcs the sun + sweeps shadows + shifts warmth.
// Rendered as a SECTION inside the single Lighting panel (no own card / positioning).

import { useLighting } from '../store'

function timeLabel(t: number): string {
  // 0 -> 06:00 (dawn), 0.5 -> 12:00 (noon), 1 -> 18:00 (dusk)
  const hours = 6 + t * 12
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function TimeBar({ hasWindows }: { hasWindows?: boolean }) {
  const timeOfDay = useLighting((s) => s.timeOfDay)
  const setTimeOfDay = useLighting((s) => s.setTimeOfDay)
  const sun = useLighting((s) => s.sun)
  const setSunEnabled = useLighting((s) => s.setSunEnabled)

  const phase =
    timeOfDay < 0.12 ? 'dawn' : timeOfDay > 0.88 ? 'dusk' : timeOfDay > 0.42 && timeOfDay < 0.58 ? 'noon' : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600 }}>🕑 {timeLabel(timeOfDay)}</span>
        <span style={{ opacity: 0.55 }}>{phase}</span>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={sun.enabled} onChange={(e) => setSunEnabled(e.target.checked)} />
          sun
        </label>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={timeOfDay}
        onChange={(e) => setTimeOfDay(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#ffb454' }}
        aria-label="Time of day"
      />
      {/* No-windows notice: sunlight can't reach a closed box, so tell the user how to see it. */}
      {sun.enabled && hasWindows === false && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '7px 9px',
            borderRadius: 8,
            background: 'rgba(255,180,84,0.14)',
            border: '1px solid rgba(255,180,84,0.35)',
            color: '#ffd9a0',
            lineHeight: 1.35,
          }}
        >
          <span>🪟</span>
          <span>
            This room has no windows, so sunlight can’t reach inside. Add a window in{' '}
            <strong>Step 3 (Doors &amp; windows)</strong> to see the sun cast light and shadows indoors.
          </span>
        </div>
      )}
    </div>
  )
}
