import type { CameraView } from '../types'

// Tiny bus so the React UI (Wizard "Save") can read the live 3D camera view
// without coupling to the Three.js scene. RoomView registers a capturer on mount.

let capturer: () => CameraView | null = () => null

export function setViewCapturer(fn: () => CameraView | null) {
  capturer = fn
}

export function captureView(): CameraView | null {
  return capturer()
}

// Reverse direction: place the live camera at an exact view (works in BOTH
// single-room and whole-house mode — used by scripted screenshots/tours).
let applier: (view: CameraView) => void = () => {}

export function setViewApplier(fn: (view: CameraView) => void) {
  applier = fn
}

export function applyView(view: CameraView) {
  applier(view)
}
