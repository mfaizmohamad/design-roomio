/**
 * Agent H — apply a derived PBR texture to a furniture model's target slot (T3 / brief §5).
 *
 * Walks a furniture group, picks the meshes for the requested slot (slot.ts), and binds the
 * maps onto a CLONE of each target material (so the archetype default is preserved for an
 * exact revert). Tiling density is item-level world-space: repeat = dominantFaceCm /
 * repeat_cm (so the pattern reads at true physical scale, the floor's areaCm precedent).
 *
 * Returns a handle with restore() — the reversible "revert to default" the brief requires.
 * NOTE: Roomio's FurnitureModel rebuilds materials in a useMemo on resize/recolor; in the
 * live app, re-call applyTextureToGroup after such a rebuild (coordinated with Agent A).
 */
import * as THREE from 'three'
import { selectSlotMeshes, type MeshDesc, type SlotSelectOptions } from './slot'
import { applyPbrMaps, type TextureSet } from './material'
import { applyTriplanar, needsTriplanar } from './triplanar'
import { dominantFaceCm, repeatFor } from '../pipeline/tiling'
import type { Slot } from '../contract'

export interface ApplyTextureOptions {
  slot: Slot
  /** the FurnitureItem.color (#rrggbb) — used by the no-role 'body' heuristic. */
  itemColorHex: string
  /** the FurnitureItem dimensions (cm) — drive world-space tiling density. */
  itemDimsCm: { w: number; d: number; h: number }
  /** cm spanned by one tile (user's tiling-density control). */
  repeatCm: number
  /** texture rotation (user control), degrees. */
  rotationDeg: number
  maps: TextureSet
  normalScale?: number
  slotOpts?: SlotSelectOptions
  /** 'auto' (default): triplanar only meshes with strongly non-uniform world scale (tub/cone).
   *  true: force triplanar on all slot meshes. false: never. */
  triplanar?: boolean | 'auto'
}

export interface AppliedHandle {
  targeted: number
  /** how many of the targeted meshes used the triplanar fallback. */
  triplanarCount: number
  repeat: { x: number; y: number }
  restore: () => void
}

function isStandardMesh(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh
  return (
    (m as unknown as { isMesh?: boolean }).isMesh === true &&
    !!m.material &&
    !Array.isArray(m.material) &&
    (m.material as THREE.Material).type === 'MeshStandardMaterial'
  )
}

export function collectStandardMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  root.traverse((o) => {
    if (isStandardMesh(o)) out.push(o)
  })
  return out
}

export function meshDescriptor(mesh: THREE.Mesh): MeshDesc {
  const mat = mesh.material as THREE.MeshStandardMaterial
  const role = (mesh.userData && (mesh.userData.role as Slot | undefined)) || undefined
  return {
    role,
    colorHex: '#' + mat.color.getHexString(),
    roughness: mat.roughness,
    metalness: mat.metalness,
  }
}

export function applyTextureToGroup(root: THREE.Object3D, o: ApplyTextureOptions): AppliedHandle {
  const { u, v } = dominantFaceCm(o.itemDimsCm.w, o.itemDimsCm.d, o.itemDimsCm.h)
  const repeatX = repeatFor(u, o.repeatCm)
  const repeatY = repeatFor(v, o.repeatCm)
  const tiling = { repeatX, repeatY, rotationDeg: o.rotationDeg, normalScale: o.normalScale }

  const meshes = collectStandardMeshes(root)
  const idxs = selectSlotMeshes(meshes.map(meshDescriptor), o.slot, o.itemColorHex, o.slotOpts)

  const triMode = o.triplanar ?? 'auto'
  const records: { mesh: THREE.Mesh; orig: THREE.MeshStandardMaterial; applied: THREE.MeshStandardMaterial }[] = []
  let triplanarCount = 0
  for (const i of idxs) {
    const mesh = meshes[i]
    const orig = mesh.material as THREE.MeshStandardMaterial
    const applied = orig.clone()
    applyPbrMaps(applied, o.maps, tiling)
    const useTri = triMode === true || (triMode === 'auto' && needsTriplanar(mesh))
    if (useTri) {
      applyTriplanar(applied, o.repeatCm)
      triplanarCount++
    }
    mesh.material = applied
    records.push({ mesh, orig, applied })
  }

  return {
    targeted: records.length,
    triplanarCount,
    repeat: { x: repeatX, y: repeatY },
    restore: () => {
      for (const r of records) {
        r.mesh.material = r.orig
        r.applied.dispose()
      }
    },
  }
}
