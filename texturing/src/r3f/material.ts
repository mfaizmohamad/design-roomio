/**
 * Agent H — assemble a PBR MeshStandardMaterial from derived maps (T3 / brief §4c-§5).
 * THREE-only (no canvas), so it constructs and is testable in node. The browser turns an
 * RGBAImage into a THREE.Texture in createTexture.ts; here we tune textures + bind them to
 * a material with the published conventions (pbr_conventions.json, G-ratified):
 *   - albedo .map = SRGBColorSpace; roughnessMap/normalMap = linear (NoColorSpace)
 *   - all maps RepeatWrapping + the SAME repeat/rotation (registered) + anisotropy 8
 *   - material.roughness = 1 (the map fully drives roughness); metalness = 0 (dielectric)
 *   - normal is +Y/OpenGL (uploaded flipY=true via CanvasTexture)
 */
import * as THREE from 'three'

export interface TextureSet {
  map?: THREE.Texture
  roughnessMap?: THREE.Texture
  normalMap?: THREE.Texture
}

export interface TilingParams {
  repeatX: number
  repeatY: number
  rotationDeg: number
  anisotropy?: number
}

const ANISO = 8

/** Configure wrap/colorSpace/repeat/rotation/anisotropy on one texture (in place). */
export function tuneTexture(
  tex: THREE.Texture,
  colorSpace: 'srgb' | 'linear',
  t: TilingParams,
): THREE.Texture {
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.repeat.set(t.repeatX, t.repeatY)
  tex.center.set(0.5, 0.5)
  tex.rotation = (t.rotationDeg * Math.PI) / 180
  tex.anisotropy = t.anisotropy ?? ANISO
  tex.needsUpdate = true
  return tex
}

export interface PbrApplyParams extends TilingParams {
  /** normal relief strength (THREE.Vector2). Default subtle 1.0. */
  normalScale?: number
}

/**
 * Bind the derived maps onto a MeshStandardMaterial with the H conventions. Mutates `mat`.
 * Leaves `mat.color` as the fallback/tint (so an unresolvable texture degrades to color).
 */
export function applyPbrMaps(mat: THREE.MeshStandardMaterial, maps: TextureSet, p: PbrApplyParams): void {
  if (maps.map) {
    tuneTexture(maps.map, 'srgb', p)
    mat.map = maps.map
  }
  if (maps.roughnessMap) {
    tuneTexture(maps.roughnessMap, 'linear', p)
    mat.roughnessMap = maps.roughnessMap
    mat.roughness = 1 // map fully drives roughness (three multiplies roughness * map)
  }
  if (maps.normalMap) {
    tuneTexture(maps.normalMap, 'linear', p)
    mat.normalMap = maps.normalMap
    const s = p.normalScale ?? 1
    mat.normalScale = new THREE.Vector2(s, s)
  }
  mat.metalness = 0 // dielectric fabric/wood (G owns envMapIntensity; we don't set it)
  mat.needsUpdate = true
}

/** Snapshot of the material fields applyPbrMaps touches, for exact revert. */
export interface MaterialSnapshot {
  map: THREE.Texture | null
  roughnessMap: THREE.Texture | null
  normalMap: THREE.Texture | null
  roughness: number
  metalness: number
  normalScale: THREE.Vector2
}

export function snapshotMaterial(mat: THREE.MeshStandardMaterial): MaterialSnapshot {
  return {
    map: mat.map,
    roughnessMap: mat.roughnessMap,
    normalMap: mat.normalMap,
    roughness: mat.roughness,
    metalness: mat.metalness,
    normalScale: mat.normalScale.clone(),
  }
}

export function restoreMaterial(mat: THREE.MeshStandardMaterial, snap: MaterialSnapshot): void {
  mat.map = snap.map
  mat.roughnessMap = snap.roughnessMap
  mat.normalMap = snap.normalMap
  mat.roughness = snap.roughness
  mat.metalness = snap.metalness
  mat.normalScale.copy(snap.normalScale)
  mat.needsUpdate = true
}
