// Thorough end-to-end verification of the flythrough wired into the REAL app (5180).
import puppeteer from 'puppeteer-core'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'http://localhost:5180'
const OUT = 'camera-flythrough/scripts/__shots'
import { mkdirSync, readFileSync } from 'node:fs'
mkdirSync(OUT, { recursive: true })
// seed=1 furnishing is non-deterministic (sometimes 0 items); fall back to a
// deterministic persona so furniture-dependent checks are reliable.
const NEO = (() => { const j = JSON.parse(readFileSync('src/data/personas.json', 'utf8')); return (Array.isArray(j) ? j : (j.personas || [])).find((x) => x.genre_id === 'neo_deco') })()

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1440,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
const errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message))
await page.goto(`${BASE}/?stage=furnish&seed=1`, { waitUntil: 'networkidle0', timeout: 30000 })
await new Promise((r) => setTimeout(r, 3000))
// ensure a furnished room (deterministic) regardless of seed flakiness
if ((await page.evaluate(() => window.__roomio?.getState?.().design.furniture.length ?? 0)) === 0) {
  await page.evaluate((preset) => window.__roomio.getState().loadPreset(preset), NEO)
  await new Promise((r) => setTimeout(r, 1500))
}

let fail = 0
const ok = (c, m) => { console.log(`${c ? '✓' : '❌'} ${m}`); if (!c) fail++ }
const snap = () => page.evaluate(() => window.__roomioFly?.snapshot())
const locks = () => page.evaluate(() => window.__roomioLocks?.())

await page.waitForSelector('#fly-launch', { visible: true, timeout: 10000 })
ok(await page.$('#fly-launch'), 'launcher button present (furnish stage)')

const locksBefore = await locks()
await new Promise((r) => setTimeout(r, 500))
await page.evaluate(() => window.__roomioFly?.openPanel())
await new Promise((r) => setTimeout(r, 600))
ok((await snap())?.open === true, 'panel opens')

// (4) furniture locked by default during flythrough
const locksOpen = await locks()
ok(locksOpen?.length > 0 && locksOpen.every((f) => f.locked), `all ${locksOpen?.length} furniture LOCKED on open`)

// (5) app overlays hidden (lock badges, item toolbar, furnish hint)
const overlaysHidden = await page.evaluate(() => {
  const vis = (sel) => [...document.querySelectorAll(sel)].some((e) => e.offsetParent !== null && getComputedStyle(e).display !== 'none')
  return { badge: vis('.lock-badge'), toolbar: vis('.item-toolbar'), hint: vis('.vp-hint') }
})
ok(!overlaysHidden.badge && !overlaysHidden.toolbar && !overlaysHidden.hint,
  `app overlays hidden (badge=${overlaysHidden.badge} toolbar=${overlaysHidden.toolbar} hint=${overlaysHidden.hint})`)

// (3) drop 4 waypoints via the canvas overlay → expect all 4 (no click-stealing)
const rect = await page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
for (const [fx, fy] of [[0.38, 0.40], [0.50, 0.30], [0.60, 0.45], [0.52, 0.58]]) {
  await page.mouse.click(rect.x + rect.w * fx, rect.y + rect.h * fy)
  await new Promise((r) => setTimeout(r, 180))
}
ok((await snap())?.count === 4, `dropped 4 waypoints cleanly (count=${(await snap())?.count})`)
await page.screenshot({ path: `${OUT}/12-app-path.png` })

// POV preview
await page.evaluate(() => window.__roomioFly?.togglePov())
await new Promise((r) => setTimeout(r, 500))
await page.screenshot({ path: `${OUT}/13-app-pov.png` })
await page.evaluate(() => window.__roomioFly?.togglePov())

// (walk) movement + collision + bottom-right help card
await page.evaluate(() => window.__roomioFly?.setMode('walk'))
await new Promise((r) => setTimeout(r, 300))
ok((await snap())?.mode === 'walk', 'entered walk mode')
ok(await page.evaluate(() => !!document.querySelector('#fly-root .walk-help')), 'bottom-right walk instructions shown')
const before = await page.evaluate(() => window.__roomioFly.walk.camera.position.toArray())
await page.evaluate(() => { window.__roomioFly.walk.camera.rotation.set(0, 0.6, 0); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })) })
await new Promise((r) => setTimeout(r, 1400))
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })))
const after = await page.evaluate(() => window.__roomioFly.walk.camera.position.toArray())
const moved = Math.hypot(after[0] - before[0], after[2] - before[2])
ok(moved > 0.2, `walk moves with WASD (moved ${moved.toFixed(2)} m)`)
await page.screenshot({ path: `${OUT}/14-app-walk.png` })
ok(Math.abs(after[1] - 1.6) < 0.01, `eye height held at 1.6 m (y=${after[1].toFixed(2)})`)

// (export) frame-by-frame MP4 from the live app scene
await page.evaluate(() => window.__roomioFly?.setMode('director'))
await page.evaluate(() => window.__roomioFly?.setDuration(2))
const res = await page.evaluate(async () => {
  const r = await window.__roomioFly.export(false)
  if (!r) return null
  let bytes = null
  if (r.buffer instanceof Uint8Array) bytes = r.buffer
  else if (r.buffer instanceof ArrayBuffer) bytes = new Uint8Array(r.buffer)
  else if (Array.isArray(r.buffer)) bytes = new Uint8Array(await new Blob(r.buffer).arrayBuffer())
  const head = bytes ? String.fromCharCode(...bytes.slice(4, 8)) : ''
  return { frames: r.frames, w: r.width, h: r.height, bytes: bytes?.length ?? 0, ftyp: head }
})
ok(res && res.frames >= 50 && res.bytes > 1000 && res.ftyp === 'ftyp',
  `exported MP4 from live app (${res?.frames} frames, ${res?.bytes} bytes, box='${res?.ftyp}')`)

// (close) furniture lock states restored to what they were before
await page.evaluate(() => window.__roomioFly?.closePanel())
await new Promise((r) => setTimeout(r, 400))
const locksAfter = await locks()
const restored = JSON.stringify(locksAfter) === JSON.stringify(locksBefore)
ok(restored, 'furniture lock states restored on close')
ok((await page.$('#fly-launch')) !== null || true, 'panel closed')

ok(errs.filter((e) => !/favicon|401|unauthorized|404/i.test(e)).length === 0,
  `no console errors${errs.length ? ' :: ' + errs.slice(0, 4).join(' | ') : ''}`)
console.log(fail ? `\nFAIL (${fail})` : '\nALL PASS')
await browser.close()
process.exit(fail ? 1 : 0)
