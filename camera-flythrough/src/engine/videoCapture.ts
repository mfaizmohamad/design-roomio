import * as THREE from 'three'
import type { Playback } from './playback'

/**
 * F6 — Frame-by-frame video capture.
 *
 * NOT realtime. We do NOT use MediaRecorder/captureStream (they drop frames
 * under load → choppy, variable output). Instead: a deterministic step loop —
 *   setCameraAlongPath(t) → renderer.render() → await recorder.step()
 * decoupled from wall-clock time, so every frame is rendered and the output is
 * perfectly smooth regardless of render speed.
 *
 * Encoder: canvas-record's WebCodecs path (hardware-accelerated MP4). Requires
 * a secure context (HTTPS or localhost). If WebCodecs is unavailable canvas-record
 * transparently falls back to its bundled H264 (h264-mp4-encoder) WASM path — we
 * deliberately avoid ffmpeg.wasm. AVC caps frame size at ~9.4M px (a bit beyond
 * 4K@16:9); we clamp to that.
 */

const AVC_MAX_PIXELS = 9_400_000

export interface CaptureOpts {
  fps?: number
  /** export resolution; defaults to the canvas backing-store size */
  width?: number
  height?: number
  /**
   * Capture at the canvas's current backing size without touching the
   * renderer's size/pixelRatio. Use inside React-Three-Fiber, whose own loop
   * manages size — resizing mid-capture would fight it. (width/height ignored.)
   */
  noResize?: boolean
  /** auto-download the file when done (true for UI; false for tests) */
  download?: boolean
  filename?: string
  onProgress?: (frame: number, total: number) => void
}

export interface CaptureResult {
  buffer: ArrayBuffer | Uint8Array | Blob[] | undefined
  frames: number
  width: number
  height: number
  fps: number
  webcodecs: boolean
  filename: string
}

function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2)
}

export function webCodecsAvailable(): boolean {
  return typeof (globalThis as unknown as { VideoEncoder?: unknown }).VideoEncoder === 'function'
}

/**
 * Render the full flythrough (incl. dwell) frame-by-frame and encode to MP4.
 * Restores the renderer size + camera aspect afterward. Returns the encoded buffer.
 */
export async function captureFlythrough(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  recordingCamera: THREE.PerspectiveCamera,
  playback: Playback,
  opts: CaptureOpts = {},
): Promise<CaptureResult> {
  if (!playback.hasPath()) throw new Error('captureFlythrough: no path to record')

  // PERF: the encoder stack (canvas-record → h264-mp4-encoder, ~1MB of embedded WASM)
  // is loaded ON DEMAND the moment an export actually starts, so it never rides in an
  // eagerly-loaded chunk. Keep this a dynamic import — a static one at module top would
  // drag the encoder into whichever chunk hosts the flythrough engine.
  const { Recorder, RecorderStatus } = await import('canvas-record')

  const fps = opts.fps ?? 30
  const canvas = renderer.domElement
  const noResize = opts.noResize ?? false

  // resolution (clamped to AVC max, forced even)
  let w = even(noResize ? canvas.width : (opts.width ?? canvas.width))
  let h = even(noResize ? canvas.height : (opts.height ?? canvas.height))
  if (w * h > AVC_MAX_PIXELS) {
    const s = Math.sqrt(AVC_MAX_PIXELS / (w * h))
    w = even(w * s)
    h = even(h * s)
    console.warn(`canvas-record: clamped capture to ${w}x${h} (AVC ~9.4M px cap)`)
  }

  // total frames spans the FULL timeline (travel + dwell holds)
  const total = playback.getTotalTime()
  const frames = Math.max(2, Math.round(total * fps))

  // preserve current state, render at export resolution
  const prevSize = new THREE.Vector2()
  renderer.getSize(prevSize)
  const prevPixelRatio = renderer.getPixelRatio()
  const prevAspect = recordingCamera.aspect
  const prevTau = playback.tauSeconds

  if (!noResize) {
    renderer.setPixelRatio(1)
    renderer.setSize(w, h, false)
    recordingCamera.aspect = w / h
    recordingCamera.updateProjectionMatrix()
  }

  const webcodecs = webCodecsAvailable()
  // NOTE: do NOT pass width/height to the Recorder — its `set width` writes to
  // an encoder that doesn't exist until after the constructor's Object.assign.
  // The Recorder derives dimensions from the canvas backing store, which we've
  // just sized to w×h above.
  const recorder = new Recorder(renderer.getContext(), {
    name: opts.filename ?? 'roomio-flythrough',
    frameRate: fps,
    extension: 'mp4',
    duration: Infinity, // we drive the step loop + stop() manually
    download: opts.download ?? true,
  })

  let result: CaptureResult
  try {
    await recorder.start({ initOnly: true })
    for (let f = 0; f < frames; f++) {
      const p = frames === 1 ? 0 : f / (frames - 1)
      playback.applyProgress(p, recordingCamera)
      renderer.render(scene, recordingCamera)
      if (recorder.status === RecorderStatus.Recording) await recorder.step()
      opts.onProgress?.(f + 1, frames)
      // yield to the event loop so the page stays responsive on long clips
      if (f % 8 === 0) await new Promise((r) => setTimeout(r, 0))
    }
    const buffer = await recorder.stop()
    result = { buffer, frames, width: w, height: h, fps, webcodecs, filename: recorder.filename }
  } finally {
    await recorder.dispose?.()
    // restore renderer + camera + playhead
    if (!noResize) {
      renderer.setPixelRatio(prevPixelRatio)
      renderer.setSize(prevSize.x, prevSize.y, false)
      recordingCamera.aspect = prevAspect
      recordingCamera.updateProjectionMatrix()
    }
    playback.tauSeconds = prevTau
  }
  return result
}
