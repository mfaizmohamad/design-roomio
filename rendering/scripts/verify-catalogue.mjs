// Verify the IKEA-style catalogue upgrades + the washing-machine asset in the REAL app (prod build):
// dimension line on cards, "Furnish this room" one-tap, and the kitchen-washer card. Serves the
// production build via `vite preview` (build first).
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
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1500,1000'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 1.5 })
  page.on('dialog', (d) => d.accept())
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push(String(e)))

  await page.goto(`${BASE}/?stage=furnish&seed=1`, { waitUntil: 'networkidle0', timeout: 30000 })
  await page.waitForSelector('[data-testid="tab-catalogue"]', { timeout: 15000 })
  await page.click('[data-testid="tab-catalogue"]')
  await sleep(600)

  // (1) "Furnish this room" one-tap bundle button present
  ok(!!(await page.$('[data-testid="furnish-this-room"]')), 'Furnish-this-room button present in Catalogue')

  // (2) drill into Kitchen → the washing machine card exists, and cards show a dimensions line
  await page.click('[data-testid="cat-tile-kitchen"]')
  await sleep(500)
  const washer = await page.$('[data-testid="catalog-card-kitchen-washer"]')
  ok(!!washer, 'Washing Machine (kitchen-washer) card present in Kitchen category')
  const dims = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="catalog-card-kitchen-washer"]')
    const d = card?.querySelector('.catalog-card__dims')
    return d ? d.textContent : null
  })
  ok(dims && /×/.test(dims), `card shows W×D×H dimensions ("${dims}")`)

  // (2b) sub-type facet chips present; clicking one narrows the grid
  ok(!!(await page.$('[data-testid="catalogue-facets"]')), 'sub-type facet chips present in a drilled category')
  const before = (await page.$$('.catalog-card')).length
  const washerFacet = await page.$('[data-testid="facet-model-washer"]')
  if (washerFacet) {
    await washerFacet.click()
    await sleep(400)
    const after = (await page.$$('.catalog-card')).length
    ok(after >= 1 && after < before, `sub-type facet filters the grid (${before} → ${after})`)
    await washerFacet.click() // reset
    await sleep(300)
  } else { ok(false, 'washer sub-type facet chip present') }
  writeFileSync(`${OUT}/catalogue-kitchen.png`, await page.screenshot({ encoding: 'binary' }))

  // (3) add the washer to the room (it renders without error)
  await page.click('[data-testid="catalog-card-kitchen-washer"] .catalog-card__add')
  await sleep(900)
  const count = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="catalog-count-kitchen-washer"]')
    return el ? parseInt(el.textContent || '0', 10) : 0
  })
  ok(count >= 1, `washer added to the room (count ${count})`)

  const critical = errs.filter((e) => !/favicon|401|unauthorized|403|404|DevTools|ffmpeg/i.test(e))
  ok(critical.length === 0, `no critical console errors (${critical.length})`)
  critical.slice(0, 6).forEach((e) => console.log('     err:', e.slice(0, 160)))
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}
console.log(fail ? `\n${fail} FAILED` : '\nCATALOGUE + WASHER OK — screenshot in rendering/verify-out/catalogue-kitchen.png')
process.exit(fail ? 1 : 0)
