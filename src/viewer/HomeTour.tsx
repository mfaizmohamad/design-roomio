import { useEffect, useState, type ReactNode } from 'react'
import type { MultiLevelHome } from '../data/homes/types'
import { openHome } from '../homeLauncher'
import { useHouse } from '../three/houseSession'
import { useHouseView, type LevelFilter } from '../three/houseViewMode'
import { RoomView } from '../three/RoomView'
import { useStore } from '../store'
import type { FlythroughController } from '../../camera-flythrough/src/engine/FlythroughController'
import { WalkOverlay } from './WalkControls'
import { useWalking } from './useWalking'
import { entranceSpawn } from './entrance'
import './viewer.css'

const viewOptions: { label: string; value: LevelFilter }[] = [
  { label: 'Whole duplex', value: 'all' },
  { label: 'Lower floor', value: 0 },
  { label: 'Upper floor', value: 1 },
]

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/** A source-plan overview remains usable on phones and when WebGL is unavailable. */
export function FloorPlan({ level, highlighted }: { level: { label: string; rooms: Array<{
  name: string; x: number; z: number; w: number; l: number
}> }
  /** Room names to mark as selected (the tour's multi-select). */
  highlighted?: ReadonlySet<string>
}) {
  const rooms = level.rooms
  if (rooms.length === 0) return <section className="buyer-plan-section" aria-label={`${level.label} plan`}>
    <h3>{level.label}</h3><p>No rooms on this level.</p>
  </section>
  const minX = Math.min(...rooms.map((r) => r.x - r.w / 2))
  const maxX = Math.max(...rooms.map((r) => r.x + r.w / 2))
  const minZ = Math.min(...rooms.map((r) => r.z - r.l / 2))
  const maxZ = Math.max(...rooms.map((r) => r.z + r.l / 2))
  const width = Math.max(1, maxX - minX)
  const depth = Math.max(1, maxZ - minZ)

  return (
    <section className="buyer-plan-section" aria-label={`${level.label} plan`}>
      <h3>{level.label}</h3>
      <div className="buyer-plan" role="img" aria-label={`${level.label}: ${rooms.map((r) => r.name).join(', ')}`}>
        {rooms.map((room) => (
          <div
            key={room.name}
            className={highlighted?.has(room.name) ? 'buyer-plan-room selected' : 'buyer-plan-room'}
            style={{
              left: `${((room.x - room.w / 2 - minX) / width) * 100}%`,
              top: `${((room.z - room.l / 2 - minZ) / depth) * 100}%`,
              width: `${(room.w / width) * 100}%`,
              height: `${(room.l / depth) * 100}%`,
            }}
          >
            <span>{room.name}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/** Every user-visible string of a tour. Kept as data so one viewer can serve a
 *  private client preview and the public demo without either leaking the other's
 *  wording — the demo build must never ship a client's name. */
export interface HomeTourCopy {
  /** Shown after "Roomio /" in the header. */
  brand: string
  badge: string
  kicker: string
  heading: ReactNode
  intro: string
  area?: ReactNode
  note: string
  planCaption: string
  loadError: string
}

/**
 * Buyer-facing walkthrough of one registry home: floor switcher, 3D/plan toggle
 * and a room strip. `home.id` must be loadable by `openHome`; if it is not, the
 * stage shows `copy.loadError` instead of an empty canvas.
 */
export function HomeTour({ home, copy, homeHref = '/' }: {
  home: MultiLevelHome
  copy: HomeTourCopy
  /** Where the header mark links to. */
  homeHref?: string
}) {
  const [ready, setReady] = useState(false)
  const [showPlan, setShowPlan] = useState(() => !webglAvailable())
  const levelFilter = useHouseView((s) => s.levelFilter)
  const roomFilter = useHouseView((s) => s.roomFilter)
  const rooms = useHouse((s) => s.rooms)
  const houseLevels = useHouse((s) => s.levels)
  // The engine's flythrough controller, handed over by RoomView once the canvas is
  // up. A state setter is stable, which SceneBridge needs (it mounts once).
  const [walkCtl, setWalkCtl] = useState<FlythroughController | null>(null)
  const walking = useWalking(walkCtl)

  useEffect(() => {
    // The local fixture is the only input here. A future public route must load an
    // approved release manifest before exposing project claims or buyer actions.
    setReady(openHome(home.id))
    return () => {
      useHouseView.getState().setLevelFilter('all')
      // The view store outlives this page; a stale selection would hide rooms in
      // the editor's house view.
      useHouseView.getState().setRoomFilter([])
    }
  }, [home.id])

  const exitWalk = () => walkCtl?.closePanel()

  /**
   * First-person walkthrough. With `roomId` it starts in (or, while walking, jumps
   * to) that room; otherwise it starts at the front door facing into the home, the
   * way a visitor arrives — falling back to the living room if the home has no
   * identifiable entrance (entrance.ts). Every
   * room on every floor is shown first: the walker collides with ALL walls, so a
   * hidden room or storey would leave invisible walls to bump into, and the stairs
   * lead to the upper floor. Calling it while walking jumps to that room.
   */
  const startWalk = (roomId?: string) => {
    if (!walkCtl) return
    const view = useHouseView.getState()
    view.setMode('house')
    view.setRoomFilter([])
    view.setLevelFilter('all')
    setShowPlan(false)
    const picked = roomId ? rooms.find((r) => r.id === roomId) : undefined
    const door = picked ? null : entranceSpawn(rooms)
    if (door) return walkCtl.startWalk(door.at, door.face)
    const target = picked ?? rooms.find((r) => r.type === 'living') ?? rooms[0]
    // The room's storey elevation, so an upstairs room is reached upstairs.
    const floorCm = houseLevels[target?.level ?? 0]?.elevationCm ?? 0
    walkCtl.startWalk(target?.pos, undefined, floorCm)
  }

  // A floor choice starts a fresh view: keeping a selection from another floor
  // would intersect to nothing and show an empty scene.
  const selectLevel = (level: LevelFilter) => {
    exitWalk()
    const view = useHouseView.getState()
    view.setMode('house')
    view.setRoomFilter([])
    view.setLevelFilter(level)
  }

  // Room buttons are toggles: first press adds the room to the selection, second
  // press removes it. The 3D view shows only the selected rooms, in place, and
  // re-frames on them; an empty selection shows the whole floor/house again.
  // Stays in house mode — the single-room editor mode would show one room only.
  const toggleRoom = (id: string) => {
    // While walking, a room button means "take me there", not "show only this".
    if (walking) return startWalk(id)
    const view = useHouseView.getState()
    view.setMode('house')
    view.toggleRoomFilter(id)
    setShowPlan(false)
  }

  const clearSelection = () => useHouseView.getState().setRoomFilter([])

  const reset = () => {
    selectLevel('all')
    setShowPlan(false)
    // HouseCameraFit responds to fitNonce and frames the entire home after a
    // room close-up or orbit, without discarding the WebGL context.
    useStore.getState().fitView()
  }

  const visibleLevels = levelFilter === 'all'
    ? home.levels
    : home.levels.filter((_, index) => index === levelFilter)
  const selected = rooms.filter((room) => roomFilter.includes(room.id))
  const selectedNames = new Set(selected.map((room) => room.design.name))
  const floorPressed = (value: LevelFilter) => roomFilter.length === 0 && levelFilter === value

  return (
    <main className="buyer-viewer buyer-viewer--fit">
      <header className="buyer-header">
        <a className="buyer-mark" href={homeHref}>Roomio <span>/ {copy.brand}</span></a>
        <span className="buyer-preview">{copy.badge}</span>
      </header>
      <div className="buyer-body">
        <aside className="buyer-sidebar">
          <p className="buyer-kicker">{copy.kicker}</p>
          <h1>{copy.heading}</h1>
          <p className="buyer-intro">{copy.intro}</p>
          {copy.area && <p className="buyer-area">{copy.area}</p>}
          {/* A single-storey home has no floors to choose between: "Upper floor"
              would select an empty level and blank the stage. */}
          {home.levels.length > 1 && <div className="buyer-control-group" role="group" aria-label="Choose a floor">
            {viewOptions.map((option) => (
              <button
                key={option.label}
                className={floorPressed(option.value) ? 'selected' : ''}
                aria-pressed={floorPressed(option.value)}
                onClick={() => selectLevel(option.value)}
              >{option.label}</button>
            ))}
          </div>}
          <div className="buyer-control-group buyer-display" role="group" aria-label="Choose a view">
            <button className={!showPlan ? 'selected' : ''} aria-pressed={!showPlan} onClick={() => setShowPlan(false)}>3D view</button>
            <button className={showPlan ? 'selected' : ''} aria-pressed={showPlan} onClick={() => { exitWalk(); setShowPlan(true) }}>Floor plan</button>
          </div>
          {walking ? (
            <div className="buyer-walking">
              <p className="buyer-current-room">Walking through the home. Tap a room below to go there.</p>
              <button className="buyer-walk selected" onClick={exitWalk}>Exit walk</button>
            </div>
          ) : (
            <button className="buyer-walk" onClick={() => startWalk()} disabled={!walkCtl || !ready}>
              Walk through
            </button>
          )}
          {!walking && selected.length > 0 && <div className="buyer-selection">
            <p className="buyer-current-room">
              Showing {selected.length === 1 ? '1 room' : `${selected.length} rooms`}: {selected.map((room) => room.design.name).join(', ')}
            </p>
            <button className="buyer-clear" onClick={clearSelection}>Clear selection</button>
          </div>}
          <button className="buyer-reset" onClick={reset}>Reset view</button>
          <p className="buyer-note">{copy.note}</p>
        </aside>
        <section className="buyer-stage" aria-label="3D home view">
          {!ready ? (
            <div className="buyer-stage-message" role="alert">{copy.loadError}</div>
          ) : (
            <>
              {/* Keep the scene mounted when viewing the plan so switching back preserves its camera. */}
              <div className="buyer-canvas" hidden={showPlan}>
                <RoomView buyerMode onWalkController={setWalkCtl} />
                {walking && walkCtl && <WalkOverlay controller={walkCtl} onExit={exitWalk} />}
              </div>
              {showPlan && <div className="buyer-plans">
                <p>{copy.planCaption}</p>
                {visibleLevels.map((level) => <FloorPlan key={level.label} level={level} highlighted={selectedNames} />)}
              </div>}
            </>
          )}
        </section>
      </div>
      <nav className="buyer-rooms" aria-label={walking ? 'Go to a room' : 'Select rooms to show'}>
        <span>Rooms</span>
        {rooms.filter((room) => levelFilter === 'all' || room.level === levelFilter).map((room) => {
          const on = !walking && roomFilter.includes(room.id)
          return (
            <button key={room.id} className={on ? 'selected' : ''} aria-pressed={on} onClick={() => toggleRoom(room.id)}>
              <span className="buyer-check" aria-hidden="true">{walking ? '→' : on ? '✓' : '+'}</span>{room.design.name}
            </button>
          )
        })}
      </nav>
    </main>
  )
}
