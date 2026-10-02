// Procedural, self-contained environment textures for glazing realism (VIS-03 mirrors,
// VIS-07 windows). Both are built ONCE (module-level singletons) from a 2D canvas — no CDN,
// no renderer needed, no per-frame cost — so they work identically in-app, headless (verify),
// and in the path-traced beauty shot. Kept independent of Agent G's scene.environment so a
// mirror is NEVER a black void even if the realism layer / IBL is absent.
import * as THREE from 'three'

let skyBackdrop: THREE.CanvasTexture | null = null
let mirrorEnv: THREE.CanvasTexture | null = null

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/**
 * A believable daytime OUTDOORS seen through a window: cool blue-white zenith → pale horizon haze →
 * a warmer/greener treeline and muted greenery below. Used as the `map` of the backdrop plane that
 * <WindowExterior> parks just outside each aperture, AND as the emissive/base map of
 * WindowDaylight's lamps-off "sky" pane — so a window reads as a VIEW WITH DETAIL, not a white void.
 *
 * Every value is a MODERATE luminance: the brightest band (the hazy horizon) sits well under the
 * tone curve's clip and the bloom luminanceThreshold (~1.0) so the exterior never blows to a
 * featureless white slab. The canvas carries horizontal variation — soft cloud streaks in the sky
 * and dappled foliage at the treeline — so a window slice is never a flat gradient (this is what
 * breaks the highlight clipping that reads as amateur CGI).
 */
export function getSkyBackdropTexture(): THREE.Texture {
  if (skyBackdrop) return skyBackdrop
  const W = 128
  const H = 256
  const c = makeCanvas(W, H)
  const ctx = c.getContext('2d')!
  // Vertical sky→ground gradient (cool blue-white top, warmer green low). Kept a touch below the
  // previous authoring so nothing sits at the clip: the horizon haze peaks around #dfe7de, not white.
  // Colours are deliberately SATURATED at a moderate luminance so hue survives the composer's ACES
  // + the listing's lifted real-estate exposure (which otherwise washes a pale sky to near-white),
  // while the brightest band (the horizon haze) still sits under the 1.0 bloom threshold / clip.
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0.0, '#5e91cb') // cool blue zenith (saturated, not a white cap)
  g.addColorStop(0.4, '#86b4de') // sky
  g.addColorStop(0.58, '#b3d0e8') // pale sky near horizon
  g.addColorStop(0.66, '#dbe4d9') // hazy horizon band (brightest — still well under clip)
  g.addColorStop(0.7, '#a6bd96') // treeline begins
  g.addColorStop(0.82, '#7f9873') // greenery
  g.addColorStop(1.0, '#5f7757') // near-ground, greener low
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // Soft cloud streaks scattered through the upper sky — low-contrast so they add texture without
  // punching bright spots that would bloom. Drawn as horizontally-stretched translucent ellipses.
  ctx.save()
  const clouds = [
    [0.28, 0.16, 0.42, 0.055, 0.22],
    [0.7, 0.26, 0.5, 0.06, 0.18],
    [0.45, 0.36, 0.6, 0.05, 0.16],
    [0.14, 0.46, 0.34, 0.045, 0.14],
    [0.82, 0.5, 0.4, 0.04, 0.13],
  ]
  for (const [cx, cy, rw, rh, a] of clouds) {
    ctx.beginPath()
    ctx.ellipse(cx * W, cy * H, rw * W, rh * H, 0, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(247,250,252,${a})`
    ctx.filter = 'blur(2px)'
    ctx.fill()
  }
  ctx.restore()

  // Dappled foliage at the treeline/greenery — a scatter of darker + lighter green blobs so the
  // lower band reads as trees/hedge, not a flat swatch.
  ctx.save()
  const foliage = ['#7e9673', '#617a58', '#93a882', '#556b4d']
  let seed = 1337
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let i = 0; i < 90; i++) {
    const x = rnd() * W
    const y = (0.7 + rnd() * 0.3) * H
    const r = 3 + rnd() * 7
    ctx.beginPath()
    ctx.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2)
    ctx.fillStyle = foliage[(rnd() * foliage.length) | 0]
    ctx.globalAlpha = 0.35 + rnd() * 0.3
    ctx.fill()
  }
  ctx.restore()

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  skyBackdrop = tex
  return tex
}

/**
 * A soft equirectangular environment for reflective surfaces (the statement mirror): a bright
 * sky-to-floor gradient with a gentle warm "window" highlight near the horizon so the mirror
 * has something believable to catch. Set as the material's explicit `envMap` (mapping =
 * Equirectangular), which three samples directly — a near-mirror roughness needs no PMREM blur.
 */
export function getMirrorEnvTexture(): THREE.Texture {
  if (mirrorEnv) return mirrorEnv
  const w = 512
  const h = 256
  const c = makeCanvas(w, h)
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0.0, '#eef3f8') // zenith / bright ceiling
  g.addColorStop(0.34, '#dbe6f0') // cool upper sky
  g.addColorStop(0.5, '#f4f1ea') // bright horizon (wall / window band)
  g.addColorStop(0.62, '#d8d0c1') // warm wall
  g.addColorStop(0.85, '#a99a83') // lower wall
  g.addColorStop(1.0, '#7c6f5c') // wood floor
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  // Soft bright blob just above the horizon — reads as a window/light reflection.
  const rg = ctx.createRadialGradient(w * 0.62, h * 0.44, 4, w * 0.62, h * 0.44, w * 0.2)
  rg.addColorStop(0, 'rgba(255,255,255,0.7)')
  rg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = rg
  ctx.fillRect(0, 0, w, h)
  const tex = new THREE.CanvasTexture(c)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  mirrorEnv = tex
  return tex
}
