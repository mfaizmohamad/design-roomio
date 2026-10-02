// Regenerate ALL README screenshots in one command — run each cycle so docs/screenshots/
// always reflects the current build (the app's rendering keeps improving; stale shots undersell it).
//
//   npm run docs:shots            # spawns the dev server (free port), captures every shot
//   BASE=http://localhost:5180 npm run docs:shots   # reuse an already-running dev server
//   PORT=5191 npm run docs:shots  # pin the spawned dev server's port (default: a free one)
//   SHOTS=uc-house,uc-kitchen npm run docs:shots     # only these (comma list)
//   KEEP=1 npm run docs:shots     # publish a captured shot even if it fails the blank/black
//                                 # quality gate (for debugging a bad shot); default keeps the old file
//
// Notes:
// - Runs against the DEV server (serves /src so persona presets load). Run it on the checkout whose
//   output you want to ship — for the README, that's a clean `origin/main`.
// - Retina 2x. Room shots are cropped to the 3D viewport (2160x1900); full-app shots are 3024x1900,
//   matching the existing gallery framing. A shot only overwrites its file if it captured OK.
// - Each recipe is defensive (per-shot try/catch); a failure leaves the previous image untouched and
//   is reported, so a flaky state never publishes a broken/empty image. Captured shots are also run
//   through the harness's assertRenderQuality (notBlank/notBlack) so a blank/black frame is treated
//   like a FAIL — unless KEEP=1.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveChrome, launchBrowser, startDevServer, assertRenderQuality } from './lib/harness.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs', 'screenshots')
const OWN_SERVER = !process.env.BASE // spawn a dev server unless BASE points at a running one
const KEEP = !!process.env.KEEP // publish even a blank/black shot (debugging)
const WANT = (process.env.SHOTS || '').split(',').map((s) => s.trim()).filter(Boolean)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Chrome resolution up front so a missing browser fails fast with a clear message (PIPE-3).
try { resolveChrome() } catch (e) { console.error(e.message); process.exit(2) }

mkdirSync(OUT, { recursive: true })
const VIEWPORT_CROP = { x: 430, y: 0, width: 1080, height: 950 } // -> 2160x1900 @2x (3D area, no left panel)

// ── page helpers ────────────────────────────────────────────────────────────
let page
let base
const go = async (q = 'stage=furnish&seed=1') => { await page.goto(`${base}/?${q}`, { waitUntil: 'networkidle0', timeout: 45000 }); await sleep(3200) }
const click = (reSrc) => page.evaluate((r) => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(r, 'i').test((x.textContent || '').trim())); if (b) { b.click(); return true } return false }, reSrc)
const clickExact = (txt) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === t); if (b) { b.click(); return true } return false }, txt)
const loadPreset = (g) => page.evaluate(async (gg) => {
  let ps = []; try { const j = await (await fetch('/src/data/personas.json')).json(); ps = Array.isArray(j) ? j : (j.personas || []) } catch { /* no dev-server personas.json (prod build) — fall through to the -1 "not found" result */ }
  const p = ps.find((x) => (x.genre_id || x.id) === gg)
  if (p && window.__roomio?.getState().loadPreset) { window.__roomio.getState().loadPreset(p); return window.__roomio.getState().design.furniture.length }
  return -1
}, g)
const clean = () => page.evaluate(() => { const s = window.__roomio?.getState?.(); if (s?.selectFurniture) s.selectFurniture(null); if (s?.selectOpening) s.selectOpening(null) })
const hi = () => clickExact('high')
const collapseRender = () => page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Render/.test(x.textContent || '') && x.getAttribute('aria-expanded') === 'true'); if (b) b.click() })
const addRoomType = async (typeRe) => { await click('Add room'); await sleep(1000); await page.evaluate((r) => { const b = [...document.querySelectorAll('button')].find((x) => new RegExp(r, 'i').test((x.textContent || '').trim())); if (b) b.click() }, typeRe); await sleep(2200) }

// ── shot recipes (name -> {full?, run}) ──────────────────────────────────────
const SHOTS = {
  'uc-hero':      { full: false, run: async () => { const n = await loadPreset('neo_deco'); if (n <= 0) throw Error('preset empty'); await clean(); await hi(); await collapseRender() } },
  'uc-hero-3d':   { full: false, run: async () => { const n = await loadPreset('afrohemian'); if (n <= 0) throw Error('preset empty'); await clean(); await hi(); await collapseRender() } },
  'uc-persona-biophilic': { full: false, run: async () => { const n = await loadPreset('biophilic'); if (n <= 0) throw Error('preset empty'); await clean(); await hi(); await collapseRender() } },
  'uc-persona-gamer':     { full: false, run: async () => { const n = await loadPreset('gamer'); if (n <= 0) throw Error('preset empty'); await clean(); await hi(); await collapseRender() } },
  'uc-kitchen':   { full: false, run: async () => { await addRoomType('Kitchen'); await clean(); await hi(); await collapseRender() } },
  'uc-bathroom':  { full: false, run: async () => { await addRoomType('Bath'); await clean(); await hi(); await collapseRender() } },
  // Whole house — load a furnished 3BHK flat (matches the caption), then the whole-house overview.
  'uc-house':     { full: true, run: async () => {
    if (!(await click('3BHK'))) throw Error('no 3BHK flat button (flat-templates not on this build?)')
    await sleep(9000)          // a furnished 3BHK (3+ rooms + snap solver) is heavy under SwiftShader
    await clean()
    // enter whole-house overview if not already in it (toggle reads "View whole house" / "Edit a room")
    const inHouse = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /Edit a room/i.test(b.textContent || '')))
    if (!inHouse) { if (!(await click('View whole house|whole house'))) throw Error('no whole-house toggle'); await sleep(2500) }
    await hi(); await collapseRender()
  } },
  'uc-lighting':  { full: true, run: async () => { const n = await loadPreset('celestial'); if (n <= 0) throw Error('preset empty'); await clean(); await click('Sun Mode|Light Mode'); await sleep(1400); await hi() } },
  'uc-scan':      { full: true, run: async () => { await clean(); if (!(await click('Scan a room photo'))) throw Error('no scan button'); await sleep(1600) } },
  'uc-flythrough-walk':     { full: true, run: async () => { const n = await loadPreset('family'); if (n <= 0) throw Error('preset empty'); await sleep(800); if (!(await click('Flythrough'))) throw Error('no flythrough button'); await sleep(2600); await click('Walk|First.?person|POV') } },
  'uc-flythrough-director': { full: true, run: async () => { const n = await loadPreset('family'); if (n <= 0) throw Error('preset empty'); await sleep(800); if (!(await click('Flythrough'))) throw Error('no flythrough button'); await sleep(1800); await click('Director|Top.?down|Overhead'); await sleep(1800) } },
  '02-step1-shape':   { full: true, run: async () => { await go('stage=step1'); await sleep(1200) } },
  '03-step2-dims':    { full: true, run: async () => { await go('stage=step2'); await sleep(1200) } },
  '04-step3-openings':{ full: true, run: async () => { await go('stage=step3'); await sleep(1200) } },
  '05-step4-style':   { full: true, run: async () => { await go('stage=step4'); await sleep(1200) } },
}

// ── run ──────────────────────────────────────────────────────────────────────
let server
if (OWN_SERVER) {
  const port = process.env.PORT ? Number(process.env.PORT) : undefined
  console.log(`▶ starting dev server${port ? ` on :${port}` : ' on a free port'} …`)
  server = await startDevServer({ port, cwd: ROOT }) // picks a free port when unset (PIPE-5); surfaces vite stderr on failure
  base = server.url
  console.log(`  dev server ready at ${base}`)
} else {
  base = process.env.BASE
}

const results = []
let browser
try {
  browser = await launchBrowser({ windowSize: '1520,980' })
  page = await browser.newPage()
  await page.setViewport({ width: 1512, height: 950, deviceScaleFactor: 2 })

  const names = WANT.length ? WANT : Object.keys(SHOTS)
  for (const name of names) {
    const rec = SHOTS[name]
    if (!rec) { results.push(`SKIP ${name} (no recipe)`); continue }
    try {
      await go()               // reset to a clean furnished room before every shot
      await rec.run()
      await sleep(1400)
      const buf = await page.screenshot({ encoding: 'binary', ...(rec.full ? {} : { clip: VIEWPORT_CROP }) })
      const q = assertRenderQuality(buf, { notBlank: true, notBlack: true })
      if (!q.ok && !KEEP) {
        results.push(`FAIL ${name}: ${q.failures.join('; ')}  (kept old image; KEEP=1 to publish anyway)`)
        continue
      }
      writeFileSync(join(OUT, `${name}.png`), buf)
      const note = q.ok ? '' : `  ⚠ published despite quality: ${q.failures.join('; ')} (KEEP=1)`
      results.push(`OK   ${name}  (${rec.full ? '3024x1900' : '2160x1900'})${note}`)
    } catch (e) { results.push(`FAIL ${name}: ${e.message}  (kept old image)`) }
  }
} finally {
  if (browser) await browser.close()
  if (server) await server.stop()
}
console.log('\n' + results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL')).length
console.log(`\n${results.filter((r) => r.startsWith('OK')).length} captured, ${failed} failed. -> docs/screenshots/`)
process.exit(failed ? 1 : 0)
