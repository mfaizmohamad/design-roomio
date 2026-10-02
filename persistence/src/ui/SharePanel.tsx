/**
 * Share panel (brief §5/§6). Separates "let someone SEE my room" from "let someone
 * EDIT it" and defaults to the SAFE option (view). The headline feature is the
 * view-only SHOWCASE link: a self-contained URL to the SEPARATE showcase entry
 * (showcase.html) that opens a read-only walkthrough of THIS design only — never
 * the editor, the library, or other designs.
 *
 * Plain-language access ("Anyone with the link can view…"), copy-link, open-in-new
 * tab, and a `.roomio` file export round out the local-first share model. Rich
 * exports (image / shopping list / floor-plan PDF / video) live in the Exports
 * section (wired in C2-5).
 */
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useSession } from '../app/session'
import { buildShowcaseUrl, accessSentence, copyToClipboard, showcaseUrlSizeAdvice } from '../share/link'
import { downloadRoomio } from '../envelope/serialize'
import { ExportsSection } from './Exports'
import { T, panel, btnPrimary, btnGhost } from '../ui/theme'
import type { ShareAccess } from '../envelope/types'

const ACCESS_OPTIONS: { value: ShareAccess; label: string; sub: string }[] = [
  { value: 'view', label: 'Can view', sub: 'Read-only showcase walkthrough' },
  { value: 'edit', label: 'Can edit', sub: 'Needs a Roomio account (coming soon)' },
  { value: 'private', label: 'Private', sub: 'Only you can open it' },
]

export function SharePanel({ onClose }: { onClose: () => void }) {
  const current = useSession((s) => s.current)
  const setShareAccess = useSession((s) => s.setShareAccess)
  const [copied, setCopied] = useState(false)

  const access = current?.share.access ?? 'private'

  // Default to the SAFE shareable option (view) when the panel opens on a design
  // that isn't shared yet, so a copy-link is immediately available (brief PS-9:
  // "defaulting to view"). The user can switch to Private to turn sharing back off.
  useEffect(() => {
    if (current && current.share.access === 'private') setShareAccess('view')
    // run once per opened design
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.design_id])

  // Recompute the link whenever the live design changes. `mutate` swaps the whole
  // `current` reference on EVERY optimistic edit (scene, name, share), so keying on
  // it means the copied link always reflects the latest edit — even before autosave
  // commits (rev would lag and serve a stale scene/name).
  const showcaseUrl = useMemo(() => (current ? buildShowcaseUrl(current) : ''), [current])
  const sizeAdvice = useMemo(() => showcaseUrlSizeAdvice(showcaseUrl), [showcaseUrl])

  if (!current) return null
  const shareable = access === 'view' || access === 'edit'

  const onCopy = async () => {
    const ok = await copyToClipboard(showcaseUrl)
    setCopied(ok)
    if (ok) setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...panel, ...sheet }} onClick={(e) => e.stopPropagation()} data-testid="share-panel">
        <div style={headerRow}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Share “{current.name}”</div>
          <button style={{ ...btnGhost, padding: 6 }} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={section}>
          <div style={label}>Who can access</div>
          <div style={segmented} role="radiogroup" aria-label="Access level">
            {ACCESS_OPTIONS.map((o) => (
              <button
                key={o.value}
                role="radio"
                aria-checked={access === o.value}
                data-testid={`access-${o.value}`}
                onClick={() => setShareAccess(o.value)}
                style={{
                  ...segItem,
                  ...(access === o.value ? segItemActive : null),
                }}
                title={o.sub}
              >
                <div style={{ fontWeight: 700 }}>{o.label}</div>
                <div style={{ fontSize: 11, color: access === o.value ? '#dff0ea' : T.inkFaint }}>{o.sub}</div>
              </button>
            ))}
          </div>
          <div style={accessNote} data-testid="access-sentence">{accessSentence(access)}</div>
        </div>

        <div style={section}>
          <div style={label}>View-only showcase link</div>
          <p style={hint}>
            A read-only walkthrough of just this room. It never opens the editor or your other designs —
            safe to send to anyone.
          </p>
          {shareable ? (
            <>
              <div style={linkRow}>
                <input readOnly value={showcaseUrl} style={linkInput} data-testid="showcase-url" onFocus={(e) => e.currentTarget.select()} />
                <button style={btnPrimary} onClick={onCopy} data-testid="copy-link">{copied ? 'Copied ✓' : 'Copy link'}</button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <a href={showcaseUrl} target="_blank" rel="noopener noreferrer" style={{ ...btnGhost, textDecoration: 'none' }} data-testid="open-showcase">
                  Open showcase ↗
                </a>
              </div>
              {sizeAdvice.level !== 'ok' && (
                <div style={sizeAdvice.level === 'hard' ? sizeWarnHard : sizeWarnSoft} data-testid="size-advice">
                  {sizeAdvice.message}
                </div>
              )}
            </>
          ) : (
            <div style={lockedNote}>
              Sharing is off. Set access to <b>Can view</b> to get a showcase link.
            </div>
          )}
        </div>

        <div style={section}>
          <div style={label}>Export</div>
          <p style={hint}>Take this design out of Roomio.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button style={btnGhost} onClick={() => downloadRoomio(current)} data-testid="export-roomio">
              ⤓ .roomio file
            </button>
          </div>
          <ExportsSection design={current} />
        </div>
      </div>
    </div>
  )
}

const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(20,18,16,0.34)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 16 }
const sheet: CSSProperties = { width: 'min(480px, 100%)', maxHeight: '90vh', overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }
const headerRow: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
const section: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 }
const label: CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: T.inkFaint }
const hint: CSSProperties = { fontSize: 12, color: T.inkSoft, margin: 0 }
const segmented: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }
const segItem: CSSProperties = { font: 'inherit', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: `1px solid ${T.panelBorder}`, background: '#fff', color: T.ink, cursor: 'pointer' }
const segItemActive: CSSProperties = { background: T.accent, color: '#fff', borderColor: T.accent }
const accessNote: CSSProperties = { fontSize: 13, color: T.ink, background: '#f4f2ee', borderRadius: 8, padding: '8px 10px' }
const linkRow: CSSProperties = { display: 'flex', gap: 8 }
const linkInput: CSSProperties = { flex: 1, font: 'inherit', fontSize: 12, padding: '8px 10px', borderRadius: 8, border: `1px solid ${T.panelBorder}`, background: '#faf9f7', color: T.inkSoft, minWidth: 0 }
const lockedNote: CSSProperties = { fontSize: 13, color: T.inkSoft, background: '#f4f2ee', borderRadius: 8, padding: '10px 12px' }
const sizeWarnSoft: CSSProperties = { fontSize: 12, color: T.warn, background: '#fbf1da', borderRadius: 8, padding: '8px 10px' }
const sizeWarnHard: CSSProperties = { fontSize: 12, color: T.danger, background: '#f7e7e4', borderRadius: 8, padding: '8px 10px' }
