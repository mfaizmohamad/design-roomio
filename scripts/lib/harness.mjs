/**
 * Verification harness — one import for the whole toolkit. See
 * docs/verify-harness.md for the survey, rationale, and usage.
 *
 *   import { withDevServer, withBrowser, openPage, shoot, assertRenderQuality } from './lib/harness.mjs'
 *
 * Pure-logic pieces (chrome/net/png) are also importable directly for unit
 * tests without pulling in puppeteer.
 */
export * from './chrome.mjs'
export * from './net.mjs'
export * from './png.mjs'
export * from './dev-server.mjs'
export * from './browser.mjs'
