import { beforeEach, describe, expect, it } from 'vitest'
import { useHouse } from './three/houseSession'
import { useHouseView } from './three/houseViewMode'
import { useLighting } from '../lighting/src/store'
import { makeDefaultLightingState } from '../lighting/src/types'
import { useStore, newDesign } from './store'
import { saveDesign, loadDesign } from './persistence'
import { isDirty, markClean } from './dirty'

class MemoryStorage {
  private data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
}

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
  useHouse.setState({ rooms: [], activeId: null, documentId: null, documentName: null,
    documentCreatedAt: null, homeId: null, levels: [], lastRemoved: null })
  useStore.getState().loadDesign(newDesign('rect'))
  useLighting.setState({ ...makeDefaultLightingState(), fillScale: 1 })
  useHouseView.setState({ mode: 'room', levelFilter: 'all' })
  markClean()
})

describe('whole-home save and reopen', () => {
  it('round-trips Embercrest across a fresh session with room edits, floors, light, and camera', () => {
    expect(useHouse.getState().loadHome('embercrest')).toBe(true)
    const rooms = useHouse.getState().rooms
    expect(new Set(rooms.map((r) => r.level))).toEqual(new Set([0, 1]))
    const upper = rooms.find((r) => r.level === 1)!
    useHouse.getState().switchRoom(upper.id)
    useStore.getState().setName('Edited upstairs room')
    useHouse.getState().moveRoom(upper.id, { x: upper.pos!.x + 20, z: upper.pos!.z })
    useLighting.getState().setTimeOfDay(0.83)
    useLighting.getState().setRoomLights(upper.id, [{ id: 'buyer-light', type: 'pendant',
      layer: 'accent', color: '#ffeecc', intensity: 0.7, pos: [1, 2, 1] }])
    useHouseView.setState({ mode: 'house', levelFilter: 1 })
    const camera = { cam: [4, 3, 5] as [number, number, number],
      target: [0, 1, 0] as [number, number, number] }
    const saved = useHouse.getState().snapshotDesign(camera)
    saveDesign(saved)
    const id = saved.id
    const originalRooms = saved.house!.rooms

    // Mimic a hard reload: in-memory editor/session state is gone; only storage remains.
    useHouse.setState({ rooms: [], activeId: null, documentId: null, homeId: null,
      levels: [], lastRemoved: null })
    useStore.getState().loadDesign(newDesign('rect'))
    useLighting.setState({ ...makeDefaultLightingState(), fillScale: 1 })
    useHouseView.setState({ mode: 'room', levelFilter: 'all' })

    const reopened = loadDesign(id)!
    useHouse.getState().loadSavedDesign(reopened)
    // JSON storage normalizes undefined properties and negative zero.
    expect(JSON.parse(JSON.stringify(useHouse.getState().rooms))).toEqual(JSON.parse(JSON.stringify(originalRooms)))
    expect(useHouse.getState().levels).toEqual(saved.house!.levels)
    expect(useHouse.getState().homeId).toBe('embercrest')
    expect(useHouse.getState().activeId).toBe(upper.id)
    expect(useStore.getState().design.name).toBe('Edited upstairs room')
    expect(useStore.getState().design.view).toEqual(camera)
    expect(useLighting.getState().timeOfDay).toBe(0.83)
    expect(useLighting.getState().rooms[upper.id].lights[0].id).toBe('buyer-light')
    expect(useHouseView.getState()).toMatchObject({ mode: 'house', levelFilter: 1 })
    expect(useHouse.getState().snapshotDesign().id).toBe(id)
  })

  it('keeps legacy single-room designs openable and does not retain an old house', () => {
    useHouse.getState().loadHome('embercrest')
    const legacy = newDesign('rect')
    useHouse.getState().loadSavedDesign(legacy)
    expect(useHouse.getState().rooms).toHaveLength(1)
    expect(useHouse.getState().snapshotDesign().house!.rooms).toHaveLength(1)
    expect(useStore.getState().design.id).toBe(legacy.id)
  })

  it('tracks edits to other rooms and ignores room switching alone', () => {
    useHouse.getState().loadHome('embercrest')
    markClean()
    const { rooms, activeId } = useHouse.getState()
    const other = rooms.find((r) => r.id !== activeId && r.level === 0)!
    useHouse.getState().switchRoom(other.id)
    expect(isDirty()).toBe(false)
    useHouse.getState().moveRoom(other.id, { x: other.pos!.x + 30, z: other.pos!.z })
    expect(isDirty()).toBe(true)
    useHouse.getState().switchRoom(activeId!)
    expect(isDirty()).toBe(true)
    markClean()
    expect(isDirty()).toBe(false)
  })
})
