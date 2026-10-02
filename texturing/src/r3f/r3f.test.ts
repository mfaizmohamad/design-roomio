import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { selectSlotMeshes, isPrimaryBody, lightnessRatio, type MeshDesc } from './slot'
import { applyPbrMaps, tuneTexture, snapshotMaterial, restoreMaterial } from './material'
import { applyTextureToGroup, collectStandardMeshes } from './applyTexture'
import { applyTriplanar, needsTriplanar } from './triplanar'

// Faithful replica of A's shade(hex, factor): perturb HSL lightness via THREE.Color.
function shade(hex: string, factor: number): string {
  const c = new THREE.Color(hex)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * factor)))
  return '#' + c.getHexString()
}

const ITEM = '#9a7b5c' // a tan upholstery/wood color
const METAL = '#8a8a8a'
const GLASS = '#1c2226'

function dataTex(): THREE.DataTexture {
  return new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat)
}

describe('slot targeting (no role tags → color heuristic)', () => {
  it('sofa: body + cushions textured, legs/metal excluded', () => {
    const descs: MeshDesc[] = [
      { colorHex: ITEM, roughness: 0.8, metalness: 0 }, // seat base (body)
      { colorHex: ITEM, roughness: 0.8, metalness: 0 }, // backrest (body)
      { colorHex: shade(ITEM, 1.12), roughness: 0.85, metalness: 0 }, // cushion
      { colorHex: shade(ITEM, 0.45), roughness: 0.4, metalness: 0.3 }, // foot (metal-ish, dark)
    ]
    const sel = selectSlotMeshes(descs, 'body', ITEM)
    expect(sel).toEqual([0, 1, 2]) // body + cushion, NOT the foot
  })

  it('table: top textured, the four wooden legs excluded', () => {
    const descs: MeshDesc[] = [
      { colorHex: ITEM, roughness: 0.45, metalness: 0 }, // top
      { colorHex: shade(ITEM, 0.55), roughness: 0.5, metalness: 0 }, // leg
      { colorHex: shade(ITEM, 0.55), roughness: 0.5, metalness: 0 }, // leg
      { colorHex: shade(ITEM, 0.55), roughness: 0.5, metalness: 0 }, // leg
      { colorHex: shade(ITEM, 0.55), roughness: 0.5, metalness: 0 }, // leg
    ]
    expect(selectSlotMeshes(descs, 'body', ITEM)).toEqual([0])
  })

  it('metal and glass accents are never body', () => {
    expect(isPrimaryBody({ colorHex: METAL, roughness: 0.3, metalness: 0.7 }, ITEM)).toBe(false)
    expect(isPrimaryBody({ colorHex: GLASS, roughness: 0.06, metalness: 0.7 }, ITEM)).toBe(false)
    expect(isPrimaryBody({ colorHex: ITEM, roughness: 0.8, metalness: 0 }, ITEM)).toBe(true)
  })

  it('lightness ratio (not RGB distance) separates legs from body for dark, pale AND saturated colors', () => {
    for (const item of ['#9a7b5c', '#c0392b', '#efe9e0', '#3a4a5a']) {
      // legs (shade 0.45–0.55) fall below the body band; cushion/top stay inside it
      expect(lightnessRatio(shade(item, 0.45), item)).toBeLessThan(0.75)
      expect(lightnessRatio(shade(item, 0.55), item)).toBeLessThan(0.75)
      expect(lightnessRatio(shade(item, 1.12), item)).toBeGreaterThanOrEqual(0.9)
      expect(lightnessRatio(shade(item, 0.85), item)).toBeGreaterThanOrEqual(0.75)
      // a table (top + 4 legs + a cushion-shade) → top + cushion textured, legs excluded
      const descs: MeshDesc[] = [
        { colorHex: item, roughness: 0.45, metalness: 0 }, // top
        { colorHex: shade(item, 0.55), roughness: 0.5, metalness: 0 }, // leg
        { colorHex: shade(item, 1.12), roughness: 0.85, metalness: 0 }, // a lighter shade
      ]
      expect(selectSlotMeshes(descs, 'body', item)).toEqual([0, 2])
    }
  })
})

describe('slot targeting (role tags → precise)', () => {
  it('roles win over color: a same-color leg tagged metal is excluded; a recolored body is included', () => {
    const descs: MeshDesc[] = [
      { role: 'body', colorHex: '#ffffff', roughness: 0.8, metalness: 0 }, // body even if odd color
      { role: 'metal', colorHex: ITEM, roughness: 0.5, metalness: 0 }, // metal even if item-colored
      { role: 'cushion', colorHex: ITEM, roughness: 0.85, metalness: 0 },
    ]
    expect(selectSlotMeshes(descs, 'body', ITEM)).toEqual([0, 2]) // body + cushion (roles)
    expect(selectSlotMeshes(descs, 'metal', ITEM)).toEqual([1])
  })
})

describe('material assembly (PBR conventions)', () => {
  it('binds maps with correct color spaces, wrapping, tiling, roughness=1, metalness=0', () => {
    const mat = new THREE.MeshStandardMaterial({ color: ITEM, roughness: 0.8, metalness: 0 })
    applyPbrMaps(
      mat,
      { map: dataTex(), roughnessMap: dataTex(), normalMap: dataTex() },
      { repeatX: 5, repeatY: 3, rotationDeg: 30, normalScale: 0.8 },
    )
    expect(mat.map!.colorSpace).toBe(THREE.SRGBColorSpace) // albedo sRGB
    expect(mat.roughnessMap!.colorSpace).toBe(THREE.NoColorSpace) // data map linear
    expect(mat.normalMap!.colorSpace).toBe(THREE.NoColorSpace)
    expect(mat.map!.wrapS).toBe(THREE.RepeatWrapping)
    expect(mat.map!.repeat.x).toBe(5)
    expect(mat.map!.repeat.y).toBe(3)
    expect(mat.map!.rotation).toBeCloseTo((30 * Math.PI) / 180, 6)
    expect(mat.roughness).toBe(1) // map drives roughness
    expect(mat.metalness).toBe(0) // dielectric
    expect(mat.normalScale.x).toBe(0.8)
  })

  it('snapshot + restore round-trips the material to its default', () => {
    const mat = new THREE.MeshStandardMaterial({ color: ITEM, roughness: 0.8, metalness: 0 })
    const snap = snapshotMaterial(mat)
    applyPbrMaps(mat, { map: dataTex(), roughnessMap: dataTex() }, { repeatX: 4, repeatY: 4, rotationDeg: 0 })
    expect(mat.map).not.toBeNull()
    restoreMaterial(mat, snap)
    expect(mat.map).toBeNull()
    expect(mat.roughnessMap).toBeNull()
    expect(mat.roughness).toBe(0.8)
  })

  it('tuneTexture sets anisotropy and centered rotation', () => {
    const t = tuneTexture(dataTex(), 'linear', { repeatX: 2, repeatY: 2, rotationDeg: 90 })
    expect(t.anisotropy).toBe(8)
    expect(t.center.x).toBe(0.5)
    expect(t.center.y).toBe(0.5)
  })
})

describe('apply to a furniture group + revert', () => {
  function makeSofa(): THREE.Group {
    const g = new THREE.Group()
    const mk = (hex: string, rough: number, metal: number, role?: string) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal }),
      )
      if (role) m.userData.role = role
      return m
    }
    g.add(mk(ITEM, 0.8, 0)) // body
    g.add(mk(shade(ITEM, 1.12), 0.85, 0)) // cushion
    g.add(mk(shade(ITEM, 0.45), 0.4, 0.3)) // foot
    // a non-standard mesh (basic material) must be ignored
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
    return g
  }

  it('textures the body+cushion meshes, leaves the foot and basic mesh untouched, and reverts', () => {
    const sofa = makeSofa()
    expect(collectStandardMeshes(sofa).length).toBe(3) // basic-material mesh excluded
    const footMat = (sofa.children[2] as THREE.Mesh).material as THREE.MeshStandardMaterial
    const origFootMatId = footMat.uuid

    const handle = applyTextureToGroup(sofa, {
      slot: 'body',
      itemColorHex: ITEM,
      itemDimsCm: { w: 210, d: 95, h: 80 },
      repeatCm: 40,
      rotationDeg: 0,
      maps: { map: dataTex(), roughnessMap: dataTex(), normalMap: dataTex() },
    })

    expect(handle.targeted).toBe(2) // body + cushion
    expect(handle.repeat.x).toBeCloseTo(210 / 40) // world-space tiling from the dominant face
    expect(handle.repeat.y).toBeCloseTo(95 / 40)
    expect(((sofa.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).map).not.toBeNull()
    expect(((sofa.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial).map).not.toBeNull()
    // foot untouched (same material instance, no map)
    expect(((sofa.children[2] as THREE.Mesh).material as THREE.MeshStandardMaterial).uuid).toBe(origFootMatId)
    expect(((sofa.children[2] as THREE.Mesh).material as THREE.MeshStandardMaterial).map).toBeNull()

    handle.restore()
    expect(((sofa.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).map).toBeNull()
    expect(((sofa.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial).map).toBeNull()
  })
})

describe('triplanar fallback (H1 safety net)', () => {
  it('needsTriplanar flags strongly non-uniform scale + an explicit userData flag, not uniform boxes', () => {
    const uniform = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
    uniform.updateWorldMatrix(true, false)
    expect(needsTriplanar(uniform)).toBe(false)

    const tub = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16), new THREE.MeshStandardMaterial())
    tub.scale.set(3, 1, 1.2) // anisotropic ellipse fake (like buildTubFreestanding)
    tub.updateWorldMatrix(true, false)
    expect(needsTriplanar(tub)).toBe(true)

    const flagged = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
    flagged.userData.triplanar = true
    expect(needsTriplanar(flagged)).toBe(true)
  })

  it('applyTriplanar injects world-space sampling into the shader (mock compile)', () => {
    const mat = new THREE.MeshStandardMaterial()
    applyTriplanar(mat, 40)
    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      vertexShader: 'void main(){\n#include <begin_vertex>\n}',
      fragmentShader: 'void main(){\n#include <map_fragment>\n#include <roughnessmap_fragment>\n}',
    }
    mat.onBeforeCompile!(shader as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as never)
    expect(shader.fragmentShader).toContain('triSample(map)')
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>')
    expect(shader.vertexShader).toContain('vTriPos')
    expect(shader.uniforms.uTriScale.value).toBeCloseTo(100 / 40)
    expect(typeof mat.customProgramCacheKey!()).toBe('string')
  })

  it('applyTextureToGroup auto-triplanars an anisotropic mesh, not the flat sofa boxes', () => {
    const g = new THREE.Group()
    const tub = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 16),
      new THREE.MeshStandardMaterial({ color: ITEM, roughness: 0.6, metalness: 0 }),
    )
    tub.scale.set(2.4, 1, 1) // anisotropic
    g.add(tub)
    const handle = applyTextureToGroup(g, {
      slot: 'body',
      itemColorHex: ITEM,
      itemDimsCm: { w: 160, d: 70, h: 55 },
      repeatCm: 40,
      rotationDeg: 0,
      maps: { map: dataTex(), roughnessMap: dataTex() },
    })
    expect(handle.targeted).toBe(1)
    expect(handle.triplanarCount).toBe(1) // the tub got triplanar
    expect((tub.material as THREE.MeshStandardMaterial).onBeforeCompile).toBeTruthy()
    handle.restore()
  })
})
