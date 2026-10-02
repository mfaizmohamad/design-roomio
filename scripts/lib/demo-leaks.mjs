// Pure leak rules for the public demo build (used by scripts/demo-leak-check.mjs,
// tested by scripts/demo-leak-check.test.mjs).
//
// THE BUG THIS PREVENTS: the demo shares the 3D engine with the app, and the
// engine's modules import data that must never be public — a client's name and
// source citations (src/data/homes/embercrest.ts) and tables keyed by scraped
// Facebook post ids (listingFlats, inferredScenes). vite.demo.config.ts swaps
// those modules out, but a NEW import of such data anywhere in the shared graph
// would ship it with a green typecheck, a green build and a working demo. Only a
// scan of the actual output can see that.

import { ALLOWED_SCRIPT_SRC, CF_ANALYTICS_SCRIPT, CF_ANALYTICS_TOKEN } from './demo-csp.mjs'

/** Literal strings that identify the client or its source documents. Matched
 *  case-insensitively. Extend this when a new client fixture is added. */
// 'pandaul': locality of the 4 BHK house; the demo ships it only as "Sample 4 BHK House".
export const CLIENT_TERMS = ['embercrest', 'duplex.pptx', 'flat 504', 'a&b building', 'pandaul']

/** Patterns that indicate scraped social-media data. */
export const PATTERNS = [
  { name: 'facebook URL', re: /facebook\.com|fbcdn\.net|fb\.watch/i },
  // Post ids are 15–17 digits (e.g. 4551035318554515) and always travel as
  // STRINGS (object keys, ids in JSON). Matching only quoted runs keeps engine
  // number literals out: three/r3f contain 9007199254740992 (2^53) and
  // 8000000000000000 unquoted. Known ids are also matched exactly via
  // datasetNeedles; this rule catches ids from data not in listings.json.
  { name: 'Facebook-style post id', re: /["'`]\d{15,17}["'`]/ },
]

/** Paths that must not exist in the output at all (from the app's public/). */
export const FORBIDDEN_PATHS = [/^listings\.json$/, /^images\//, /^renders\//, /^videos\//]

/**
 * Exact values taken from the scraped dataset (public/listings.json): listing
 * and post ids, the group id, phone numbers and permalinks. Pure: give it the
 * parsed document. Values shorter than 7 characters are dropped so a short
 * fragment can never false-positive against minified code.
 */
export function datasetNeedles(doc) {
  const out = new Set()
  const add = (v) => {
    if (typeof v === 'string' && v.trim().length >= 7) out.add(v.trim())
  }
  add(doc?.group?.id)
  add(doc?.group?.url)
  for (const l of Array.isArray(doc?.listings) ? doc.listings : []) {
    add(l?.id)
    add(l?.postId)
    add(l?.permalink)
    for (const p of Array.isArray(l?.phones) ? l.phones : []) {
      add(p)
      // Phones are stored as written in the post; also look for the digits alone.
      if (typeof p === 'string') add(p.replace(/\D/g, '').slice(-10))
    }
  }
  return [...out]
}

/**
 * Scan built files for leaks.
 * @param {{ path: string, text: string | null }[]} files  path relative to the
 *   output dir; `text` is null for binary files (path rules still apply).
 * @param {string[]} needles exact strings that must not appear (see datasetNeedles)
 * @returns {{ path: string, rule: string, match: string }[]} empty when clean
 */
export function findLeaks(files, needles = []) {
  const leaks = []
  for (const { path, text } of files) {
    for (const re of FORBIDDEN_PATHS) {
      if (re.test(path)) leaks.push({ path, rule: 'forbidden path', match: path })
    }
    if (text == null) continue
    const lower = text.toLowerCase()
    for (const term of CLIENT_TERMS) {
      if (lower.includes(term)) leaks.push({ path, rule: 'client name/source', match: term })
    }
    for (const { name, re } of PATTERNS) {
      const m = re.exec(text)
      if (m) leaks.push({ path, rule: name, match: m[0] })
    }
    for (const n of needles) {
      if (text.includes(n)) leaks.push({ path, rule: 'scraped dataset value', match: n })
    }
  }
  return leaks
}

/**
 * The demo's CSP is injected into index.html by a vite hook; a hook-ordering
 * mistake once built a page with no CSP and nothing failed. Returns a problem
 * description, or null when the page carries a CSP whose script-src stays within
 * ALLOWED_SCRIPT_SRC (self + the Cloudflare analytics beacon).
 */
export function cspProblem(html) {
  const m = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html ?? '')
  if (!m) return 'index.html has no Content-Security-Policy meta'
  const script = /(?:^|;)\s*script-src\s+([^;]*)/.exec(m[1])
  if (!script) return 'CSP has no script-src'
  const extra = script[1].trim().split(/\s+/).filter((s) => !ALLOWED_SCRIPT_SRC.includes(s))
  if (extra.length) return `CSP script-src allows more than ${ALLOWED_SCRIPT_SRC.join(' ')}: ${extra.join(' ')}`
  return null
}

/**
 * The analytics beacon is appended by a vite hook too; like the CSP, losing it
 * would be silent (the site works, the dashboard just goes flat). Returns a
 * problem description, or null when the page loads the beacon with our token.
 */
export function beaconProblem(html) {
  const tag = /<script\b[^>]*\bsrc="([^"]+)"[^>]*\bdata-cf-beacon='([^']*)'[^>]*><\/script>/i.exec(html ?? '')
  if (!tag) return 'index.html has no Cloudflare Web Analytics beacon'
  if (tag[1] !== `${CF_ANALYTICS_SCRIPT}/beacon.min.js`) return `beacon loads from an unexpected URL: ${tag[1]}`
  if (!tag[2].includes(CF_ANALYTICS_TOKEN)) return 'beacon token does not match CF_ANALYTICS_TOKEN'
  return null
}
