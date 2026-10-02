import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { FirstPersonWalk } from '../src/engine/firstPersonWalk'
import type { SceneHandle } from '../src/contract/sceneContract'

// Node has no DOM. PointerLockControls only needs addEventListener on the element
// and its ownerDocument; requestPointerLock is deliberately ABSENT (as on iOS).
function fakeHandle(): SceneHandle {
  const doc = new EventTarget()
  const el = Object.assign(new EventTarget(), { ownerDocument: doc, clientWidth: 800, clientHeight: 600 })
  return {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    controls: null,
    domElement: el as unknown as HTMLElement,
    size: { width: 800, height: 600 },
    frame: () => ({ cx: 0, cz: 0 }),
  } as unknown as SceneHandle
}

const forward = (w: FirstPersonWalk) => {
  const v = new THREE.Vector3()
  w.camera.getWorldDirection(v)
  return v
}

describe('FirstPersonWalk — buyer walkthrough additions', () => {
  // enable() listens for keyboard input on window; node has none.
  beforeAll(() => {
    vi.stubGlobal('window', new EventTarget())
  })

  it('starts at the given spot facing the given direction (front door → into the home)', () => {
    const w = new FirstPersonWalk(fakeHandle())
    w.enable({ x: 100, z: 200 }, undefined, { x: 1, z: 0 })
    expect(w.camera.position.x).toBeCloseTo(1)
    expect(w.camera.position.z).toBeCloseTo(2)
    const f = forward(w)
    expect(f.x).toBeCloseTo(1)
    expect(f.z).toBeCloseTo(0)
    expect(f.y).toBeCloseTo(0) // level gaze
  })

  it('on-screen forward key walks along the facing direction', () => {
    const w = new FirstPersonWalk(fakeHandle(), { speed: 2 })
    w.enable({ x: 0, z: 0 }, undefined, { x: 0, z: 1 })
    w.setVirtualKey('KeyW', true)
    w.update(0.5) // 2 m/s × 0.5 s = 1 m
    expect(w.camera.position.z).toBeCloseTo(1)
    expect(w.camera.position.x).toBeCloseTo(0)
    w.setVirtualKey('KeyW', false)
    w.update(0.5)
    expect(w.camera.position.z).toBeCloseTo(1) // released ⇒ stops
  })

  it('ignores virtual keys while walk mode is off', () => {
    const w = new FirstPersonWalk(fakeHandle())
    w.setVirtualKey('KeyW', true)
    w.enable({ x: 0, z: 0 })
    w.update(1)
    expect(w.camera.position.x).toBeCloseTo(0)
    expect(w.camera.position.z).toBeCloseTo(0)
  })

  it('drag-to-look turns, and pitch never flips past straight up/down', () => {
    const w = new FirstPersonWalk(fakeHandle())
    w.enable({ x: 0, z: 0 })
    const before = forward(w)
    w.look(200, 0)
    expect(forward(w).angleTo(before)).toBeGreaterThan(0.3)
    w.look(0, -100000) // drag far upward
    const e = new THREE.Euler().setFromQuaternion(w.camera.quaternion, 'YXZ')
    expect(e.x).toBeLessThan(Math.PI / 2)
    expect(e.x).toBeGreaterThan(Math.PI / 2 - 0.1)
  })

  it('teleport moves an active walker and is a no-op when inactive', () => {
    const w = new FirstPersonWalk(fakeHandle())
    w.teleport({ x: 500, z: 500 })
    expect(w.camera.position.x).toBeCloseTo(0)
    w.enable({ x: 0, z: 0 })
    w.teleport({ x: 300, z: -100 })
    expect(w.camera.position.x).toBeCloseTo(3)
    expect(w.camera.position.z).toBeCloseTo(-1)
  })

  it('teleports onto the requested storey where rooms overlap (Bedroom 3 is upstairs)', () => {
    const handle = fakeHandle()
    // Two storeys everywhere: floorAt answers the storey nearest the current one,
    // like houseLevels.floorHeightAt does for overlapping rooms.
    handle.floorAt = (_x, _z, current) => (current >= 150 ? 300 : 0)
    const w = new FirstPersonWalk(handle)
    w.enable({ x: 0, z: 0 })
    expect(w.camera.position.y).toBeCloseTo(1.6)
    w.teleport({ x: 100, z: 100 }, 300)
    expect(w.camera.position.y).toBeCloseTo(4.6) // 3 m storey + 1.6 m eye
    w.teleport({ x: 0, z: 0 }, 0)
    expect(w.camera.position.y).toBeCloseTo(1.6)
  })

  it('lock() does not throw where pointer lock is unsupported (iOS Safari)', () => {
    const w = new FirstPersonWalk(fakeHandle())
    w.enable({ x: 0, z: 0 })
    expect(() => w.lock()).not.toThrow()
  })
})
