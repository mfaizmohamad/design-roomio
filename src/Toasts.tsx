// Toast host — renders the transient notification pills pushed via toast().
// Mounted once in main.tsx so every screen (auth, start, wizard, listings)
// shares the same surface. Styling follows the app's dark pill language
// (see RoomsBar's undo banner).

import type { CSSProperties } from 'react'
import { useToasts, type ToastKind } from './toast'

const ICON: Record<ToastKind, string> = { error: '⚠️', success: '✓', info: 'ℹ️' }

const wrap: CSSProperties = {
  position: 'fixed',
  left: '50%',
  bottom: 22,
  transform: 'translateX(-50%)',
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  pointerEvents: 'none',
  maxWidth: 'min(520px, calc(100vw - 32px))',
}

function pill(kind: ToastKind): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 9,
    padding: '11px 10px 11px 15px',
    borderRadius: 12,
    background: kind === 'error' ? '#37201c' : '#1f2937',
    color: '#f2ede9',
    font: '600 13.5px/1.45 var(--font, ui-sans-serif, system-ui, sans-serif)',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.28)',
    border: kind === 'error' ? '1px solid rgba(255, 138, 118, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)',
    pointerEvents: 'auto',
    maxWidth: '100%',
  }
}

const closeBtn: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'rgba(242, 237, 233, 0.6)',
  fontSize: 16,
  lineHeight: 1,
  cursor: 'pointer',
  padding: '2px 6px',
  flex: 'none',
  marginTop: -1,
}

const actionBtn: CSSProperties = {
  border: '1px solid rgba(255, 255, 255, 0.28)',
  background: 'rgba(255, 255, 255, 0.1)',
  color: '#f2ede9',
  borderRadius: 999,
  padding: '4px 12px',
  fontSize: 12.5,
  fontWeight: 700,
  cursor: 'pointer',
  flex: 'none',
  whiteSpace: 'nowrap',
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  if (toasts.length === 0) return null
  return (
    <div style={wrap}>
      {toasts.map((t) => (
        <div key={t.id} style={pill(t.kind)} role={t.kind === 'error' ? 'alert' : 'status'} data-testid={`toast-${t.kind}`}>
          <span aria-hidden style={{ flex: 'none' }}>
            {ICON[t.kind]}
          </span>
          <span style={{ minWidth: 0 }}>{t.message}</span>
          {t.action && (
            <button
              style={actionBtn}
              onClick={() => {
                t.action!.onClick()
                dismiss(t.id)
              }}
              data-testid={`toast-action-${t.kind}`}
            >
              {t.action.label}
            </button>
          )}
          <button style={closeBtn} onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
