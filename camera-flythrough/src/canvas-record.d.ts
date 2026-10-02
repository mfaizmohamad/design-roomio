// Minimal ambient declaration for canvas-record. The package ships types at
// types/index.d.ts but its "exports" map blocks resolution under
// moduleResolution:Bundler, so we declare just the surface we use.
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
