/**
 * VIEW-ONLY SHOWCASE app (brief §5/§6) — the Roomio equivalent of a Figma
 * prototype-only link. It decodes exactly ONE design from the URL fragment and
 * renders a read-only walkthrough.
 *
 * ISOLATION (the cardinal sin defence): this module imports ONLY the payload
 * decoder + the 3D scene. It does NOT import the session store, the library, the
 * editor, or any list of designs — so a showcase link is structurally incapable
 * of reaching the editor or the user's other work. There is also no navigation
 * affordance to the editor/library anywhere in this view.
 */
import { Component, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { decodeShowcasePayload } from '../share/showcasePayload'
import { readShowcaseHash } from '../share/link'
import { ShowcaseScene } from './Scene'

/**
 * Belt-and-suspenders: if anything in the read-only scene throws (e.g. a future
 * malformed-payload edge), degrade to the graceful empty-state rather than a white
 * screen. It still NEVER reaches the editor/library — it only renders a message.
 */
class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function Showcase() {
  const [hash, setHash] = useState(typeof window !== 'undefined' ? window.location.hash : '')
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const payload = useMemo(() => {
    const enc = readShowcaseHash(hash)
    return enc ? decodeShowcasePayload(enc) : null
  }, [hash])

  const invalid = (
    <div style={emptyWrap}>
      <div style={{ fontSize: 20, fontWeight: 800 }}>This showcase link is empty or invalid</div>
      <div style={{ opacity: 0.7, marginTop: 8 }}>
        Ask whoever shared it for a fresh link. (A showcase link only ever opens one read-only room.)
      </div>
    </div>
  )

  if (!payload) return invalid

  const roomCount = payload.scene.house.rooms.length

  return (
    <div style={root}>
      <div style={canvasWrap}>
        <SceneBoundary fallback={invalid}>
          <ShowcaseScene house={payload.scene.house} playing={playing} onTourEnd={() => setPlaying(false)} />
        </SceneBoundary>
      </div>

      {/* read-only header overlay */}
      <header style={topbar}>
        <div style={{ minWidth: 0 }}>
          <div style={nameRow}>
            <span style={badge} data-testid="view-only-badge">View only</span>
            <span style={name} title={payload.name}>{payload.name}</span>
          </div>
          <div style={sub}>
            {roomCount} room{roomCount === 1 ? '' : 's'} · read-only walkthrough
          </div>
        </div>
        <button style={playBtn} onClick={() => setPlaying((p) => !p)} data-testid="play-walkthrough">
          {playing ? '❚❚ Pause tour' : '▶ Play walkthrough'}
        </button>
      </header>

      <footer style={footer}>
        <span style={{ opacity: 0.65 }}>Made with Roomio · drag to look around</span>
      </footer>
    </div>
  )
}

const root: CSSProperties = { position: 'fixed', inset: 0, background: '#1c1b19', color: '#f3f1ec', overflow: 'hidden' }
const canvasWrap: CSSProperties = { position: 'absolute', inset: 0 }
const topbar: CSSProperties = {
  position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 12, padding: '14px 18px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.42), rgba(0,0,0,0))',
}
const nameRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }
const name: CSSProperties = { fontSize: 17, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const badge: CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', background: '#3f7d6e', color: '#fff', padding: '3px 8px', borderRadius: 999 }
const sub: CSSProperties = { fontSize: 12, opacity: 0.7, marginTop: 3 }
const playBtn: CSSProperties = { font: 'inherit', fontSize: 13, fontWeight: 700, color: '#1c1b19', background: '#f3f1ec', border: 'none', borderRadius: 999, padding: '9px 16px', cursor: 'pointer', whiteSpace: 'nowrap' }
const footer: CSSProperties = { position: 'absolute', bottom: 0, left: 0, right: 0, padding: '10px 18px', fontSize: 12, textAlign: 'center', background: 'linear-gradient(to top, rgba(0,0,0,0.42), rgba(0,0,0,0))' }
const emptyWrap: CSSProperties = { position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24, background: '#1c1b19', color: '#f3f1ec' }
