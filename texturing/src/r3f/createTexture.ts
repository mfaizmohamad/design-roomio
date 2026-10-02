/**
 * Agent H — browser glue: RGBAImage → THREE.CanvasTexture (T3 upload boundary).
 * CanvasTexture defaults flipY=true, which is exactly what our image-space +Y normal map
 * needs (and what the albedo needs), matching src/three/textures.ts's CanvasTexture path.
 * colorSpace/wrap/repeat are (re)set by applyPbrMaps; we set sane defaults here too.
 *
 * Browser-only (uses document/canvas/ImageData) — verified in the harness, not node tests.
 */
import * as THREE from 'three'
import { type RGBAImage } from '../pipeline/image'
import { type ComposedTexture } from '../pipeline/compose'
import { type TextureSet } from './material'

function imageToCanvas(img: RGBAImage): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d')!
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
  return c
}

export function rgbaToTexture(img: RGBAImage, colorSpace: 'srgb' | 'linear'): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(imageToCanvas(img))
  tex.colorSpace = colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  // flipY stays true (CanvasTexture default) — correct for our +Y normal + albedo.
  tex.needsUpdate = true
  return tex
}

/** Build the three CanvasTextures (correct color spaces) from a composed texture. */
export function composedToTextureSet(c: ComposedTexture): TextureSet {
  return {
    map: rgbaToTexture(c.albedo, 'srgb'),
    roughnessMap: rgbaToTexture(c.roughness, 'linear'),
    normalMap: rgbaToTexture(c.normal, 'linear'),
  }
}

/** PNG data-URL encoder for the asset store (the ImageEncoder used in the browser). */
export function imageToDataUrl(img: RGBAImage): string {
  return imageToCanvas(img).toDataURL('image/png')
}
