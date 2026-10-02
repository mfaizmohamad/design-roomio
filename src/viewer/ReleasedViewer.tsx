import { useEffect, useState } from 'react'
import { useHouse } from '../three/houseSession'
import { useHouseView, type LevelFilter } from '../three/houseViewMode'
import { RoomView } from '../three/RoomView'
import { useStore } from '../store'
import { FloorPlan } from './EmbercrestViewer'
import { coercePublishedManifest, releaseIdPattern, type PublishedManifest } from './releaseManifest'
import { EnquiryForm } from './EnquiryForm'
import './viewer.css'
const availableWebgl = () => {
  try { const canvas = document.createElement('canvas'); return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')) }
  catch { return false }
}


const planLevel = (manifest: PublishedManifest, index: number) => {
  const level = manifest.home.house!.levels[index]
  return { label: level.label,
    rooms: manifest.home.house!.rooms.filter((r) => (r.level ?? 0) === index).map((r) => {
      const x = r.design.corners.map((c) => c.x)
      const z = r.design.corners.map((c) => c.z)
      const w = Math.max(...x) - Math.min(...x)
      const l = Math.max(...z) - Math.min(...z)
      return { name: r.design.name, x: r.pos?.x ?? w / 2, z: r.pos?.z ?? l / 2, w, l }
    }) }
}

/** Public release viewer: published manifest only, never a local draft fixture. */
export default function ReleasedViewer({ releaseId }: { releaseId: string }) {
  const [manifest, setManifest] = useState<PublishedManifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showPlan, setShowPlan] = useState(() => !availableWebgl())
  const mode = useHouseView((s) => s.mode)
  const levelFilter = useHouseView((s) => s.levelFilter)
  const rooms = useHouse((s) => s.rooms)
  const activeId = useHouse((s) => s.activeId)

  useEffect(() => {
    if (!releaseIdPattern.test(releaseId)) { setError('This release link is invalid.'); return }
    const controller = new AbortController()
    fetch(`/api/releases/${releaseId}`, { signal: controller.signal, credentials: 'omit' })
      .then(async (response) => {
        if (!response.ok) throw new Error('This release is unavailable.')
        const parsed: unknown = await response.json()
        const next = coercePublishedManifest(parsed, releaseId)
        if (!next) throw new Error('This release could not be loaded.')
        useHouse.getState().loadSavedDesign(next.home)
        setManifest(next)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : 'This release is unavailable.')
      })
    return () => { controller.abort(); useHouseView.getState().setLevelFilter('all') }
  }, [releaseId])

  const selectLevel = (level: LevelFilter) => {
    useHouseView.getState().setMode('house')
    useHouseView.getState().setLevelFilter(level)
  }
  const selectRoom = (id: string) => {
    useHouse.getState().switchRoom(id)
    useHouseView.getState().setMode('room')
    setShowPlan(false)
  }
  const reset = () => {
    selectLevel('all')
    setShowPlan(false)
    useStore.getState().fitView()
  }
  const currentRoom = rooms.find((r) => r.id === activeId)
  const levels = manifest?.home.house?.levels ?? []
  const visible = levels.map((_, index) => index).filter((index) => levelFilter === 'all' || index === levelFilter)

  return <main className="buyer-viewer">
    <header className="buyer-header">
      <a className="buyer-mark" href="/">Roomio <span>/ Home tour</span></a>
      <span className="buyer-preview">Published home · revision {manifest?.homeRevision ?? '—'}</span>
    </header>
    <div className="buyer-body">
      <aside className="buyer-sidebar">
        <p className="buyer-kicker">Explore this home</p>
        <h1>{manifest?.home.name ?? 'Home tour'}</h1>
        {manifest?.claims.map((claim) => <p className="buyer-intro" key={claim.id}><b>{claim.label}:</b> {claim.value}</p>)}
        <div className="buyer-control-group" role="group" aria-label="Choose a floor">
          <button className={mode === 'house' && levelFilter === 'all' ? 'selected' : ''}
            aria-pressed={mode === 'house' && levelFilter === 'all'} onClick={() => selectLevel('all')}>Whole home</button>
          {levels.map((level, index) => <button key={index}
            className={mode === 'house' && levelFilter === index ? 'selected' : ''}
            aria-pressed={mode === 'house' && levelFilter === index}
            onClick={() => selectLevel(index)}>{level.label}</button>)}
        </div>
        <div className="buyer-control-group buyer-display" role="group" aria-label="Choose a view">
          <button className={!showPlan ? 'selected' : ''} aria-pressed={!showPlan}
            onClick={() => setShowPlan(false)}>3D view</button>
          <button className={showPlan ? 'selected' : ''} aria-pressed={showPlan}
            onClick={() => setShowPlan(true)}>Floor plan</button>
        </div>
        {mode === 'room' && currentRoom && <p className="buyer-current-room">Viewing {currentRoom.design.name}</p>}
        <button className="buyer-reset" onClick={reset}>Reset view</button>
      </aside>
      <section className="buyer-stage" aria-label="Published home view">
        {error ? <div className="buyer-stage-message" role="alert">{error}</div> :
          !manifest ? <div className="buyer-stage-message" role="status">Loading published home…</div> : <>
            <div className="buyer-canvas" hidden={showPlan}><RoomView buyerMode /></div>
            {showPlan && <div className="buyer-plans">
              {visible.map((index) => <FloorPlan key={index} level={planLevel(manifest, index)} />)}
            </div>}
          </>}
      </section>
    </div>
    {manifest && <nav className="buyer-rooms" aria-label="Explore rooms">
      <span>Rooms</span>
      {rooms.filter((r) => levelFilter === 'all' || r.level === levelFilter).map((r) =>
        <button key={r.id} className={mode === 'room' && activeId === r.id ? 'selected' : ''}
          onClick={() => selectRoom(r.id)}>{r.design.name}</button>)}
    </nav>}
    {manifest && <div className="buyer-enquiry"><EnquiryForm releaseId={releaseId} /></div>}
  </main>
}
