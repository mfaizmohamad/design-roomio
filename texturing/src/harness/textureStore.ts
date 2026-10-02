/**
 * Agent H harness — preview/accept/revert orchestration (brief §5, T-6/T-8).
 * Holds the live furniture group refs and drives applyTextureToGroup imperatively from a
 * tiny store, mirroring the real-app transient-preview pattern (a texture is a SUGGESTION:
 * previewed → accepted → revertible to the archetype default, never auto-applied).
 */
import { create } from 'zustand'
import * as THREE from 'three'
import { composeTexture } from '../pipeline/compose'
import { syntheticFabricPhoto, syntheticWoodPhoto } from '../pipeline/synth'
import { composedToTextureSet } from '../r3f/createTexture'
import { applyTextureToGroup, type AppliedHandle } from '../r3f/applyTexture'
import { type TextureSet } from '../r3f/material'

export type Target = 'sofa' | 'table' | 'tub'
export type Mode = 'default' | 'preview' | 'accepted'

/** Faithful model dims (cm) + body color (must match the meshes in Furniture.tsx). */
export const ITEM_COLOR = '#9a7b5c'
export const DIMS: Record<Target, { w: number; d: number; h: number }> = {
  sofa: { w: 210, d: 95, h: 85 },
  table: { w: 120, d: 60, h: 45 },
  tub: { w: 160, d: 75, h: 58 },
}

// non-reactive registries
const groups: Record<Target, THREE.Group | null> = { sofa: null, table: null, tub: null }
const handles: Record<Target, AppliedHandle | null> = { sofa: null, table: null, tub: null }
const lastMaps: Record<Target, TextureSet | null> = { sofa: null, table: null, tub: null }

interface TexStore {
  target: Target
  repeatCm: number
  rotationDeg: number
  mode: Record<Target, Mode>
  lastTargeted: number
  lastRepeatX: number
  lastTriplanar: number
  setTarget: (t: Target) => void
  setRepeatCm: (n: number) => void
  setRotationDeg: (n: number) => void
  registerGroup: (t: Target, g: THREE.Group | null) => void
  applyFromPhoto: (kind: 'fabric' | 'wood') => void
  accept: () => void
  revert: () => void
}

function reapply(get: () => TexStore): AppliedHandle | null {
  const t = get().target
  const g = groups[t]
  const maps = lastMaps[t]
  if (!g || !maps) return null
  handles[t]?.restore()
  handles[t] = applyTextureToGroup(g, {
    slot: 'body',
    itemColorHex: ITEM_COLOR,
    itemDimsCm: DIMS[t],
    repeatCm: get().repeatCm,
    rotationDeg: get().rotationDeg,
    maps,
  })
  return handles[t]
}

export const useTextureStore = create<TexStore>((set, get) => ({
  target: 'sofa',
  repeatCm: 40,
  rotationDeg: 0,
  mode: { sofa: 'default', table: 'default', tub: 'default' },
  lastTargeted: 0,
  lastRepeatX: 0,
  lastTriplanar: 0,

  setTarget: (target) => set({ target }),

  setRepeatCm: (repeatCm) => {
    set({ repeatCm })
    if (get().mode[get().target] !== 'default') {
      const h = reapply(get)
      if (h) set({ lastRepeatX: h.repeat.x })
    }
  },
  setRotationDeg: (rotationDeg) => {
    set({ rotationDeg })
    if (get().mode[get().target] !== 'default') reapply(get)
  },

  registerGroup: (t, g) => {
    groups[t] = g
  },

  applyFromPhoto: (kind) => {
    const t = get().target
    const g = groups[t]
    if (!g) return
    const photo = kind === 'fabric' ? syntheticFabricPhoto([150, 95, 80]) : syntheticWoodPhoto([150, 110, 70])
    const composed = composeTexture(photo, {
      bbox: [16, 16, photo.width - 32, photo.height - 32],
      resultW: photo.width,
      resultH: photo.height,
      patchPx: 160,
      kind,
    })
    lastMaps[t] = composedToTextureSet(composed)
    handles[t]?.restore()
    const h = applyTextureToGroup(g, {
      slot: 'body',
      itemColorHex: ITEM_COLOR,
      itemDimsCm: DIMS[t],
      repeatCm: get().repeatCm,
      rotationDeg: get().rotationDeg,
      maps: lastMaps[t]!,
    })
    handles[t] = h
    set((s) => ({
      mode: { ...s.mode, [t]: 'preview' },
      lastTargeted: h.targeted,
      lastRepeatX: h.repeat.x,
      lastTriplanar: h.triplanarCount,
    }))
  },

  accept: () =>
    set((s) => ({ mode: { ...s.mode, [s.target]: s.mode[s.target] === 'preview' ? 'accepted' : s.mode[s.target] } })),

  revert: () => {
    const t = get().target
    handles[t]?.restore()
    handles[t] = null
    lastMaps[t] = null
    set((s) => ({ mode: { ...s.mode, [t]: 'default' } }))
  },
}))
