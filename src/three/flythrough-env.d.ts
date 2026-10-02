// Ambient shim so the main app's tsc can compile the flythrough engine modules
// (imported from /camera-flythrough/src). canvas-record ships types but its
// "exports" map blocks resolution under moduleResolution:bundler.
declare module 'canvas-record' {
  export const RecorderStatus: {
    Ready: number
    Initializing: number
    Initialized: number
    Recording: number
    Stopping: number
    Stopped: number
  }
  export interface RecorderOptions {
    name?: string
    frameRate?: number
    extension?: string
    duration?: number
    download?: boolean
    width?: number
    height?: number
    encoder?: unknown
    encoderOptions?: Record<string, unknown>
    muxerOptions?: Record<string, unknown>
    debug?: boolean
  }
  export class Recorder {
    constructor(context: RenderingContext | WebGLRenderingContext | WebGL2RenderingContext, options?: RecorderOptions)
    status: number
    filename: string
    frame: number
    frameTotal: number
    init(opts?: { filename?: string }): Promise<void>
    start(opts?: { filename?: string; initOnly?: boolean }): Promise<void>
    step(): Promise<void>
    stop(): Promise<ArrayBuffer | Uint8Array | Blob[] | undefined>
    dispose?(): Promise<void>
  }
}
