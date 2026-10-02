/**
 * Puppeteer helpers: launch Chrome with the verified SwiftShader flags, open a
 * page that already collects console/page/network errors, and screenshot it.
 * This is the browser-facing half of the harness; the pure logic lives in
 * chrome.mjs / net.mjs / png.mjs so those stay unit-testable without a browser.
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import puppeteer from 'puppeteer-core'
import { resolveChrome, CHROME_FLAGS } from './chrome.mjs'

export const DEFAULT_VIEWPORT = { width: 1680, height: 1000, deviceScaleFactor: 1 }

/**
 * Noise every headless run produces that is NOT a real defect: the favicon 404,
 * the anon `/auth/me` 401 (expected before login), DevTools chatter, aborted
 * requests. Callers can override via openPage's `ignore` option.
 */
export const NOISE_RE = /favicon|DevTools|Failed to load resource|net::ERR_ABORTED|\b40[134]\b|unauthorized/i

/** Launch Chrome with the resolved executable + SwiftShader flags. */
export async function launchBrowser({ chrome, flags = CHROME_FLAGS, headless = 'new', windowSize, extraArgs = [] } = {}) {
  const executablePath = chrome || resolveChrome()
  const args = [...flags, ...(windowSize ? [`--window-size=${windowSize}`] : []), ...extraArgs]
  return puppeteer.launch({ executablePath, headless, args })
}

/** Run `fn(browser)` with a launched browser, guaranteeing teardown. */
export async function withBrowser(fn, opts) {
  const browser = await launchBrowser(opts)
  try {
    return await fn(browser)
  } finally {
    await browser.close()
  }
}

/**
 * Open `url` in a new page and wire up error collection.
 *
 * @param {import('puppeteer-core').Browser} browser
 * @param {string} url
 * @param {object} [opts]
 * @param {object|null} [opts.viewport=DEFAULT_VIEWPORT]
 * @param {boolean} [opts.waitForCanvas=false]  await a <canvas> (WebGL routes)
 * @param {number}  [opts.settleMs=0]           extra settle for R3F/SwiftShader
 * @param {string}  [opts.waitUntil='networkidle0']
 * @param {number}  [opts.timeout=45000]
 * @param {RegExp}  [opts.ignore=NOISE_RE]      noise filter for `critical()`
 * @returns {Promise<{page, consoleErrors:string[], pageErrors:string[], failedRequests:object[], critical:()=>object}>}
 *   `critical()` returns the noise-filtered subsets for a pass/fail decision.
 */
export async function openPage(
  browser,
  url,
  { viewport = DEFAULT_VIEWPORT, waitForCanvas = false, settleMs = 0, waitUntil = 'networkidle0', timeout = 45000, ignore = NOISE_RE } = {},
) {
  const page = await browser.newPage()
  if (viewport) await page.setViewport(viewport)

  const consoleErrors = []
  const pageErrors = []
  const failedRequests = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => pageErrors.push(e?.message || String(e)))
  page.on('requestfailed', (r) => failedRequests.push({ url: r.url(), error: r.failure()?.errorText || 'failed' }))
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push({ url: r.url(), status: r.status() })
  })

  if (url) await page.goto(url, { waitUntil, timeout })
  if (waitForCanvas) await page.waitForSelector('canvas', { timeout })
  if (settleMs) await new Promise((r) => setTimeout(r, settleMs))

  const critical = () => ({
    consoleErrors: consoleErrors.filter((e) => !ignore.test(e)),
    pageErrors: pageErrors.filter((e) => !ignore.test(e)),
    failedRequests: failedRequests.filter((f) => !ignore.test(f.url) && !ignore.test(String(f.status ?? f.error ?? ''))),
  })

  return { page, consoleErrors, pageErrors, failedRequests, critical }
}

/**
 * Screenshot `page` to `outPath` (creating parent dirs). Returns the PNG buffer
 * so callers can pipe it straight into assertRenderQuality without re-reading.
 */
export async function shoot(page, outPath, { clip, fullPage = false } = {}) {
  mkdirSync(dirname(outPath), { recursive: true })
  return page.screenshot({ path: outPath, ...(clip ? { clip } : {}), fullPage })
}
