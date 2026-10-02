// Confirm-dialog host — renders the modal requested via confirmDialog().
// Mounted once in main.tsx (beside <Toasts/>) so any screen can raise it.
// Follows the app's card language (start-card) + .btn classes; the destructive
// action uses the same red as the saved-row Delete affordance.

import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import { useConfirm } from './confirm'

const backdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
  background: 'rgba(20, 18, 15, 0.44)',
  backdropFilter: 'blur(2px)',
}

const card: CSSProperties = {
  width: 420,
  maxWidth: '92vw',
  background: '#fff',
  borderRadius: 16,
  padding: '22px 22px 18px',
  boxShadow: '0 24px 70px rgba(0, 0, 0, 0.32)',
  border: '1px solid #e6e3dd',
}

const dangerBtn: CSSProperties = {
  background: '#b0392f',
  borderColor: '#b0392f',
  color: '#fff',
}

export function ConfirmDialog() {
  const current = useConfirm((s) => s.current)
  const resolve = useConfirm((s) => s.resolve)

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        resolve(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        resolve(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [current, resolve])

  if (!current) return null

  return (
    <div
      style={backdrop}
      onClick={() => resolve(false)}
      data-testid="confirm-backdrop"
    >
      <div
        style={card}
        role="alertdialog"
        aria-modal="true"
        aria-label={current.title}
        data-testid="confirm-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink, #23211e)' }}>
          {current.title}
        </div>
        {current.body && (
          <p style={{ fontSize: 13.5, color: 'var(--ink-3, #6b6862)', lineHeight: 1.5, margin: '10px 0 0' }}>
            {current.body}
          </p>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
          <button
            className="btn btn-ghost btn-sm"
            style={{ flex: 'none' }}
            onClick={() => resolve(false)}
            data-testid="confirm-cancel"
          >
            {current.cancelLabel || 'Cancel'}
          </button>
          <button
            className="btn btn-primary btn-sm"
            style={{ flex: 'none', ...(current.danger ? dangerBtn : null) }}
            onClick={() => resolve(true)}
            data-testid="confirm-ok"
            autoFocus
          >
            {current.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
