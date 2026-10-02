// Render-settings store (zustand) — mirrors Agent E's store pattern. Holds the live
// RenderSettings + transient hero-render state. The drop-in rig reads this; a <RenderControls>
// UI (G4) and the app both drive it.

import { create } from 'zustand'
import type {
  RenderSettings,
  RenderQuality,
  PartialRenderSettings,
  AOSettings,
  BloomSettings,
} from './types'
import { presetFor, DEFAULT_RENDER_SETTINGS, withOverrides } from './presets'

export interface RenderStore {
  settings: RenderSettings
  /** Scene electric lights on/off (task/accent room lights + emissive bulb glow). Ambient fill +
   *  sun/daylight remain, so "off" dims the room rather than going pitch black. Default on. */
  lightsOn: boolean
  /** Per-lamp overrides keyed by furniture id: `true` = that individual lamp is switched off.
   *  A lamp fixture is lit iff `lightsOn && !lampOff[id]` — the global toggle is the master
   *  (off = daylight mode, every lamp dark), this lets EACH lamp be turned off on its own. */
  lampOff: Record<string, boolean>
  /** True while a path-traced hero still is accumulating — suspends the raster post pipeline. */
  heroActive: boolean
  /** Accumulated path-trace samples (0..settings.heroRender.samples) — drives the progress UI. */
  heroSamples: number
  /** Whether the hero path tracer can run here (WebGL2 + float targets). Set by HeroRender. */
  heroSupported: boolean

  setQuality: (q: RenderQuality) => void
  setExposure: (e: number) => void
  /** Global IBL strength (scene.environmentIntensity). */
  setEnvIntensity: (i: number) => void
  setBloom: (patch: Partial<BloomSettings>) => void
  setAO: (patch: Partial<AOSettings>) => void
  setLightsOn: (b: boolean) => void
  toggleLights: () => void
  /** Turn an individual lamp (furniture id) off/on. */
  setLampOff: (id: string, off: boolean) => void
  toggleLamp: (id: string) => void
  setHeroEnabled: (b: boolean) => void
  setHeroActive: (b: boolean) => void
  setHeroSamples: (n: number) => void
  setHeroSupported: (b: boolean) => void
  /** Forward-compatible bulk patch (e.g. hydrating from a saved RenderSettings subset). */
  patch: (p: PartialRenderSettings) => void
}

export const useRender = create<RenderStore>((set) => ({
  settings: DEFAULT_RENDER_SETTINGS,
  lightsOn: true,
  lampOff: {},
  heroActive: false,
  heroSamples: 0,
  heroSupported: true,

  setQuality: (q) =>
    set((s) => {
      // Switching tier resets the post passes to the preset, but PRESERVES the user's
      // foundation tunings (tone-mapping exposure + IBL intensity — the E co-tune values),
      // so dropping to "low" for perf doesn't throw away a tuned exposure.
      const preset = presetFor(q)
      preset.toneMapping.exposure = s.settings.toneMapping.exposure
      preset.ibl.intensity = s.settings.ibl.intensity
      preset.materials = { ...s.settings.materials }
      return { settings: preset }
    }),

  setExposure: (e) =>
    set((s) => ({ settings: { ...s.settings, toneMapping: { ...s.settings.toneMapping, exposure: e } } })),

  setEnvIntensity: (i) =>
    set((s) => ({ settings: { ...s.settings, ibl: { ...s.settings.ibl, intensity: i } } })),

  setBloom: (p) =>
    set((s) => ({ settings: { ...s.settings, post: { ...s.settings.post, bloom: { ...s.settings.post.bloom, ...p } } } })),

  setAO: (p) =>
    set((s) => ({ settings: { ...s.settings, post: { ...s.settings.post, ao: { ...s.settings.post.ao, ...p } } } })),

  setHeroEnabled: (b) =>
    set((s) => ({ settings: { ...s.settings, heroRender: { ...s.settings.heroRender, enabled: b } } })),

  setLightsOn: (b) => set({ lightsOn: b }),
  toggleLights: () => set((s) => ({ lightsOn: !s.lightsOn })),
  setLampOff: (id, off) => set((s) => ({ lampOff: { ...s.lampOff, [id]: off } })),
  toggleLamp: (id) => set((s) => ({ lampOff: { ...s.lampOff, [id]: !s.lampOff[id] } })),
  setHeroActive: (b) => set(b ? { heroActive: true, heroSamples: 0 } : { heroActive: false }),
  setHeroSamples: (n) => set({ heroSamples: n }),
  setHeroSupported: (b) => set({ heroSupported: b }),

  patch: (p) => set((s) => ({ settings: withOverrides(s.settings, p) })),
}))
