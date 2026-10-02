// Lighting controls entry point. CLOSED by default: only a compact "💡 Light Mode" launcher
// shows. Clicking it enters Light Mode and opens the full controls panel (Time of day, Sun &
// North, Room lights). Clicking again closes it. The scene stays lit either way — only the
// controls are hidden when closed.

import { useLighting } from '../store'
import { TimeBar } from './TimeBar'
import { NorthIndicator } from './NorthIndicator'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 10 }}>
      <div style={{ fontWeight: 600, opacity: 0.85, marginBottom: 8, letterSpacing: 0.2 }}>{title}</div>
      {children}
    </div>
  )
}

export function LightingControls({
  hasWindows,
  anchorRightPx = 12,
}: {
  /** whether ANY room in the house has a window. Light Mode traces sunlight coming through windows,
   *  so with no windows there is nothing to trace — the launcher is disabled and can't be entered. */
  hasWindows?: boolean
  /** right offset (px) so the launcher/panel can clear other app chrome. */
  anchorRightPx?: number
}) {
  const lightMode = useLighting((s) => s.lightMode)
  const toggleLightMode = useLighting((s) => s.toggleLightMode)

  // CLOSED (default): just a compact launcher button. Controls are hidden.
  if (!lightMode) {
    const disabled = !hasWindows
    return (
      <>
        <button
          onClick={() => {
            if (!disabled) toggleLightMode(true)
          }}
          disabled={disabled}
          data-testid="light-mode-launch"
          title={
            disabled
              ? 'Add a window first — Sun Mode traces the sunlight coming through your windows'
              : 'Sun Mode: trace the sunlight through your windows (locks furniture so you can focus on light)'
          }
          style={{
            position: 'fixed',
            top: 12,
            right: anchorRightPx,
            zIndex: 10,
            padding: '8px 14px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.22)',
            background: 'rgba(22,24,28,0.86)',
            color: '#f4f1ea',
            font: '12px ui-sans-serif, system-ui, sans-serif',
            fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.45 : 1,
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.22)',
          }}
        >
          ☀ Sun Mode
        </button>
        {/* Say WHY it's disabled — Sun Mode has nothing to trace with no window — and where to fix it. */}
        {disabled && (
          <div
            data-testid="sun-mode-blocked"
            style={{
              position: 'fixed',
              top: 48,
              right: anchorRightPx,
              zIndex: 10,
              maxWidth: 208,
              font: '11px ui-sans-serif, system-ui, sans-serif',
              lineHeight: 1.4,
              color: '#ffdca8',
              background: 'rgba(22,24,28,0.82)',
              border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: 9,
              padding: '6px 10px',
              backdropFilter: 'blur(8px)',
              boxShadow: '0 4px 14px rgba(0,0,0,0.22)',
              pointerEvents: 'none',
            }}
          >
            🪟 No window yet — add one in <b>Furnish&nbsp;▸&nbsp;Openings</b> to trace sunlight.
          </div>
        )}
      </>
    )
  }

  // OPEN: full controls panel.
  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: anchorRightPx,
        width: 272,
        maxHeight: 'calc(100vh - 24px)',
        overflowY: 'auto',
        borderRadius: 14,
        background: 'rgba(22,24,28,0.86)',
        color: '#f4f1ea',
        backdropFilter: 'blur(8px)',
        font: '12px ui-sans-serif, system-ui, sans-serif',
        zIndex: 10,
        boxShadow: '0 8px 28px rgba(0,0,0,0.28)',
      }}
    >
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 12px' }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>☀ Lighting</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => toggleLightMode(false)}
          title="Close lighting controls (unlock furniture)"
          style={{
            padding: '5px 10px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.22)',
            background: '#ffb454',
            color: '#1a1206',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          🔒 Sun Mode
        </button>
        <button
          onClick={() => toggleLightMode(false)}
          aria-label="Close lighting panel"
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.08)',
            color: '#f4f1ea',
            cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          margin: '0 12px 6px',
          padding: '5px 9px',
          borderRadius: 8,
          background: 'rgba(255,180,84,0.16)',
          color: '#ffd9a0',
          fontWeight: 600,
        }}
      >
        🔒 Furniture locked — editing paused
      </div>

      <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Section title="Time of day">
          <TimeBar hasWindows={hasWindows} />
        </Section>
        <Section title="Sun & North">
          <NorthIndicator />
        </Section>
      </div>
    </div>
  )
}
