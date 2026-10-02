// Eager, dependency-free error capture for the public demo. Loaded with the
// landing page (a few hundred bytes); the Sentry SDK loads later and lazily
// (./monitoring.ts) and receives everything captured here via attachSink.
//
// Why not just let Sentry install its own handlers: it is loaded AFTER first paint
// on purpose, so a crash during boot — the most likely WebGL failure — would be
// lost. And Sentry has no per-page cap: an error thrown inside the R3F render loop
// repeats every frame (~60/s) and would burn the free quota from one bad GPU in
// minutes. Both are handled here.
import { RENDER_ERROR_EVENT, type RenderErrorDetail } from '../errorEvents'

export type CaptureKind = 'error' | 'rejection' | 'render' | 'webgl-context-lost'

export interface CapturedEvent {
  kind: CaptureKind
  message: string
  /** The thrown value when there is one (Error, or anything a promise rejected with). */
  error?: unknown
}

/** Max DISTINCT events (kind + message) reported per page load. */
export const MAX_EVENTS_PER_PAGE = 10
/** Max events held while the reporter is still loading. */
export const MAX_BUFFERED = 20

const messageOf = (value: unknown): string => {
  if (value instanceof Error) return value.message || value.name
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Collects events, de-duplicates them and enforces the per-page cap; hands them
 * to a sink once one is attached. Pure state machine — exported for tests.
 */
export function createErrorBuffer({ maxEvents = MAX_EVENTS_PER_PAGE, maxBuffered = MAX_BUFFERED } = {}) {
  const seen = new Set<string>()
  let pending: CapturedEvent[] = []
  let sink: ((e: CapturedEvent) => void) | null = null

  return {
    /** Record one event. Returns false when it was dropped (duplicate, cap, or full buffer). */
    record(event: CapturedEvent): boolean {
      const key = `${event.kind}:${event.message.slice(0, 200)}`
      if (seen.has(key) || seen.size >= maxEvents) return false
      if (!sink && pending.length >= maxBuffered) return false
      seen.add(key)
      if (sink) sink(event)
      else pending.push(event)
      return true
    },
    /** Start delivering: flushes everything buffered so far, in order. */
    attachSink(fn: (e: CapturedEvent) => void) {
      sink = fn
      const queued = pending
      pending = []
      for (const e of queued) fn(e)
    },
    get pendingCount() {
      return pending.length
    },
  }
}

export type ErrorBuffer = ReturnType<typeof createErrorBuffer>

/**
 * Listen for uncaught errors, unhandled rejections, ErrorBoundary-caught render
 * errors and WebGL context loss on `target`. Returns an uninstall function.
 */
export function installErrorCapture(buffer: ErrorBuffer, target: Window = window): () => void {
  const onError = (e: Event) => {
    const ev = e as ErrorEvent
    buffer.record({ kind: 'error', message: ev.message || messageOf(ev.error), error: ev.error })
  }
  const onRejection = (e: Event) => {
    const reason = (e as PromiseRejectionEvent).reason
    buffer.record({ kind: 'rejection', message: messageOf(reason), error: reason })
  }
  const onRender = (e: Event) => {
    const detail = (e as CustomEvent<RenderErrorDetail>).detail
    buffer.record({ kind: 'render', message: messageOf(detail?.error), error: detail?.error })
  }
  // webglcontextlost does not bubble; a CAPTURE listener on the document still sees
  // it for any canvas in the page, including the one R3F creates later.
  const onContextLost = () => {
    buffer.record({ kind: 'webgl-context-lost', message: 'WebGL context lost' })
  }

  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  target.addEventListener(RENDER_ERROR_EVENT, onRender)
  target.document?.addEventListener('webglcontextlost', onContextLost, true)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
    target.removeEventListener(RENDER_ERROR_EVENT, onRender)
    target.document?.removeEventListener('webglcontextlost', onContextLost, true)
  }
}
