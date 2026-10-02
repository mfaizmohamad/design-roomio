import { useEffect, useMemo, useState } from 'react'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { FurnitureAssetVersion } from './furniture'
import { fitMeasuredModel } from './modelDimensions'

const loaded = new Map<string, Promise<GLTF>>()

const load = (asset: FurnitureAssetVersion): Promise<GLTF> => {
  const cached = loaded.get(asset.id)
  if (cached) return cached
  const request = new GLTFLoader().loadAsync(asset.url)
  // A failed request can be retried after navigation/reload; never pin a rejected promise.
  loaded.set(asset.id, request)
  request.catch(() => loaded.delete(asset.id))
  return request
}

/** Renders one approved local GLB; returns a labeled fallback if it cannot load. */
export function FurnitureAsset3D({ asset, fallback }: { asset: FurnitureAssetVersion; fallback: JSX.Element }): JSX.Element {
  const [gltf, setGltf] = useState<GLTF | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    setGltf(null)
    setFailed(false)
    load(asset).then(
      (next) => { if (active) setGltf(next) },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [asset])

  // Scene clone gives every placed item its own transforms without duplicating
  // texture/geometry resources. Shared immutable materials are never recolored.
  const scene = useMemo(() => gltf?.scene.clone(true) ?? null, [gltf])
  useEffect(() => {
    if (!scene) return
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true
        object.receiveShadow = true
      }
    })
  }, [scene])
  if (!scene) return <group>{fallback}{failed && <Html center position={[0, asset.boundsCm.h / 100 + 0.2, 0]}><span style={{ whiteSpace: 'nowrap', color: '#fff', background: '#7d3535', padding: '3px 7px', borderRadius: 4, fontSize: 11 }}>Model unavailable · illustrative substitute</span></Html>}</group>

  // Private imports have reviewed physical measurements but no trusted mesh
  // bounds in the manifest. Fit their actual GLB footprint uniformly inside
  // those dimensions; never stretch a recognisable product independently per
  // axis or trust a client-provided source-bound placeholder.
  const source = asset.status === 'approved'
    ? new THREE.Box3().setFromObject(scene)
    : new THREE.Box3(
      new THREE.Vector3(...asset.sourceBoundsM.min),
      new THREE.Vector3(...asset.sourceBoundsM.max),
    )
  const size = source.getSize(new THREE.Vector3())
  const reviewedScale = asset.status === 'approved'
    ? fitMeasuredModel({ w: size.x, d: size.z, h: size.y }, asset.boundsCm)
    : 1
  // A skinny or over-wide GLB should not be sold as an exact measured product.
  // Uniform scaling fits one axis; require the other two to agree as well.
  if (reviewedScale === null) {
    return <group>{fallback}<Html center position={[0, asset.boundsCm.h / 100 + 0.2, 0]}>
      <span style={{ whiteSpace: 'nowrap', color: '#fff', background: '#7d3535', padding: '3px 7px', borderRadius: 4, fontSize: 11 }}>
        Model dimensions unverified · illustrative substitute
      </span>
    </Html></group>
  }
  const scale = reviewedScale
  const centerX = (source.min.x + source.max.x) / 2
  const centerZ = (source.min.z + source.max.z) / 2
  // The source is glTF meters/Y-up. Center the footprint and ground its base;
  // do not non-uniformly stretch a recognizable chair to fit arbitrary edits.
  return <primitive object={scene} scale={scale}
    position={[-centerX * scale, -source.min.y * scale, -centerZ * scale]} />
}
