// Verify the furnished flat templates (1/2/3 BHK) in the REAL app: each loads via the RoomsBar
// buttons, switches to whole-house view, and should show DISTINCT per-room floors + starter
// furniture. Screenshots each. Serves the production build via `vite preview` (build first).

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 5180, BASE = `http://localhost:${PORT}`, OUT = 'rendering/verify-out'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fail = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fail++ }

mkdirSync(OUT, { recursive: true })
const vite = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
let browser
try {
  const t = Date.now(); while (Date.now() - t < 30000) { try { if ((await fetch(BASE)).ok) break } catch {} await sleep(300) }
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1600,1000'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1.5 })
  page.on('dialog', (d) => d.accept()) // auto-accept the "replace rooms?" confirm
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push(String(e)))

  await page.goto(`${BASE}/?stage=furnish&seed=1`, { waitUntil: 'networkidle0', timeout: 30000 })
  await page.waitForSelector('[data-testid="load-3bhk"]', { timeout: 15000 })
  ok(true, 'RoomsBar flat-template buttons present')

  for (const [bhk, tid, expectRooms] of [['1BHK', 'load-1bhk', 6], ['2BHK', 'load-2bhk', 9], ['3BHK', 'load-3bhk', 10]]) {
    await page.click(`[data-testid="${tid}"]`)
    await sleep(3500) // furnish every room (loadDesign + snap solver per piece) + house render
    const chips = (await page.$$('[data-testid="room-chip"]')).length
    ok(chips === expectRooms, `${bhk}: loaded ${chips} rooms (expected ${expectRooms})`)
    // the "In Room" tab badge = the active room's furniture count (proves furnishing happened)
    const placed = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="tab-placed"] .lb-tab__badge')
      return el ? parseInt(el.textContent || '0', 10) : 0
    })
    ok(placed > 0, `${bhk}: active room is furnished (In Room badge = ${placed})`)
    writeFileSync(`${OUT}/bhk-${bhk}.png`, await page.screenshot({ encoding: 'binary' }))
    console.log(`     screenshot -> verify-out/bhk-${bhk}.png`)
  }

  const critical = errs.filter((e) => !/favicon|401|unauthorized|403|404|DevTools|ffmpeg/i.test(e))
  ok(critical.length === 0, `no critical console errors (${critical.length})`)
  critical.slice(0, 6).forEach((e) => console.log('     err:', e.slice(0, 180)))
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}
console.log(fail ? `\n${fail} FAILED` : '\nBHK TEMPLATES OK — screenshots in rendering/verify-out/')
process.exit(fail ? 1 : 0)
