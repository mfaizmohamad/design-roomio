import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './store'
import { isDirty, markClean } from './dirty'
import type { RoomDesign } from './types'

// ---------------------------------------------------------------------------
// CODE-16 — dirty tracking for the active design. Editing marks dirty; loading /
// resetting a document (new id) or saving (markClean) reads clean; undoing back
// to the baseline reads clean again.
// ---------------------------------------------------------------------------

const sampleDesign = (id: string, name = 'Room'): RoomDesign => ({
  id,
  name,
  unit: 'ft',
  shape: 'rect',
  corners: [
    { x: 0, z: 0 },
    { x: 400, z: 0 },
    { x: 400, z: 300 },
    { x: 0, z: 300 },
  ],
  wallHeight: 270,
  wallThickness: 12,
  openings: [],
  materials: { wallColor: '#f4f1ea', floorTexture: 'oak' },
  furniture: [],
  createdAt: 1000,
  updatedAt: 2000,
})

// A fresh id per test: loading a NEW document id is exactly how the app resets
// the dirty baseline, and it keeps the module-level baseline isolated per test.
let seq = 0
beforeEach(() => {
  seq += 1
  useStore.getState().loadDesign(sampleDesign(`base-${seq}`))
})

describe('isDirty', () => {
  it('a freshly loaded design is clean', () => {
    expect(isDirty()).toBe(false)
  })

  it('editing the design (same id) marks it dirty', () => {
    useStore.getState().setName('Renamed')
    expect(isDirty()).toBe(true)
  })

  it('loading another document (new id) resets to clean', () => {
    useStore.getState().setName('Renamed')
    expect(isDirty()).toBe(true)
    useStore.getState().loadDesign(sampleDesign('other-doc'))
    expect(isDirty()).toBe(false)
  })

  it('resetDesign (blank room, new id) reads clean', () => {
    useStore.getState().setName('Renamed')
    expect(isDirty()).toBe(true)
    useStore.getState().resetDesign('rect')
    expect(isDirty()).toBe(false)
  })

  it('markClean() rebaselines the current design', () => {
    useStore.getState().setName('Renamed')
    expect(isDirty()).toBe(true)
    markClean()
    expect(isDirty()).toBe(false)
    useStore.getState().setName('Renamed again')
    expect(isDirty()).toBe(true)
  })

  it('undoing back to the baseline reads clean again', () => {
    useStore.getState().setShape('l') // undoable edit, changes signature
    expect(isDirty()).toBe(true)
    useStore.getState().undo()
    expect(isDirty()).toBe(false)
  })

  it('ignores camera-view changes (not a design edit)', () => {
    const cur = useStore.getState().design
    useStore.setState({ design: { ...cur, view: { cam: [9, 9, 9], target: [0, 0, 0] } } })
    expect(isDirty()).toBe(false)
  })
})
