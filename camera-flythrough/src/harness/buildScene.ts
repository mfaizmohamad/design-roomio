import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { SceneHandle, Colliders } from '../contract/sceneContract'
import { deriveWalls, makeFrame, bbox } from '../engine/geometry'
import { ROOM_CORNERS, WALL_HEIGHT, WALL_THICKNESS, FURNITURE, furnitureOBBs } from './room'

const CM = 0.01

/**
 * Builds the standalone dev-harness scene and returns a SceneHandle that
 * satisfies /shared/scene_contract.json exactly — so the flythrough engine
 * runs here identically to how it will run against Agent A's live R3F scene.
 */
export function buildScene(container: HTMLElement): {
  handle: SceneHandle
  orbit: OrbitControls
  userCamera: THREE.PerspectiveCamera
  /**
   * Run the render loop. onFrame(dt) returns the camera to render, `null` for
   * the user camera, or `false` to SKIP rendering this frame (e.g. while the
   * deterministic capture loop owns the canvas).
   */
  startLoop: (onFrame?: (dt: number) => THREE.Camera | null | false) => void
  stopLoop: () => void
} {
  const frame = makeFrame(ROOM_CORNERS)
  const b = bbox(ROOM_CORNERS)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#cdccc9')

  // --- renderer ---
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true, // matches A's Canvas; required for frame capture
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.appendChild(renderer.domElement)

  // --- user camera (mirrors RoomView default framing) ---
  const roomR = Math.max(b.w, b.d, 300) / 100
  const dist = roomR * 1.45
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200)
  camera.position.set(dist * 0.62, dist * 0.72, dist * 0.8)

  const orbit = new OrbitControls(camera, renderer.domElement)
  orbit.target.set(0, 0.7, 0)
  orbit.enableDamping = true
  orbit.dampingFactor = 0.13
  orbit.maxPolarAngle = Math.PI / 2.05
  orbit.update()

  // --- lights (mirror RoomView Lights) ---
  scene.add(new THREE.HemisphereLight('#ffffff', '#cfcbc2', 1.05))
  scene.add(new THREE.AmbientLight('#ffffff', 0.55))
  const key = new THREE.DirectionalLight('#ffffff', 1.35)
  key.position.set(7, 13, 8)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  const cam = key.shadow.camera as THREE.OrthographicCamera
  cam.left = -14
  cam.right = 14
  cam.top = 14
  cam.bottom = -14
  cam.near = 0.5
  cam.far = 48
  key.shadow.bias = -0.0004
  scene.add(key)
  const fill = new THREE.DirectionalLight('#ffffff', 0.45)
  fill.position.set(-9, 7, -7)
  scene.add(fill)

  // --- floor ---
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry((b.w / 100) * 1.02, (b.d / 100) * 1.02),
    new THREE.MeshStandardMaterial({ color: '#b8b2a6', roughness: 0.95 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)

  // --- walls (thin boxes per segment) ---
  const walls = deriveWalls(ROOM_CORNERS)
  const wallMat = new THREE.MeshStandardMaterial({ color: '#e7e3da', roughness: 0.92, side: THREE.DoubleSide })
  for (const w of walls) {
    const [ax, az] = frame.toWorld(w.a.x, w.a.z)
    const [bx, bz] = frame.toWorld(w.b.x, w.b.z)
    const len = Math.hypot(bx - ax, bz - az)
    const geo = new THREE.BoxGeometry(len, WALL_HEIGHT * CM, WALL_THICKNESS * CM)
    const mesh = new THREE.Mesh(geo, wallMat)
    mesh.position.set((ax + bx) / 2, (WALL_HEIGHT * CM) / 2, (az + bz) / 2)
    mesh.rotation.y = Math.atan2(bz - az, bx - ax) * -1
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)
  }

  // --- furniture (simple shadowed boxes; faithful footprint + height) ---
  for (const f of FURNITURE) {
    const group = new THREE.Group()
    const [wx, wz] = frame.toWorld(f.x, f.z)
    group.position.set(wx, 0, wz)
    group.rotation.y = f.rotation
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(f.w * CM, f.h * CM, f.d * CM),
      new THREE.MeshStandardMaterial({ color: f.color, roughness: 0.8 }),
    )
    body.position.y = (f.h * CM) / 2
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)
    scene.add(group)
  }

  // --- colliders (design cm; mirrors what A's getColliders will return) ---
  const colliders: Colliders = {
    walls,
    furniture: furnitureOBBs(),
    polygon: ROOM_CORNERS,
    wallThickness: WALL_THICKNESS,
    bounds: { minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ },
  }

  // --- resize ---
  function resize() {
    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resize()
  window.addEventListener('resize', resize)

  const handle: SceneHandle = {
    scene,
    renderer,
    camera,
    controls: orbit,
    domElement: renderer.domElement,
    get size() {
      return { width: renderer.domElement.clientWidth, height: renderer.domElement.clientHeight }
    },
    getColliders: () => colliders,
    frame: () => ({ cx: frame.cx, cz: frame.cz }),
  }

  let raf = 0
  let last = performance.now()
  function startLoop(onFrame?: (dt: number) => THREE.Camera | null | false) {
    last = performance.now()
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      const chosen = onFrame ? onFrame(dt) : null
      if (chosen === false) return // capture loop owns the canvas this frame
      const cameraToRender = chosen ?? camera
      if (cameraToRender === camera) orbit.update()
      renderer.render(scene, cameraToRender)
    }
    raf = requestAnimationFrame(tick)
  }
  function stopLoop() {
    cancelAnimationFrame(raf)
  }

  return { handle, orbit, userCamera: camera, startLoop, stopLoop }
}
