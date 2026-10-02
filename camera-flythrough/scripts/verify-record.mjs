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

// ---- F4 walk-and-record ----
await page.evaluate(() => window.__fly.setMode('walk'))
await page.evaluate(() => window.__fly.setWalkYaw(Math.PI * 0.25))
await page.evaluate(() => window.__fly.startRecording())
ok(await page.evaluate(() => window.__fly.isRecording()), 'recording started in walk mode')
await page.evaluate(() => window.__fly.pressKeys(['KeyW']))
await new Promise((r) => setTimeout(r, 1400))
await page.evaluate(() => window.__fly.setWalkYaw(-Math.PI * 0.25)) // turn → makes an L
await new Promise((r) => setTimeout(r, 1200))
await page.evaluate(() => window.__fly.releaseKeys(['KeyW']))
const rec = await page.evaluate(() => window.__fly.stopRecordingBuild())
console.log(`   recorded ${rec.samples} samples → ${rec.points} control points`)
ok(rec.samples > 8, `captured a dense walk (${rec.samples} samples)`)
ok(rec.points >= 2 && rec.points < rec.samples, `decimated to fewer control points (${rec.points} < ${rec.samples})`)
ok(await page.evaluate(() => window.__fly.hasCurve()), 'recorded walk produced a usable spline')

await page.evaluate(() => window.__fly.setMode('director'))
await new Promise((r) => setTimeout(r, 300))
await page.screenshot({ path: `${OUT}/09-recorded-path.png` })

// ---- save / load JSON round-trip ----
const json = await page.evaluate(() => window.__fly.serializePath())
const parsed = JSON.parse(json)
ok(parsed.version === '1.0' && parsed.coordinateSpace === 'world-meters', 'serialized JSON matches schema')
const beforeCount = await page.evaluate(() => window.__fly.pathCount())
await page.evaluate(() => window.__fly.clearPath?.())
// clear then reload from the JSON string
const reloaded = await page.evaluate((j) => window.__fly.loadFromJSON(j), json)
ok(reloaded === beforeCount, `path reloads from JSON identically (${reloaded} == ${beforeCount} points)`)

// localStorage round-trip
await page.evaluate(() => window.__fly.saveLocal())
const fromLocal = await page.evaluate(() => window.__fly.loadFromLocalCache())
ok(fromLocal === beforeCount, `path persists + reloads via localStorage (${fromLocal} points)`)

ok(errs.filter((e) => !/favicon|404/i.test(e)).length === 0, `no console errors${errs.length ? ' :: ' + errs.slice(0, 3).join(' | ') : ''}`)
console.log(fail ? `\nFAIL (${fail})` : '\nALL PASS')
await browser.close()
process.exit(fail ? 1 : 0)
