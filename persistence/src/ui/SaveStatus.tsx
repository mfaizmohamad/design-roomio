/**
 * The save-status indicator (brief §3, §6) — the small element that does the
 * heavy lifting of trust. Two clear states: "Saving…" (spinner) and
 * "Saved <relative time>". On failure: "Couldn't save — retrying…". The relative
 * time ticks live so "just now" ages to "2 min ago" without a re-save.
 */
import { useEffect, useState, type CSSProperties } from 'react'
import type { SaveStatus } from '../autosave/status'
import { savedLabel } from '../autosave/status'
import { T } from './theme'

export function SaveStatusIndicator({ status, backend }: { status: SaveStatus; backend?: string }) {
  // Tick once a second so the relative timestamp stays fresh.
  const [, force] = useState(0)
  useEffect(() => {
    if (status.phase !== 'saved' && status.phase !== 'idle') return
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [status.phase, status.savedAt])

  const { dot, text, tone } = describe(status)
  const memoryWarn = backend === 'memory'

  return (
    <div
      style={wrap}
      data-testid="save-status"
      data-phase={status.phase}
      title={status.error ? `Last error: ${status.error}` : undefined}
    >
      {status.phase === 'saving' ? <Spinner /> : <span style={{ ...dotStyle, background: dot }} />}
      <span style={{ color: tone, fontWeight: 600 }}>{text}</span>
      {memoryWarn && (
        <span style={memTag} title="localStorage unavailable — keeping your work in memory for this session.">
          in-memory
        </span>
      )}
    </div>
  )
}

function describe(s: SaveStatus): { dot: string; text: string; tone: string } {
  switch (s.phase) {
    case 'saving':
      return { dot: T.warn, text: 'Saving…', tone: T.inkSoft }
    case 'saved':
      return { dot: T.good, text: `Saved ${savedLabel(s.savedAt)}`, tone: T.inkSoft }
    case 'dirty':
      return { dot: T.warn, text: 'Unsaved changes', tone: T.inkSoft }
    case 'error':
      return { dot: T.danger, text: 'Couldn’t save — retrying…', tone: T.danger }
    case 'idle':
    default:
      return { dot: '#cfcdc8', text: s.savedAt ? `Saved ${savedLabel(s.savedAt)}` : 'All changes saved', tone: T.inkFaint }
  }
}

const wrap: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  userSelect: 'none',
}

const dotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 8,
  display: 'inline-block',
}

const memTag: CSSProperties = {
  marginLeft: 4,
  fontSize: 11,
  fontWeight: 700,
  color: T.warn,
  background: '#fbf1da',
  borderRadius: 6,
  padding: '2px 6px',
}

function Spinner() {
  return (
    <span
      aria-label="saving"
      style={{
        width: 12,
        height: 12,
        border: `2px solid ${T.inkFaint}`,
        borderTopColor: 'transparent',
        borderRadius: 12,
        display: 'inline-block',
        animation: 'roomio-spin 0.7s linear infinite',
      }}
    />
  )
}
