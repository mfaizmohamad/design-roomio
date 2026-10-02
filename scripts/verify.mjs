/**
 * Verification CLI — drive a route (or the curated smoke set) through the
 * harness: ephemeral dev server → screenshot → console/network errors → render
 * quality verdict. Fixes the "every agent re-writes puppeteer boilerplate"
 * problem: this is the boilerplate, once.
 *
 *   npm run verify:route -- '/?preset=gamer' '/?stage=furnish&seed=1'
 *   npm run verify:smoke
 *   BASE=http://localhost:5180 npm run verify:route -- '/?stage=step2'   # reuse a running server
 *   CHROME=/path/to/chrome OUT=verify-out/x npm run verify:route -- '/'
 *
 * Exit code is non-zero if any route has a critical console/page/network error
 * or fails the blank/black render-quality check.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withBrowser, openPage, shoot } from './lib/browser.mjs'
import { startDevServer } from './lib/dev-server.mjs'
import { assertRenderQuality } from './lib/png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = process.env.OUT || join(ROOT, 'verify-out', 'harness')

const SMOKE_ROUTES = ['/', '/?stage=step1', '/?stage=step2', '/?stage=furnish&seed=1', '/?stage=listings']

/** A route drives WebGL if it enters a 3D stage / preset / listing replica. */
const is3D = (route) => /(stage=(step[1-4]|furnish))|preset=|listing=/.test(route)

const slug = (route) => route.replace(/^https?:\/\/[^/]+/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'root'

async function run() {
  const mode = process.argv[2]
  let routes
  if (mode === 'smoke') {
    routes = SMOKE_ROUTES
  } else if (mode === 'route') {
    routes = process.argv.slice(3)
    if (routes.length === 0) {
      console.error("usage: verify.mjs route '<path>' [more paths…]   (e.g. '/?preset=gamer')")
      process.exit(2)
    }
  } else {
    console.error("usage: verify.mjs <route|smoke> [paths…]")
    process.exit(2)
  }

  const reuse = process.env.BASE
  const server = reuse ? null : await startDevServer({ cwd: ROOT })
  const base = reuse || server.url
  console.log(`▶ ${mode} against ${base}${reuse ? ' (reused)' : ` (ephemeral :${server.port})`} → ${OUT}\n`)

  let failed = 0
  try {
    await withBrowser(async (browser) => {
      for (const route of routes) {
        const url = base + (route.startsWith('/') ? route : '/' + route)
        const name = slug(route)
        try {
          const threeD = is3D(route)
          const { page, critical } = await openPage(browser, url, {
            waitForCanvas: threeD,
            settleMs: threeD ? 3500 : 1200,
          })
          const buf = await shoot(page, join(OUT, `${name}.png`))
          await page.close()

          const q = assertRenderQuality(buf, { notBlank: threeD, notBlack: threeD })
          const c = critical()
          const errs = c.consoleErrors.length + c.pageErrors.length + c.failedRequests.length
          const bad = !q.ok || errs > 0
          if (bad) failed++
          console.log(`${bad ? '❌' : '✓'} ${route}`)
          console.log(`   shot ${name}.png ${q.stats.width}x${q.stats.height}  render:${q.ok ? 'ok' : 'FAIL'} (mean ${q.stats.meanLum}, std ${q.stats.std})`)
          if (!q.ok) q.failures.forEach((f) => console.log(`   render: ${f}`))
          c.pageErrors.forEach((e) => console.log(`   pageerror: ${e.slice(0, 180)}`))
          c.consoleErrors.forEach((e) => console.log(`   console: ${e.slice(0, 180)}`))
          c.failedRequests.forEach((r) => console.log(`   request: ${r.status ?? r.error} ${r.url.slice(0, 160)}`))
          if (!bad) console.log('   no critical errors')
        } catch (e) {
          failed++
          console.log(`❌ ${route}\n   threw: ${e.message.slice(0, 300)}`)
        }
      }
    })
  } finally {
    if (server) await server.stop()
  }

  console.log(`\n==== ${failed === 0 ? `ALL ${routes.length} ROUTE(S) PASSED ✓` : `${failed}/${routes.length} route(s) FAILED ❌`} ====`)
  process.exit(failed ? 1 : 0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
