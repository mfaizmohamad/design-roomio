import * as THREE from 'three'

/**
 * All flythrough-authored objects (camera gizmo, waypoint markers, spline line)
 * live under ONE named group so teardown leaves the host scene exactly as found,
 * per /shared/scene_contract.json. Sub-modules add to named child groups.
 */
const OVERLAY_NAME = 'flythrough-overlay'

export function getOverlay(scene: THREE.Scene): THREE.Group {
  let g = scene.getObjectByName(OVERLAY_NAME) as THREE.Group | undefined
  if (!g) {
    g = new THREE.Group()
    g.name = OVERLAY_NAME
    scene.add(g)
  }
  return g
}

/** Get (or create) a named child group within the overlay for one sub-module. */
export function getOverlayChild(scene: THREE.Scene, name: string): THREE.Group {
  const overlay = getOverlay(scene)
  let g = overlay.getObjectByName(name) as THREE.Group | undefined
  if (!g) {
    g = new THREE.Group()
    g.name = name
    overlay.add(g)
  }
  return g
}

/** Recursively dispose geometries/materials under an object. */
export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = (mesh as THREE.Mesh).material
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else if (mat) (mat as THREE.Material).dispose()
  })
}

/** Remove + dispose the entire overlay (full teardown). */
export function clearOverlay(scene: THREE.Scene) {
  const g = scene.getObjectByName(OVERLAY_NAME)
  if (g) {
    disposeObject(g)
    scene.remove(g)
  }
}

/** Empty a named child group (dispose its contents) without removing the group. */
export function emptyGroup(group: THREE.Group) {
  for (let i = group.children.length - 1; i >= 0; i--) {
    const child = group.children[i]
    disposeObject(child)
    group.remove(child)
  }
}
