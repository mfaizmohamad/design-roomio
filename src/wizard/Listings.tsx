/**
 * Flat listings page (no-broker) — the "Browse flats" entry. Renders scraped
 * flatmate-group posts as clean, comparable cards sorted newest-first: photos +
 * video, rent / BHK / locality / gender chips, the post text, and the poster's
 * phone shown OPENLY with a one-tap Call button (tel:) + a link to the source post.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useStore } from '../store'
import { loadListings, type FlatListing, type ListingsDoc } from '../data/listings'
import { hasListingFlat, openListingFlat } from '../listingFlatLauncher'
import { LISTING_FLATS } from '../data/listingFlats'

const BHK_OPTIONS = ['1RK', '1BHK', '2BHK', '3BHK']

export function Listings() {
  const setStage = useStore((s) => s.setStage)
  const [doc, setDoc] = useState<ListingsDoc | null>(null)
  const [q, setQ] = useState('')
  const [bhk, setBhk] = useState<string | null>(null)
  const [gender, setGender] = useState<string | null>(null)
  const [photosOnly, setPhotosOnly] = useState(false)
  const [sort, setSort] = useState<'new' | 'rentLow' | 'rentHigh'>('new')
  // top-bar view switch: the classic card list vs the walkable-in-3D gallery
  const [view, setView] = useState<'all' | 'renders'>('all')

  useEffect(() => {
    let live = true
    // `void`: loadListings() folds a fetch/parse failure into the bundled sample
    // doc and never rejects, so there is no rejection path to handle here.
    void loadListings().then((d) => { if (live) setDoc(d) })
    return () => { live = false }
  }, [])

  // every listing now opens in 3D (a photo-matched replica or a generated
  // approximation), so the "3D" tab shows them all — replicaCount is just the
  // count of hand-authored, photo-matched flats, surfaced as a quality badge.
  const replicaCount = useMemo(
    () => (doc?.listings ?? []).filter((l) => hasListingFlat(l.id)).length,
    [doc],
  )
  const walkableCount = doc?.listings.length ?? 0

  const rows = useMemo(() => {
    let list = doc?.listings ?? []
    const needle = q.trim().toLowerCase()
    if (needle) list = list.filter((l) => (l.text + ' ' + (l.location ?? '')).toLowerCase().includes(needle))
    if (bhk) list = list.filter((l) => l.bhk === bhk)
    if (gender) list = list.filter((l) => l.gender === gender)
    if (photosOnly) list = list.filter((l) => l.hasImages || l.hasVideo)
    const sorted = [...list]
    if (sort === 'rentLow') sorted.sort((a, b) => (a.rent ?? Infinity) - (b.rent ?? Infinity))
    else if (sort === 'rentHigh') sorted.sort((a, b) => (b.rent ?? -1) - (a.rent ?? -1))
    else sorted.sort((a, b) => (a.seq ?? 1e9) - (b.seq ?? 1e9)) // newest first
    return sorted
  }, [doc, q, bhk, gender, photosOnly, sort])

  const updated = doc ? new Date(doc.scrapedAt) : null

  return (
    <div className="listings">
      <header className="listings-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setStage('start')} title="Back to home">⌂ Home</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.01em' }}>🏠 Flats near you</div>
            <div style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>
              Direct from flatmate groups · no broker{doc ? ` · ${doc.count} listings` : ''}
              {updated ? ` · updated ${timeAgo(updated)}` : ''}
            </div>
          </div>
          {/* view navbar: the classic list vs the walkable-in-3D gallery */}
          <nav className="listing-tabs" style={{ border: 'none', padding: 0, marginLeft: 10 }} aria-label="Listing view">
            <button
              className={`listing-tab${view === 'all' ? ' is-active' : ''}`}
              onClick={() => setView('all')}
            >
              All listings
            </button>
            <button
              className={`listing-tab${view === 'renders' ? ' is-active' : ''}`}
              onClick={() => setView('renders')}
              title={`Walk every flat in 3D${replicaCount ? ` · ${replicaCount} rebuilt photo-for-photo, the rest AI-approximated` : ''}`}
            >
              🏠 Walk in 3D{walkableCount ? ` · ${walkableCount}` : ''}
            </button>
          </nav>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="listings-search" placeholder="Search area, e.g. Andheri, Powai…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={bhk ?? ''} onChange={(v) => setBhk(v || null)} options={[['', 'Any BHK'], ...BHK_OPTIONS.map((b) => [b, b] as [string, string])]} />
          <Select value={gender ?? ''} onChange={(v) => setGender(v || null)} options={[['', 'Any gender'], ['female', 'Female'], ['male', 'Male']]} />
          <Select value={sort} onChange={(v) => setSort(v as typeof sort)} options={[['new', 'Newest'], ['rentLow', 'Rent ↑'], ['rentHigh', 'Rent ↓']]} />
          <label style={{ ...chipStyle, cursor: 'pointer', gap: 6 }}>
            <input type="checkbox" checked={photosOnly} onChange={(e) => setPhotosOnly(e.target.checked)} /> Photos
          </label>
        </div>
      </header>

      {!doc ? (
        <div style={emptyStyle}>Loading listings…</div>
      ) : rows.length === 0 ? (
        <div style={emptyStyle}>No listings match your filters.</div>
      ) : (
        <div className="listings-grid">
          {rows.map((l) =>
            view === 'renders' ? <RenderCard key={l.id} l={l} /> : <ListingCard key={l.id} l={l} />,
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Designed fallback for the media slot — shown when a listing has no photos or
 * a photo fails to load (expired CDN link, missing file, offline). Matches the
 * card's warm palette so a failed image never leaves a blank beige box.
 */
function MediaFallback({ label }: { label: string }) {
  return (
    <div className="listing-media-fallback" role="img" aria-label={label}>
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 42V12a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v30" />
        <path d="M25 42V22a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v20" />
        <path d="M5 42h38" />
        <path d="M14 16h2m4 0h2m-8 6h2m4 0h2m-8 6h2m4 0h2" />
        <path d="M30 26h2m4 0h2m-8 6h2m4 0h2" />
        <path d="M15 42v-6h4v6" />
      </svg>
      <span>{label}</span>
    </div>
  )
}

/** Track which media srcs have 404'd so we swap them for the fallback (not display:none). */
function useBrokenMedia() {
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set())
  const markBroken = (src: string) => setBroken((prev) => new Set(prev).add(src))
  return { isBroken: (src: string) => broken.has(src), markBroken }
}

/** Card in the "Walk in 3D" view. Every listing opens in 3D: a hand-authored
 *  replica shows its photo-matched pipeline renders; any other listing shows its
 *  own scraped photo, and clicking opens a generic furnished approximation. The
 *  badge always discloses which of the two it is (compliance). */
function RenderCard({ l }: { l: FlatListing }) {
  const [ri, setRi] = useState(0)
  const { isBroken, markBroken } = useBrokenMedia()
  const flat = LISTING_FLATS[l.id]
  const isReplica = !!flat
  const shots = flat?.shots ?? []
  const render = shots[ri % Math.max(1, shots.length)]
  // replica → its pipeline render; else → the listing's own scraped photo.
  const src = render ? `/renders/${l.id}/${render.name}.jpg` : l.images[0] ?? l.video?.thumb ?? null

  return (
    <article
      className="listing-card listing-card-render"
      onClick={() => openListingFlat(l)}
      title={isReplica ? 'Open this photo-matched flat in 3D' : 'Preview a furnished 3D approximation of this flat'}
    >
      <div className="listing-media">
        {src && !isBroken(src) ? (
          <img
            src={src}
            alt={render ? render.name : ''}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => markBroken(src)}
          />
        ) : (
          <MediaFallback label={isReplica ? 'Render unavailable' : 'No photos'} />
        )}
        {render && <span className="listing-badge" style={{ left: 10 }}>{render.name.replace(/-/g, ' ')}</span>}
        {shots.length > 1 && (
          <button
            className="listing-badge listing-cycle"
            style={{ right: 10 }}
            onClick={(e) => { e.stopPropagation(); setRi((ri + 1) % shots.length) }}
            title="Next view"
          >
            {(ri % shots.length) + 1}/{shots.length} ›
          </button>
        )}
        <span className="listing-call listing-media-cta">🚶 Walk this flat</span>
      </div>

      <div className="listing-body">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, alignItems: 'center' }}>
          {l.rent != null && <span style={{ ...chipStyle, background: '#111', color: '#fff', fontWeight: 800 }}>₹{l.rent.toLocaleString('en-IN')}/mo</span>}
          {l.bhk && <span style={chipStyle}>{l.bhk}</span>}
          {l.location && <span style={chipStyle}>📍 {l.location}</span>}
          {isReplica ? (
            <span style={{ ...chipStyle, color: '#8a63d2', borderColor: '#8a63d240', background: '#8a63d21a' }}>
              ✓ {flat.title}
            </span>
          ) : (
            <span
              style={{ ...chipStyle, color: '#9a6a00', borderColor: '#e0a83033', background: '#f3b70022' }}
              title="A furnished 3D layout generated from this listing's details — an approximation, not the actual unit"
            >
              ✨ AI-generated approximation
            </span>
          )}
        </div>
        <p className="listing-clamp" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{l.text}</p>
      </div>
    </article>
  )
}

function ListingCard({ l }: { l: FlatListing }) {
  const [i, setI] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const { isBroken, markBroken } = useBrokenMedia()
  const media = l.images
  const hasMedia = media.length > 0 || l.hasVideo
  const poster = media[i] || l.video?.thumb || null
  // prefer flat PHOTOS over video — a video alongside photos is a suggested reel,
  // not the listing (belt-and-suspenders with the pipeline's same rule)
  const videoFile = media.length === 0 ? l.video?.file : null

  return (
    <article className="listing-card">
      {videoFile ? (
        // downloaded flat-tour video — plays inline (with audio)
        <video className="listing-media" controls preload="metadata" playsInline
          poster={l.video?.thumb ?? media[0] ?? undefined} src={videoFile} />
      ) : (
        <div className="listing-media" onClick={() => media.length > 1 && setI((i + 1) % media.length)} style={{ cursor: media.length > 1 ? 'pointer' : 'default' }}>
          {poster && !isBroken(poster) ? (
            <img src={poster} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => markBroken(poster)} />
          ) : (
            <MediaFallback label={poster ? 'Photo unavailable' : 'No photos'} />
          )}
          {media.length > 1 && <span className="listing-badge" style={{ right: 10 }}>{i + 1}/{media.length}</span>}
          {l.hasVideo && (
            <a className="listing-badge listing-video" style={{ left: 10 }} href={l.permalink ?? undefined} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>▶ Video</a>
          )}
        </div>
      )}

      <div className="listing-body">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, alignItems: 'center' }}>
          {l.rent != null && <span style={{ ...chipStyle, background: '#111', color: '#fff', fontWeight: 800 }}>₹{l.rent.toLocaleString('en-IN')}/mo</span>}
          {l.bhk && <span style={chipStyle}>{l.bhk}</span>}
          {l.location && <span style={chipStyle}>📍 {l.location}</span>}
          {l.gender && <span style={chipStyle}>{l.gender === 'female' ? '♀ Female' : '♂ Male'}</span>}
          {l.occupancy && <span style={chipStyle}>{cap(l.occupancy)} occ.</span>}
          {!hasMedia && <span style={{ ...chipStyle, color: 'var(--ink-3)' }}>No photos</span>}
        </div>

        <p className={expanded ? '' : 'listing-clamp'} style={{ margin: '0 0 6px', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{l.text}</p>
        {l.text.length > 160 && (
          <button className="listing-link" onClick={() => setExpanded((v) => !v)}>{expanded ? 'See less' : 'See more'}</button>
        )}

        <div className="listing-foot">
          <span style={{ color: 'var(--ink-3)', fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {l.author ? l.author : 'Posted'}{l.postedAbs ? ` · ${l.postedAbs}` : ''}
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 'none' }}>
            <button
              className="listing-call"
              style={{ border: 'none', cursor: 'pointer', background: '#111', color: '#fff' }}
              onClick={() => openListingFlat(l)}
              title={hasListingFlat(l.id)
                ? 'Walk this flat in 3D — rebuilt photo-for-photo from the listing'
                : 'Preview a furnished 3D approximation generated from this listing'}
            >
              🏠 {hasListingFlat(l.id) ? 'View in 3D' : 'Preview in 3D'}
            </button>
            {l.permalink && <a className="listing-link" href={l.permalink} target="_blank" rel="noreferrer">View post ↗</a>}
            {l.phones[0] && (
              <a className="listing-call" href={`tel:+91${l.phones[0]}`} title={l.phones.map((p) => '+91 ' + p).join(', ')}>
                📞 Call {fmtPhone(l.phones[0])}
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select className="listings-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  )
}

const chipStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f3b70022', border: '1px solid #e6e3dd',
  borderRadius: 999, padding: '3px 9px', fontSize: 12, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap',
}
const emptyStyle: CSSProperties = { padding: '60px 20px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 15 }

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }
function fmtPhone(p: string) { return p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p }
function timeAgo(d: Date) {
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000))
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / 1440)}d ago`
}
