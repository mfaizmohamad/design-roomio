// Re-capture the shots that read sparse: whole-house (3BHK), lighting (on a styled
// room), and richer kitchen/bathroom (full fixture sets Agent A added).
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
const full = { x: 0, y: 0, width: W, height: H }
const shot = async (name, clip = full) => { await page.screenshot({ path: `${OUT}/${name}.png`, clip }); console.log('  ✓', name) }
const canvasClip = async () => page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } })
const clickText = async (t) => page.evaluate((t) => { const el = [...document.querySelectorAll('button,[role=button]')].find((e) => (e.textContent || '').includes(t)); if (el) { el.click(); return true } return false }, t)
const goFresh = async () => { await page.goto(`${BASE}/?stage=furnish&seed=1`, { waitUntil: 'networkidle0', timeout: 30000 }); await sleep(2800) }
const addRoom = async (label) => {
  await page.evaluate(() => document.querySelector('[data-testid=add-room]')?.click()); await sleep(250)
  await page.evaluate((label) => { const pk = document.querySelector('[data-testid=room-type-picker]'); const b = [...(pk?.querySelectorAll('button') || [])].find((x) => x.textContent.trim() === label); b && b.click() }, label)
  await sleep(1100)
}
const add = async (id, x, z) => page.evaluate((id, x, z) => window.__roomio.getState().addFurniture(id, x, z), id, x, z)

// 1) Whole house — the standard 3BHK floor plan
await goFresh()
await clickText('3BHK flat'); await sleep(1600)
await clickText('View whole house'); await sleep(1800)
await shot('uc-house')

// 2) Lighting / time-of-day on a styled persona room
await goFresh()
await page.evaluate((p) => window.__roomio.getState().loadPreset(p), P('celestial')); await sleep(1600)
await clickText('Light Mode'); await sleep(1000)
await shot('uc-lighting')

// 3) Richer kitchen — counter + stove + fridge + island
await goFresh()
await addRoom('Kitchen')
await add('kitchen-stove', 360, 42)
await add('kitchen-fridge', 530, 70)
await add('kitchen-island', 300, 240)
await page.evaluate(() => window.__roomio.getState().selectFurniture(null)); await sleep(800)
await shot('uc-kitchen', await canvasClip())

// 4) Richer bathroom — toilet + shower + vanity + freestanding tub
await goFresh()
await addRoom('Bathroom')
await add('bath-vanity', 300, 42)
await add('bath-tub-freestanding', 160, 300)
await page.evaluate(() => window.__roomio.getState().selectFurniture(null)); await sleep(800)
await shot('uc-bathroom', await canvasClip())

console.log('done')
await browser.close()
