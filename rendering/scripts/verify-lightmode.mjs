// Verify Light Mode UX: entering Light Mode must NOT spray per-item 🔒 badges over the scene, but
// MUST show a single clear "furniture is locked" message. Serves the production build via vite preview.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 5180, BASE = `http://localhost:${PORT}`, OUT = 'rendering/verify-out'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fail = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fail++ }
const preset = (g) => { try { const j = JSON.parse(readFileSync('src/data/personas.json', 'utf8')); return (Array.isArray(j) ? j : j.personas || []).find((x) => x.genre_id === g) } catch { return null } }

const countBadges = () => `[...document.querySelectorAll('.lock-badge')].filter(e => e.offsetParent !== null).length`
const hasLockMsg = () => `/furniture is locked|Furniture locked/i.test(document.body.innerText)`

mkdirSync(OUT, { recursive: true })
// DEV server (not preview): window.__roomio is dev-only, needed to load a preset here.
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
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
  await page.waitForSelector('canvas', { timeout: 15000 })
  await sleep(2500)
  // Vite dev can 504 on first dep-optimize; reload once if the store isn't exposed yet.
  if (!(await page.evaluate(() => !!window.__roomio))) {
    await page.reload({ waitUntil: 'networkidle0', timeout: 30000 })
    await page.waitForSelector('canvas', { timeout: 15000 })
    await sleep(2500)
  }
  // Load a preset (has default windows → enables Light Mode, and furnishes the room).
  const p = preset('young_couple') || preset('family') || preset('biophilic')
  if (p) { await page.evaluate((pp) => window.__roomio.getState().loadPreset(pp), p); await sleep(1800) }
  const furn = await page.evaluate(() => window.__roomio?.getState?.().design.furniture.length ?? 0)
  ok(furn > 0, `room is furnished (${furn} pieces) — a scene that could show per-item badges`)

  // BEFORE Light Mode: baseline badge count (normal mode shows badges only for pinned pieces)
  const badgesBefore = await page.evaluate(countBadges())

  // enter Light Mode via the real launcher button (needs a window; preset provides one)
  await page.waitForSelector('[data-testid="light-mode-launch"]', { timeout: 8000 })
  await page.click('[data-testid="light-mode-launch"]')
  await sleep(1400)

  const badges = await page.evaluate(countBadges())
  ok(badges === 0, `NO per-item lock badges in Light Mode (found ${badges}; was ${badgesBefore} before)`)
  const msg = await page.evaluate(hasLockMsg())
  ok(msg === true, 'a clear "furniture is locked" message is shown in Light Mode')
  writeFileSync(`${OUT}/lightmode-on.png`, await page.screenshot({ encoding: 'binary' }))

  const critical = errs.filter((e) => !/favicon|401|unauthorized|403|404|DevTools|ffmpeg/i.test(e))
  ok(critical.length === 0, `no critical console errors (${critical.length})`)
  critical.slice(0, 6).forEach((e) => console.log('     err:', e.slice(0, 160)))
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}
console.log(fail ? `\n${fail} FAILED` : '\nLIGHT MODE UX OK — screenshot in rendering/verify-out/lightmode-on.png')
process.exit(fail ? 1 : 0)
