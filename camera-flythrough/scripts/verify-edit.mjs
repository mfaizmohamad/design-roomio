// Furniture select / remove / rotate: works fresh, blocked DURING flythrough path-mode,
// available via the EDIT-FURNITURE toggle, and fully restored AFTER closing.
import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'http://localhost:5180'
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
if ((await page.evaluate(() => window.__roomio?.getState?.().design.furniture.length ?? 0)) === 0) {
  await page.evaluate((preset) => window.__roomio.getState().loadPreset(preset), NEO)
  await new Promise((r) => setTimeout(r, 1500))
}

let fail = 0
const ok = (c, m) => { console.log(`${c ? '✓' : '❌'} ${m}`); if (!c) fail++ }
const sel = (id) => page.evaluate((id) => window.__roomio.getState().selectFurniture(id), id)
const selId = () => page.evaluate(() => window.__roomio.getState().selectedFurnitureId)
const locks = () => page.evaluate(() => window.__roomioLocks())
const snap = () => page.evaluate(() => window.__roomioFly.snapshot())
const count = () => page.evaluate(() => window.__roomio.getState().design.furniture.length)
const toolbarVisible = () => page.evaluate(() => {
  const t = document.querySelector('.item-toolbar')
  if (!t) return false
  const c = getComputedStyle(t)
  return t.offsetParent !== null && c.display !== 'none' && c.visibility !== 'hidden'
})
const ids = () => page.evaluate(() => window.__roomio.getState().design.furniture.map((f) => f.id))

// (1) FRESH normal mode (flythrough never opened)
const firstId = (await ids())[0]
await sel(firstId); await new Promise((r) => setTimeout(r, 200))
ok((await selId()) === firstId, 'FRESH: selecting an item sticks')
ok(await toolbarVisible(), 'FRESH: selected-item toolbar (lock + delete) visible')
const c0 = await count()
await page.evaluate((id) => window.__roomio.getState().removeFurniture(id), firstId)
ok((await count()) === c0 - 1, 'FRESH: removeFurniture works')
const ridR = (await ids())[0]
await page.evaluate((id) => window.__roomio.getState().updateFurniture(id, { rotation: 1.0 }), ridR)
ok((await page.evaluate((id) => window.__roomio.getState().design.furniture.find((f) => f.id === id).rotation, ridR)) === 1.0, 'FRESH: rotation updates')

const locksBeforeFly = await locks()

// (2) DURING flythrough path-mode — locked + toolbar hidden + selection cleared (expected)
await page.evaluate(() => window.__roomioFly?.openPanel()); await new Promise((r) => setTimeout(r, 500))
ok((await locks()).every((l) => l.locked), 'DURING (path mode): all furniture locked')
await sel(ridR); await new Promise((r) => setTimeout(r, 250))
ok((await selId()) === null, 'DURING (path mode): selection force-cleared')
ok(!(await toolbarVisible()), 'DURING (path mode): toolbar hidden')

// (3) EDIT-FURNITURE toggle (the requested navbar feature)
await page.evaluate(() => window.__roomioFly?.toggleEdit()); await new Promise((r) => setTimeout(r, 400))
ok((await snap()).editMode, 'EDIT toggle ON')
const inEdit = await locks()
const preLocked = new Set(locksBeforeFly.filter((l) => l.locked).map((l) => l.id))
ok(inEdit.every((l) => (preLocked.has(l.id) ? l.locked : !l.locked)), 'EDIT mode: editable items unlocked (pre-locked keep lock)')
await sel(ridR); await new Promise((r) => setTimeout(r, 300))
ok((await selId()) === ridR, 'EDIT mode: selection sticks (not cleared)')
ok(await toolbarVisible(), 'EDIT mode: selected-item toolbar (remove/lock) visible')
const cE = await count()
await page.evaluate((id) => window.__roomio.getState().removeFurniture(id), ridR)
ok((await count()) === cE - 1, 'EDIT mode: remove works')
await page.evaluate(() => window.__roomioFly?.toggleEdit()) // back to path mode
await new Promise((r) => setTimeout(r, 300))
ok((await locks()).every((l) => l.locked), 'EDIT toggle OFF: furniture re-locked for path authoring')

// (4) AFTER close — restored to pre-flythrough lock state (by id)
await page.evaluate(() => window.__roomioFly?.closePanel()); await new Promise((r) => setTimeout(r, 500))
ok(!(await page.evaluate(() => document.body.classList.contains('flythrough-active'))), 'AFTER close: body.flythrough-active removed')
const after = await locks()
const beforeMap = Object.fromEntries(locksBeforeFly.map((l) => [l.id, l.locked]))
ok(after.every((l) => l.locked === (beforeMap[l.id] ?? false)), 'AFTER close: lock states restored to pre-flythrough (by id)')
const fid = (await ids())[0]
await sel(fid); await new Promise((r) => setTimeout(r, 400))
ok((await selId()) === fid, 'AFTER close: selection sticks again (no leaked subscription)')
ok(await toolbarVisible(), 'AFTER close: toolbar visible again (no leaked CSS)')

ok(errs.filter((e) => !/favicon|401|unauthorized|404/i.test(e)).length === 0,
  `no console errors${errs.length ? ' :: ' + errs.slice(0, 3).join(' | ') : ''}`)
console.log(fail ? `\nFAIL (${fail})` : '\nALL PASS')
await browser.close()
process.exit(fail ? 1 : 0)
