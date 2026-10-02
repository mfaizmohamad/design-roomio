import puppeteer from 'puppeteer-core'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'http://localhost:5184'
const OUT = 'camera-flythrough/scripts/__shots'
import { mkdirSync } from 'node:fs'
mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,800'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
const errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message))
await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 })
await new Promise((r) => setTimeout(r, 1000))

let fail = 0
const ok = (c, m) => { console.log(`${c ? '✓' : '❌'} ${m}`); if (!c) fail++ }
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

// drop 4 waypoints (world meters) forming an S through the room
const wps = [[-2.3, 1.6, 1.4], [-0.7, 1.6, -0.6], [1.1, 1.6, 0.7], [2.3, 1.6, -1.3]]
for (const [x, , z] of wps) await page.evaluate((x, z) => window.__fly.addWaypoint(x, z), x, z)

ok((await page.evaluate(() => window.__fly.pathCount())) === 4, 'dropped 4 waypoints')
ok((await page.evaluate(() => window.__fly.hasCurve())) === true, 'curve built (>=2 pts)')

// curve passes THROUGH every control point (min dist from each wp to dense curve)
const dense = await page.evaluate(() => window.__fly.curveDense(600))
let maxMiss = 0
for (const wp of wps) {
  let min = Infinity
  for (const p of dense) min = Math.min(min, dist(wp, p))
  maxMiss = Math.max(maxMiss, min)
}
ok(maxMiss < 0.02, `spline passes through every waypoint (max miss ${(maxMiss * 100).toFixed(2)} cm)`)

await page.screenshot({ path: `${OUT}/05-path-topdown.png` })

// drag the 2nd point and confirm the curve still threads it
await page.evaluate(() => window.__fly.select(1))
await page.evaluate(() => window.__fly.dragSelected(-0.2, -1.6))
const dense2 = await page.evaluate(() => window.__fly.curveDense(600))
let min2 = Infinity
for (const p of dense2) min2 = Math.min(min2, dist([-0.2, 1.6, -1.6], p))
ok(min2 < 0.02, `dragged point #2 — spline still threads it (miss ${(min2 * 100).toFixed(2)} cm)`)

// per-point look-at + dwell
await page.evaluate(() => window.__fly.select(2))
await page.evaluate(() => window.__fly.setLookAtWorld(0, 0.8, 0))
await page.evaluate(() => window.__fly.setDwell(1.5))
const cp = await page.evaluate(() => window.__fly.toCameraPath())
ok(cp.controlPoints.length === 4, 'exported CameraPath has 4 control points')
ok(JSON.stringify(cp.controlPoints[2].lookAt) === JSON.stringify([0, 0.8, 0]), 'point #3 has explicit look-at target')
ok(cp.controlPoints[2].dwell === 1.5, 'point #3 dwell = 1.5s')
ok(cp.coordinateSpace === 'world-meters' && cp.version === '1.0', 'CameraPath shape matches schema')

await page.screenshot({ path: `${OUT}/06-path-lookat.png` })
ok(errs.filter((e) => !/favicon|404/i.test(e)).length === 0, `no console errors${errs.length ? ' :: ' + errs.slice(0, 2).join(' | ') : ''}`)
console.log(fail ? `\nFAIL (${fail})` : '\nALL PASS')
await browser.close()
process.exit(fail ? 1 : 0)
