// Entry for the PUBLIC DEMO build (demo.html, vite.demo.config.ts). Deliberately
// does not import App: the demo has no login, no listings and no API, so none of
// that code — or the data behind it — should be in the bundle at all.
import React from 'react'
import ReactDOM from 'react-dom/client'
import { DemoApp } from './DemoApp'
import { ErrorBoundary } from '../ErrorBoundary'
import { Toasts } from '../Toasts'
import { createErrorBuffer, installErrorCapture } from './errorBuffer'
import '../index.css'

// Capture from the very first line, before React or the 3D engine can fail; the
// reporter that sends these loads later (below).
const errors = createErrorBuffer()
installErrorCapture(errors)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary variant="app">
      <DemoApp />
      <Toasts />
    </ErrorBoundary>
  </React.StrictMode>,
)

// Sentry is optional (unset DSN ⇒ nothing loads, nothing is sent) and lazy: the
// SDK is fetched once the page has loaded and the browser is idle, so it never
// competes with first paint or the 3D engine download.
const dsn = import.meta.env.VITE_SENTRY_DSN
if (dsn) {
  const start = () => {
    import('./monitoring')
      .then((m) => m.startMonitoring(errors, dsn, import.meta.env.VITE_RELEASE))
      .catch(() => {
        /* reporter failed to load (offline, blocked by an extension) — the page still works */
      })
  }
  const whenIdle = () => (window.requestIdleCallback ? window.requestIdleCallback(start, { timeout: 5000 }) : setTimeout(start, 2000))
  if (document.readyState === 'complete') whenIdle()
  else window.addEventListener('load', whenIdle, { once: true })
}
