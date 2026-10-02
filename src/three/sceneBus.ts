import type { SceneHandle } from '../../camera-flythrough/src/contract/sceneContract'

// Scene bus — mirrors cameraBus.ts. Publishes the live R3F scene/renderer so the
// flythrough engine (Agent B, /camera-flythrough) can attach to the REAL scene
// without a second renderer. Fulfils /shared/scene_contract.json. RoomView's
// <SceneBridge/> registers a handle on mount and clears it on unmount.

let handle: SceneHandle | null = null

export function setSceneHandle(h: SceneHandle | null) {
  handle = h
}

export function getSceneHandle(): SceneHandle | null {
  return handle
}

export type { SceneHandle }
