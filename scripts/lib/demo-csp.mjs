// The public demo's Content-Security-Policy, built at `vite build` time by
// vite.demo.config.ts and checked after the build by scripts/demo-leak-check.mjs.
// One module for both so the policy and its check cannot drift apart.

/** Cloudflare Web Analytics. Pages injects the beacon script when Web Analytics is
 *  enabled for the project; it loads from here and reports to CF_ANALYTICS_REPORT. */
export const CF_ANALYTICS_SCRIPT = 'https://static.cloudflareinsights.com'
export const CF_ANALYTICS_REPORT = 'https://cloudflareinsights.com'

/** Site token for roomio-demo.pages.dev in Cloudflare Web Analytics (Analytics &
 *  Logs → Web Analytics). Public by design: it ships in every page and only lets a
 *  browser report page views for this site. pages.dev is not a zone in the
 *  account, so Cloudflare cannot auto-inject the beacon; the build adds it. */
export const CF_ANALYTICS_TOKEN = '70c2d627458848639446d30202f2ae0e'

/** The beacon tag the build appends to the demo page (vite.demo.config.ts). */
export function analyticsBeacon(token = CF_ANALYTICS_TOKEN) {
  return `<script type="module" src="${CF_ANALYTICS_SCRIPT}/beacon.min.js" data-cf-beacon='{"token": "${token}"}'></script>`
}

/** The only script sources the demo may ever load. Anything else in script-src
 *  (another CDN, 'unsafe-inline', 'unsafe-eval') fails the build. */
export const ALLOWED_SCRIPT_SRC = ["'self'", CF_ANALYTICS_SCRIPT]

/**
 * Origin errors are sent to, from a Sentry DSN (https://<key>@<host>/<project>).
 * Returns null when no DSN is set. Throws on a malformed or non-https DSN rather
 * than building a site whose reporter silently fails the CSP.
 * @param {string | undefined} dsn
 * @returns {string | null}
 */
export function sentryOrigin(dsn) {
  if (!dsn) return null
  let url
  try {
    url = new URL(dsn)
  } catch {
    throw new Error('VITE_SENTRY_DSN is not a valid URL')
  }
  if (url.protocol !== 'https:' || !url.username || !/^\/\d+$/.test(url.pathname)) {
    throw new Error('VITE_SENTRY_DSN must look like https://<key>@<host>/<project-id>')
  }
  return url.origin
}

/**
 * The demo CSP. The base is fully static (`'self'` only); analytics adds exactly
 * its two Cloudflare origins, and Sentry adds exactly the DSN's own origin — never
 * a wildcard like *.sentry.io, which would let any Sentry customer's project
 * receive data from this page.
 *
 * blob: covers three.js texture and worker uploads; 'unsafe-inline' STYLES cover the
 * <style> tags R3F/drei inject at runtime (scripts never get 'unsafe-inline').
 * @param {{ sentryDsn?: string }} [opts]
 * @returns {string}
 */
export function buildDemoCsp({ sentryDsn } = {}) {
  const sentry = sentryOrigin(sentryDsn)
  const connect = ["'self'", 'data:', 'blob:', CF_ANALYTICS_REPORT, ...(sentry ? [sentry] : [])]
  return [
    "default-src 'self'",
    `script-src ${ALLOWED_SCRIPT_SRC.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self' blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ')
}
