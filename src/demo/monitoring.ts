// Sentry for the public demo. Loaded by a dynamic import AFTER the page has
// rendered (src/demo/main.tsx), so the SDK never costs first paint; errors from
// before that are replayed from ./errorBuffer.ts.
//
// Privacy: no session replay, no performance tracing, and dataCollection turns off
// user info, cookies, headers, query params and bodies (Sentry v11's replacement
// for sendDefaultPii — its defaults collect user info). What is sent:
// the error, a stack trace, browser/OS, the GPU string (the main suspect when 3D
// fails), and the page path.
import {
  breadcrumbsIntegration,
  captureException,
  captureMessage,
  consoleIntegration,
  dedupeIntegration,
  eventFiltersIntegration,
  functionToStringIntegration,
  httpContextIntegration,
  init,
  linkedErrorsIntegration,
  setTag,
} from '@sentry/browser'
import type { CapturedEvent, ErrorBuffer } from './errorBuffer'

/** GPU vendor/renderer string, or 'unavailable'. Firefox and Safari mask it. */
function gpuInfo(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    if (!gl) return 'no-webgl'
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)
    // Free the probe context now; browsers cap live WebGL contexts (~16) and the
    // tour needs one. This fires webglcontextlost on the probe canvas, which is
    // never attached to the document, so errorBuffer's document listener does not
    // report it as a crash.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return typeof renderer === 'string' ? renderer.slice(0, 120) : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

export function startMonitoring(buffer: ErrorBuffer, dsn: string, release?: string) {
  init({
    dsn,
    release,
    environment: 'demo',
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, urlQueryParams: false, httpBodies: [] },
    // Explicit list instead of the defaults. Left out on purpose:
    //  - globalHandlers / browserApiErrors: ./errorBuffer already listens, with a
    //    per-page cap; Sentry's handlers would double-report and bypass the cap.
    //  - tracing / replay: not needed, and they would send far more data.
    defaultIntegrations: false,
    integrations: [
      eventFiltersIntegration(),
      functionToStringIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
      httpContextIntegration(),
      // Console warnings/errors as breadcrumbs: three.js logs shader and GPU
      // problems there, which is the context a WebGL crash needs. Not log/info.
      consoleIntegration({ levels: ['warn', 'error'] }),
      // Only Sentry's own breadcrumbs; no DOM clicks, fetches or navigation.
      breadcrumbsIntegration({ dom: false, fetch: false, xhr: false, history: false, sentry: true }),
    ],
  })
  setTag('gpu', gpuInfo())
  buffer.attachSink(send)
}

function send(event: CapturedEvent) {
  const tags = { kind: event.kind }
  if (event.error instanceof Error) captureException(event.error, { tags })
  else captureMessage(event.message, { level: event.kind === 'webgl-context-lost' ? 'warning' : 'error', tags })
}
