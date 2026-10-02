/**
 * Whole-house view mode (Agent E, multi-room). A tiny store so the viewport can
 * switch between editing ONE room and an overview of the whole interconnected
 * house. Separate from Agent C's houseSession so neither file depends on the other.
 */
import { create } from 'zustand'

export type ViewMode = 'room' | 'house'

interface HouseViewState {
  mode: ViewMode
  setMode: (m: ViewMode) => void
  toggle: () => void
  /** debug: draw the flythrough collision footprints as wireframes so you can SEE
   *  the otherwise-invisible walls — the standard way to test "invisible wall"
   *  collision bugs (verify colliders line up with the rendered geometry). */
  debugColliders: boolean
  toggleDebugColliders: () => void
  /** bump to snap the camera to a top-down 2D "plan" view (2D↔3D toggle). */
  planNonce: number
  requestPlanView: () => void
  /** Multi-storey houses: which storey(s) to show. 'all' stacks every level at
   *  its elevation (the default — the house as built); a level index isolates
   *  that storey for a clear view into it (upper floors otherwise roof the lower). */
  levelFilter: LevelFilter
  setLevelFilter: (f: LevelFilter) => void
  /** House mode: room ids to show on their own (in place, camera framed on them).
   *  Empty = no room filter. Intersects with levelFilter. */
  roomFilter: string[]
  setRoomFilter: (ids: string[]) => void
  toggleRoomFilter: (id: string) => void
}

/** `ids` with `id` added, or removed if it was already there (order kept). */
export const toggleId = (ids: readonly string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]

export type LevelFilter = 'all' | number

export const useHouseView = create<HouseViewState>((set) => ({
  mode: 'room',
  setMode: (mode) => set({ mode }),
  toggle: () => set((s) => ({ mode: s.mode === 'room' ? 'house' : 'room' })),
  debugColliders: false,
  toggleDebugColliders: () => set((s) => ({ debugColliders: !s.debugColliders })),
  planNonce: 0,
  requestPlanView: () => set((s) => ({ planNonce: s.planNonce + 1 })),
  levelFilter: 'all',
  setLevelFilter: (levelFilter) => set({ levelFilter }),
  roomFilter: [],
  setRoomFilter: (roomFilter) => set({ roomFilter }),
  toggleRoomFilter: (id) => set((s) => ({ roomFilter: toggleId(s.roomFilter, id) })),
}))
