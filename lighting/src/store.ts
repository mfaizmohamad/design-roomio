// Lighting store (zustand) — mirrors Agent A's store pattern. Holds the LightingState
// (time/north/sun/shadow + per-room lights) and the edit actions. Drop-in for the app:
// A's RoomView reads this via <LightingRig>; the harness reads it directly.

import { create } from 'zustand'
import type { Light, LightingState, Warmth } from './types'
import { makeDefaultLightingState } from './types'
import { createDefaultRoomLights, applyWarmth, type RoomLightInput } from './defaults'

export interface LightingStore extends LightingState {
  // time + north
  setTimeOfDay: (t: number) => void
  setNorthOffset: (deg: number) => void
  rotateNorth: (deltaDeg: number) => void
  reverseNorth: () => void
  toggleBar: (v?: boolean) => void
  toggleNorth: (v?: boolean) => void
  // light mode (presentation: lock furniture + hide editing hints)
  setLightMode: (v: boolean) => void
  toggleLightMode: (v?: boolean) => void
  // sun
  setSunEnabled: (v: boolean) => void
  setMaxElevation: (deg: number) => void
  // global flat-fill multiplier (window/daylight-only mode dims the always-on fill); 0..1, default 1
  fillScale: number
  setFillScale: (v: number) => void
  // rooms / lights
  ensureRoom: (input: RoomLightInput) => void
  setRoomLights: (roomId: string, lights: Light[]) => void
  setRoomWarmth: (roomId: string, warmth: Warmth) => void
  updateLight: (roomId: string, lightId: string, patch: Partial<Light>) => void
  addLight: (roomId: string, light: Light) => void
  removeLight: (roomId: string, lightId: string) => void
}

const wrap = (v: number) => ((v % 360) + 360) % 360

export const useLighting = create<LightingStore>((set) => ({
  ...makeDefaultLightingState(),
  fillScale: 1, // completed to unblock the shared build — Agent E, verify this matches your intent

  setTimeOfDay: (t) => set({ timeOfDay: Math.max(0, Math.min(1, t)) }),
  setNorthOffset: (deg) => set({ northOffsetDeg: wrap(deg) }),
  rotateNorth: (delta) => set((s) => ({ northOffsetDeg: wrap(s.northOffsetDeg + delta) })),
  reverseNorth: () => set((s) => ({ northOffsetDeg: wrap(s.northOffsetDeg + 180) })),
  toggleBar: (v) => set((s) => ({ barVisible: v ?? !s.barVisible })),
  toggleNorth: (v) => set((s) => ({ northVisible: v ?? !s.northVisible })),

  setLightMode: (v) => set({ lightMode: v }),
  toggleLightMode: (v) =>
    set((s) => {
      const lightMode = v ?? !s.lightMode
      // Entering light mode reveals the time bar so the lighting UI is right there;
      // leaving it does not force any panel state (toggles remain independent / L-10).
      return lightMode ? { lightMode, barVisible: true } : { lightMode }
    }),

  setSunEnabled: (v) => set((s) => ({ sun: { ...s.sun, enabled: v } })),
  setMaxElevation: (deg) => set((s) => ({ sun: { ...s.sun, maxElevationDeg: deg } })),
  setFillScale: (v) => set({ fillScale: Math.max(0, Math.min(1, v)) }),

  ensureRoom: (input) =>
    set((s) => {
      if (s.rooms[input.id]) return s
      return { rooms: { ...s.rooms, [input.id]: { lights: createDefaultRoomLights(input) } } }
    }),

  setRoomLights: (roomId, lights) =>
    set((s) => ({ rooms: { ...s.rooms, [roomId]: { lights } } })),

  setRoomWarmth: (roomId, warmth) =>
    set((s) => {
      const room = s.rooms[roomId]
      if (!room) return s
      return { rooms: { ...s.rooms, [roomId]: { lights: applyWarmth(room.lights, warmth) } } }
    }),

  updateLight: (roomId, lightId, patch) =>
    set((s) => {
      const room = s.rooms[roomId]
      if (!room) return s
      return {
        rooms: {
          ...s.rooms,
          [roomId]: {
            lights: room.lights.map((l) => (l.id === lightId ? { ...l, ...patch } : l)),
          },
        },
      }
    }),

  addLight: (roomId, light) =>
    set((s) => {
      const room = s.rooms[roomId] ?? { lights: [] }
      return { rooms: { ...s.rooms, [roomId]: { lights: [...room.lights, light] } } }
    }),

  removeLight: (roomId, lightId) =>
    set((s) => {
      const room = s.rooms[roomId]
      if (!room) return s
      return {
        rooms: { ...s.rooms, [roomId]: { lights: room.lights.filter((l) => l.id !== lightId) } },
      }
    }),
}))
