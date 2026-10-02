import { lazy, Suspense, useEffect } from 'react'
import { useStore, type Stage } from './store'
import { useHouse } from './three/houseSession'
import type { ShapeId } from './types'
import { useAuth } from './auth'
import { isDirty } from './dirty'
import { StartScreen } from './wizard/StartScreen'
import { Listings } from './wizard/Listings'
import { AuthScreen } from './wizard/AuthScreen'
// Static on purpose — this one cannot be code-split, and pretending otherwise cost a
// build warning ("dynamically imported by App.tsx but also statically imported by
// wizard/Listings.tsx — dynamic import will not move module into another chunk").
// Listings (eager, line above) calls hasListingFlat during render, and the launcher's
// own graph — houseSession (line 3) → data/listingFlats — is eager anyway, so only the
// lighting/render zustand stores were ever movable. Measured: splitting it for real
// (lazy in Listings too) trims the entry 160.8 → 155.0 kB, 49.2 → 47.1 kB gzipped —
// ~2 kB of a ~99 kB gzipped first load — in exchange for a round-trip with no feedback
// on the listings page's primary "View in 3D" button. Not worth it; no `three` here, so
// the split that matters (the 3D studio behind React.lazy, below) is unaffected.
import { openListingFlat } from './listingFlatLauncher'

// Code-split: the 3D studio (Wizard → RoomView → three.js / R3F / drei / postprocessing)
// loads on demand, so the auth screen, start screen and the 2D listings browser ship
// without the 3D engine. Keep this the ONLY route to ./wizard/Wizard — a static import
// anywhere in the entry path would pull the engine back into the entry chunk.
const Wizard = lazy(() =>
  import('./wizard/Wizard').then((m) => ({ default: m.Wizard })),
)
// The local buyer preview reuses the 3D engine behind a separate lazy route.
const EmbercrestViewer = lazy(() => import('./viewer/EmbercrestViewer'))
const ReleasedViewer = lazy(() => import('./viewer/ReleasedViewer'))
const DeveloperWorkspace = lazy(() => import('./developer/DeveloperWorkspace'))
const IS_EMBERCREST_SHOWCASE =
  typeof window !== 'undefined' && window.location.pathname === '/showcase/embercrest'
const IS_DEVELOPER_WORKSPACE =
  typeof window !== 'undefined' && window.location.pathname === '/developer'
const PUBLIC_RELEASE_ID = typeof window !== 'undefined'
  ? /^\/release\/([0-9a-f-]+)$/i.exec(window.location.pathname)?.[1] ?? null
  : null
const IS_PUBLIC_VIEW = IS_EMBERCREST_SHOWCASE || PUBLIC_RELEASE_ID !== null

/** Suspense fallback while the 3D-studio chunk downloads — branded, never a blank flash. */
function StudioLoading() {
  return (
    <div className="start">
      <div className="studio-loading">
        <div className="boot-spinner" />
        <div className="studio-loading-label">Preparing your 3D studio…</div>
      </div>
    </div>
  )
}

const STAGES: Stage[] = ['start', 'step1', 'step2', 'step3', 'step4', 'furnish', 'listings']
const SHAPES: ShapeId[] = ['rect', 'l', 't', 'u', 'cut', 'beveled']

// Whether the FIRST load was a deep-link (?stage / ?preset). Captured ONCE so that
// ordinary in-app navigation — which now writes ?stage into the URL — doesn't
// retroactively bypass the auth gate.
const INITIAL_DEEP_LINK =
  typeof window !== 'undefined' &&
  Boolean(
    new URLSearchParams(window.location.search).get('stage') ||
      new URLSearchParams(window.location.search).get('preset') ||
      new URLSearchParams(window.location.search).get('listing'),
  )

/** The canonical URL for the current screen: each stage (+ active room) is its own URL. */
function canonicalUrl(): string {
  const stage = useStore.getState().stage
  const p = new URLSearchParams()
  p.set('stage', stage)
  if (stage === 'furnish') {
    const room = useHouse.getState().activeId
    if (room) p.set('room', room)
  }
  return `${window.location.pathname}?${p.toString()}`
}

export default function App() {
  const stage = useStore((s) => s.stage)
  const setStage = useStore((s) => s.setStage)
  const authStatus = useAuth((s) => s.status)
  const promptAuth = useAuth((s) => s.promptAuth)
  const initAuth = useAuth((s) => s.init)

  // Check the session once on boot. `void`: init() resolves its own failures
  // into a status ('offline' when the backend is unreachable, 'anon' when the
  // session is gone) and never rejects, so there is nothing to await or catch.
  useEffect(() => {
    if (IS_PUBLIC_VIEW) return
    void initAuth()
    // Mount-once on purpose: re-running it would re-probe the backend on every
    // render that changes the auth store, so the deps array stays empty and
    // exhaustive-deps is suppressed here rather than satisfied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // CODE-16: warn before a tab close / reload discards unsaved edits. Only fires
  // while genuinely editing (a wizard/furnish stage) AND the design is dirty, so
  // it never nags on the start screen or listings.
  useEffect(() => {
    if (IS_PUBLIC_VIEW || IS_DEVELOPER_WORKSPACE) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = useStore.getState().stage
      if (s === 'start' || s === 'listings') return
      if (!isDirty()) return
      e.preventDefault()
      e.returnValue = '' // required for the native prompt in most browsers
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Deep-link / verification helper: ?stage=step2 jumps straight to a stage,
  // and ?preset=<genre_id> loads a persona room directly into the furnish stage.
  useEffect(() => {
    if (IS_PUBLIC_VIEW || IS_DEVELOPER_WORKSPACE) return
    const params = new URLSearchParams(window.location.search)
    // ?listing=<scraped id> → open that listing in 3D directly: its photo-matched
    // replica if one exists, else a generic furnished flat from its metadata.
    const listingId = params.get('listing')
    if (listingId) {
      // `void`: deliberately fire-and-forget — the deep-link resolves in the
      // background while the shell renders. A rejected chunk fetch (stale
      // index.html after a deploy) still reaches window.onunhandledrejection,
      // which is where it was going before; `void` only tells the linter the
      // omission is intentional, it does not swallow anything.
      void import('./data/listings').then(({ loadListings }) =>
        loadListings().then((doc) => {
          const listing = doc.listings.find((l) => l.id === listingId)
          if (listing) openListingFlat(listing)
          else setStage('listings')
        }),
      )
      return
    }
    // ?home=<id>[&level=<n>] → a multi-storey home (data/homes), all storeys
    // stacked unless a level is named. ?preset=sky_duplex was the first link
    // shared for the Sky Duplex, so it keeps working and opens the whole home.
    const presetId = params.get('preset')
    const homeId = params.get('home') ?? (presetId === 'sky_duplex' ? 'sky' : null)
    if (homeId) {
      void import('./homeLauncher').then(({ openHome, parseLevelFilter }) => {
        if (!openHome(homeId, parseLevelFilter(params.get('level')))) setStage('start')
      })
      return
    }
    if (presetId) {
      void import('./data/personas').then(({ PERSONA_MAP }) => {
        const preset = PERSONA_MAP[presetId]
        if (preset) useStore.getState().loadPreset(preset)
      })
      return
    }
    const q = params.get('stage') as Stage | null
    if (q === 'listings') { setStage('listings'); return } // full-page view, no room reset
    if (q && STAGES.includes(q) && q !== 'start') {
      const shapeParam = params.get('shape') as ShapeId | null
      const shape = shapeParam && SHAPES.includes(shapeParam) ? shapeParam : 'rect'
      useStore.getState().resetDesign(shape)
      if (params.get('seed')) {
        const st = useStore.getState()
        const w = st.walls
        if (w[0]) st.addOpening('single', w[0].id, 0.38)
        if (w[1]) st.addOpening('windowDouble', w[1].id, 0.5)
        if (w[2]) st.addOpening('french', w[2].id, 0.6)
        if (w[3]) st.addOpening('windowSingle', w[3].id, 0.5)
        // furniture spread across the default 600x400 room (center 300,200)
        st.addFurniture('sofa-3', 300, 320)
        st.addFurniture('table-coffee', 300, 235)
        st.addFurniture('bed-queen', 470, 110)
        st.addFurniture('decor-plant', 110, 110)
        st.addFurniture('chair-office', 140, 300)
        st.selectFurniture(null)
        // demo-only: showcase selected-opening resize + a locked item (read fresh state)
        const live = useStore.getState()
        if (q === 'step3') live.selectOpening(live.design.openings[0]?.id ?? null)
        if (q === 'furnish') {
          const fl = live.design.furniture[2]
          if (fl) live.updateFurniture(fl.id, { locked: true })
          // select the sofa so the lock/delete toolbar is visible in screenshots
          live.selectFurniture(live.design.furniture[0]?.id ?? null)
        }
      }
      setStage(q)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // URL routing: give every screen (and the active room) its own URL, and make the
  // browser back/forward buttons move between them. Navigation pushes history;
  // popstate restores the stage/room WITHOUT resetting the design.
  useEffect(() => {
    // Preserve the public preview path; stage URL canonicalization belongs to the editor.
    if (IS_PUBLIC_VIEW || IS_DEVELOPER_WORKSPACE) return
    let restoring = false
    // canonicalize the current screen's URL on boot (after any deep-link applied)
    try {
      window.history.replaceState(null, '', canonicalUrl())
    } catch {
      /* ignore (non-DOM) */
    }
    const sync = (mode: 'push' | 'replace' = 'push') => {
      if (restoring) return
      const url = canonicalUrl()
      if (url === window.location.pathname + window.location.search) return
      if (mode === 'replace') window.history.replaceState(null, '', url)
      else window.history.pushState(null, '', url)
    }
    const unsubStage = useStore.subscribe((s, prev) => {
      if (s.stage !== prev.stage) sync('push')
    })
    const unsubRoom = useHouse.subscribe((s, prev) => {
      if (s.activeId === prev.activeId) return
      // First room init (null → id) just completes the furnish URL — REPLACE so it
      // doesn't add a phantom history entry. A real room switch PUSHES so back/
      // forward navigates between rooms.
      sync(prev.activeId == null ? 'replace' : 'push')
    })
    const onPop = () => {
      restoring = true
      try {
        const p = new URLSearchParams(window.location.search)
        const st = (p.get('stage') as Stage) || 'start'
        const room = p.get('room')
        if (room) {
          const h = useHouse.getState()
          if (h.activeId !== room && h.rooms.some((r) => r.id === room)) h.switchRoom(room)
        }
        useStore.getState().setStage(STAGES.includes(st) ? st : 'start')
      } finally {
        restoring = false
      }
    }
    window.addEventListener('popstate', onPop)
    return () => {
      unsubStage()
      unsubRoom()
      window.removeEventListener('popstate', onPop)
    }
    // Mount-once on purpose: this installs the history subscriptions exactly
    // once. Re-running it would stack duplicate popstate listeners.
  }, [])

  // ?stage / ?preset deep-links bypass the auth gate (verification convenience).
  const deepLinked = INITIAL_DEEP_LINK

  if (IS_EMBERCREST_SHOWCASE) {
    return <Suspense fallback={<StudioLoading />}><EmbercrestViewer /></Suspense>
  }
  if (PUBLIC_RELEASE_ID) {
    return <Suspense fallback={<StudioLoading />}><ReleasedViewer releaseId={PUBLIC_RELEASE_ID} /></Suspense>
  }

  if (authStatus === 'loading') {
    return (
      <div className="app">
        <div className="start">
          <div className="boot-spinner" />
        </div>
      </div>
    )
  }

  // Workspace data is tenant-private; unlike editor verification deep-links,
  // this route never renders for a guest or during an offline auth probe.
  if (IS_DEVELOPER_WORKSPACE) {
    return authStatus === 'authed'
      ? <Suspense fallback={<StudioLoading />}><DeveloperWorkspace /></Suspense>
      : <div className="app"><AuthScreen /></div>
  }

  // Show the login wall on a fresh anon boot, OR whenever a guest explicitly
  // asks to sign in from inside the app (promptAuth) — the latter overrides the
  // deep-link bypass so "Sign in" always reaches the wall (WIZ-03).
  if (authStatus !== 'authed' && (promptAuth || (authStatus === 'anon' && !deepLinked))) {
    return (
      <div className="app">
        <AuthScreen />
        <a href="/showcase/embercrest" style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 20, padding: '10px 16px', borderRadius: 999, background: '#262c28', color: '#fff', textDecoration: 'none', fontWeight: 700 }}>Explore Embercrest preview</a>
      </div>
    )
  }

  return (
    <div className="app">
      {stage === 'start' ? (
        <><StartScreen /><a href="/showcase/embercrest" style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 20, padding: '10px 16px', borderRadius: 999, background: '#262c28', color: '#fff', textDecoration: 'none', fontWeight: 700 }}>Explore Embercrest preview</a></>
      ) : stage === 'listings' ? (
        <Listings />
      ) : (
        <Suspense fallback={<StudioLoading />}>
          <Wizard />
        </Suspense>
      )}
    </div>
  )
}
