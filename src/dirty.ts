// CODE-16: unsaved-changes ("dirty") tracking for the active room design.
//
// This is deliberately EXTERNAL to the design store (store.ts): it subscribes to
// the store from the outside so the wizard-data lane's store stays untouched.
//
// How it decides dirty vs clean:
//   • A design edit produces a NEW `design` object with the SAME `id`. We compare
//     a content signature against the last clean baseline — different ⇒ dirty.
//   • Loading / resetting / switching to another document swaps in a design with a
//     DIFFERENT `id` (loadDesign / resetDesign / loadPreset / room switch all mint
//     or load a fresh id). That's a new document, so it becomes the clean baseline.
//   • Undo/redo restore historical snapshots of the SAME id, so they compare by
//     content: undoing back to the baseline reads clean again, redoing away is dirty.
//
// `view` (camera) and `updatedAt` are excluded from the signature: orbiting the
// camera or a timestamp bump is not an "unsaved change" worth warning about.

import { create } from 'zustand'
import { useStore } from './store'
import { useHouse } from './three/houseSession'
import { useLighting } from '../lighting/src/store'
import type { RoomDesign } from './types'

function signature(d: RoomDesign): string {
  // Exclude camera view + timestamps; compare only meaningful design content.
  const { view: _view, updatedAt: _updatedAt, createdAt: _createdAt, ...rest } = d
  return JSON.stringify(rest)
}

let baselineId = useStore.getState().design.id
let baselineSig = signature(useStore.getState().design)

function houseSignature(): string | null {
  const house = useHouse.getState()
  const active = useStore.getState().design
  if (house.activeId !== active.id || house.rooms.length < 2) return null
  const light = useLighting.getState()
  return JSON.stringify({
    documentId: house.documentId, homeId: house.homeId, levels: house.levels,
    rooms: house.rooms.map((r) => ({
      id: r.id, type: r.type, pos: r.pos, level: r.level,
      design: signature(r.id === active.id ? active : r.design),
    })),
    lighting: {
      timeOfDay: light.timeOfDay, northOffsetDeg: light.northOffsetDeg,
      sun: light.sun, shadow: light.shadow, rooms: light.rooms, fillScale: light.fillScale,
    },
  })
}

let baselineHouseSig = houseSignature()
let baselineDocumentId = useHouse.getState().documentId

interface DirtyState {
  dirty: boolean
}

export const useDirty = create<DirtyState>(() => ({ dirty: false }))

/** True when the active design has unsaved edits since it was loaded/reset/saved. */
export function isDirty(): boolean {
  return useDirty.getState().dirty || houseSignature() !== baselineHouseSig
}

/** Mark the current design as the clean baseline (called after save or an
 *  acknowledged discard). */
export function markClean(): void {
  const d = useStore.getState().design
  baselineId = d.id
  baselineSig = signature(d)
  baselineHouseSig = houseSignature()
  baselineDocumentId = useHouse.getState().documentId
  if (useDirty.getState().dirty) useDirty.setState({ dirty: false })
}

function recompute(d: RoomDesign): void {
  const next = signature(d) !== baselineSig
  if (next !== useDirty.getState().dirty) useDirty.setState({ dirty: next })
}

// Expose for debugging / verification in dev.
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  ;(window as unknown as { __dirty?: unknown }).__dirty = { isDirty, markClean, useDirty }
}

// Watch the store for design changes.
useStore.subscribe((s, prev) => {
  if (s.design === prev.design) return
  if (s.design.id !== baselineId) {
    // A different document was loaded/reset — it starts clean.
    baselineId = s.design.id
    baselineSig = signature(s.design)
    // A room switch keeps the same house document id, so retain its baseline.
    // A newly loaded home changes that id and starts with its own clean baseline.
    const documentId = useHouse.getState().documentId
    if (documentId !== baselineDocumentId || useHouse.getState().activeId !== s.design.id) {
      baselineDocumentId = documentId
      baselineHouseSig = houseSignature()
    }
    if (useDirty.getState().dirty) useDirty.setState({ dirty: false })
    return
  }
  recompute(s.design)
})
