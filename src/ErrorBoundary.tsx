// React error boundaries with branded fallbacks — no raw white screens.
//
// Two variants:
//   • "app"   — full-screen fallback for the root of the tree (main.tsx).
//   • "scene" — fills the 3D stage when the R3F canvas subtree throws, with a
//               "Restart 3D view" reset (remounts the Canvas via onReset) so a
//               scene hiccup never takes the surrounding editor down with it.

import { Component, type CSSProperties, type ReactNode } from 'react'
import { RENDER_ERROR_EVENT, type RenderErrorDetail } from './errorEvents'

interface Props {
  children: ReactNode
  variant?: 'app' | 'scene'
  /** Called when the user asks to retry (scene variant): clear + remount. */
  onReset?: () => void
}

interface State {
  error: Error | null
}

const detailStyle: CSSProperties = {
  margin: '18px 0 0',
  padding: '10px 14px',
  borderRadius: 10,
  background: '#f6f4ef',
  border: '1px solid var(--line, #e6e3dd)',
  color: 'var(--ink-3, #8a8780)',
  font: '12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
  maxHeight: 96,
  overflow: 'auto',
  textAlign: 'left',
  wordBreak: 'break-word',
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Surface the real stack for debugging — the UI shows a friendly fallback.
    console.error('[roomio] render error caught by ErrorBoundary:', error, info?.componentStack ?? '')
    // A caught render error never reaches window.onerror, so an error reporter
    // would never see the crashes this boundary hides. Announce it instead; the
    // public demo's reporter (src/demo/errorBuffer.ts) listens, the app ignores it.
    if (typeof window !== 'undefined') {
      const detail: RenderErrorDetail = { error, componentStack: info?.componentStack ?? '' }
      window.dispatchEvent(new CustomEvent(RENDER_ERROR_EVENT, { detail }))
    }
  }

  private reset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return this.props.variant === 'scene' ? this.renderScene(error) : this.renderApp(error)
  }

  /** Full-screen branded fallback (root boundary). */
  private renderApp(error: Error) {
    return (
      <div
        role="alert"
        data-testid="error-fallback-app"
        style={{
          height: '100%',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(120% 120% at 30% 10%, #f3f1ec 0%, #d9d6cf 70%)',
          fontFamily: 'var(--font, ui-sans-serif, system-ui, sans-serif)',
          padding: 24,
        }}
      >
        <div
          style={{
            width: 480,
            maxWidth: '92vw',
            background: '#fff',
            borderRadius: 22,
            padding: '44px 42px',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.12)',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 800, fontSize: 18, marginBottom: 26 }}>
            <span style={{ width: 22, height: 22, borderRadius: 7, background: 'var(--ink, #161616)', display: 'inline-block' }} />
            Roomio
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 12px' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--ink-2, #56544f)', margin: '0 0 24px' }}>
            An unexpected error stopped Roomio. Your saved rooms are safe — reload to pick up
            where you left off.
          </p>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => window.location.reload()}>
            Reload Roomio
          </button>
          <div style={detailStyle}>{String(error?.message || error)}</div>
        </div>
      </div>
    )
  }

  /** Stage-filling fallback for the 3D canvas subtree. */
  private renderScene(error: Error) {
    return (
      <div
        role="alert"
        data-testid="error-fallback-scene"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-3d, #cbcbca)',
          fontFamily: 'var(--font, ui-sans-serif, system-ui, sans-serif)',
          padding: 24,
          zIndex: 5,
        }}
      >
        <div
          style={{
            width: 400,
            maxWidth: '92%',
            background: '#fff',
            borderRadius: 18,
            padding: '30px 30px 26px',
            boxShadow: '0 18px 48px rgba(0, 0, 0, 0.16)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 30, marginBottom: 10 }} aria-hidden>
            🧊
          </div>
          <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.01em', marginBottom: 8 }}>
            The 3D view hit a snag
          </div>
          <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-2, #56544f)', margin: '0 0 18px' }}>
            Your design is still here. Restart the 3D view to keep going — if that doesn't
            help, reload the page.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button className="btn btn-primary" style={{ flex: '1 1 auto' }} onClick={this.reset}>
              Restart 3D view
            </button>
            <button className="btn btn-ghost" style={{ flex: 'none' }} onClick={() => window.location.reload()}>
              Reload page
            </button>
          </div>
          <div style={{ ...detailStyle, maxHeight: 64 }}>{String(error?.message || error)}</div>
        </div>
      </div>
    )
  }
}
