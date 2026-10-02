// Capture curated use-case screenshots of the live Roomio app for the README.
import puppeteer from 'puppeteer-core'
import { readFileSync, mkdirSync } from 'node:fs'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'http://localhost:5180'
const OUT = 'docs/screenshots'
mkdirSync(OUT, { recursive: true })
const personas = (() => { const j = JSON.parse(readFileSync('src/data/personas.json', 'utf8')); return Array.isArray(j) ? j : (j.personas || []) })()
const P = (g) => personas.find((x) => x.genre_id === g)

const W = 1512, H = 950
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', defaultViewport: { width: W, height: H, deviceScaleFactor: 2 },
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`],
})
const page = await browser.newPage()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = async (name, clip) => { await page.screenshot({ path: `${OUT}/${name}.png`, clip }); console.log('  ✓', name) }
const canvasClip = async () => page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } })
const loadPersona = async (g) => { await page.evaluate((p) => window.__roomio.getState().loadPreset(p), P(g)); await sleep(1600) }
const clickText = async (txt) => page.evaluate((t) => { const el = [...document.querySelectorAll('button,[role=button]')].find((e) => (e.textContent || '').includes(t)); if (el) { el.click(); return true } return false }, txt)
const goFresh = async () => { await page.goto(`${BASE}/?stage=furnish&seed=1`, { waitUntil: 'networkidle0', timeout: 30000 }); await sleep(2800) }

await goFresh()

// 1) HERO — a styled persona living room (full app, then a clean 3D crop)
await loadPersona('neo_deco')
await shot('uc-hero', { x: 0, y: 0, width: W, height: H })
await shot('uc-hero-3d', await canvasClip())

// 2) Persona variety
await loadPersona('biophilic'); await shot('uc-persona-biophilic', await canvasClip())
await loadPersona('gamer'); await shot('uc-persona-gamer', await canvasClip())

// 3) Room types with distinct vibes — kitchen & bathroom
await goFresh()
const addRoom = async (label) => {
  await page.evaluate(() => document.querySelector('[data-testid=add-room]')?.click()); await sleep(250)
  await page.evaluate((label) => { const pk = document.querySelector('[data-testid=room-type-picker]'); const b = [...(pk?.querySelectorAll('button') || [])].find((x) => x.textContent.trim() === label); b && b.click() }, label)
  await sleep(1100)
}
await addRoom('Kitchen'); await shot('uc-kitchen', { x: 0, y: 0, width: W, height: H })
await addRoom('Bathroom'); await shot('uc-bathroom', { x: 0, y: 0, width: W, height: H })

// 4) Whole-house overview (we now have bedroom + kitchen + bathroom)
await clickText('View whole house'); await sleep(1500)
await shot('uc-house', { x: 0, y: 0, width: W, height: H })
await clickText('Edit a room'); await sleep(800)

// 5) Lighting / time-of-day — open Light Mode
await clickText('Light Mode'); await sleep(900)
await shot('uc-lighting', { x: 0, y: 0, width: W, height: H })
await clickText('Light Mode'); await sleep(600) // close

// 6) Flythrough — director (top-down) with a drawn path, then first-person walk
await goFresh()
await loadPersona('afrohemian')
await page.evaluate(() => window.__roomioFly?.openPanel()); await sleep(700)
// drop a few waypoints on the canvas (director overlay)
const rect = await canvasClip()
for (const [fx, fy] of [[0.35, 0.62], [0.5, 0.42], [0.66, 0.58], [0.55, 0.74]]) {
  await page.mouse.click(rect.x + rect.width * fx, rect.y + rect.height * fy); await sleep(200)
}
await sleep(500)
await shot('uc-flythrough-director', { x: 0, y: 0, width: W, height: H })
await page.evaluate(() => window.__roomioFly?.setMode('walk')); await sleep(900)
await shot('uc-flythrough-walk', await canvasClip())

// 7) Scan a room photo (detection)
await goFresh()
await clickText('Scan a room photo'); await sleep(900)
await shot('uc-scan', { x: 0, y: 0, width: W, height: H })

console.log('done')
await browser.close()
