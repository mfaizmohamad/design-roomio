// Verify every persona GENRE preset now loads with default doors + windows
// (Agent C). Boots the real app (:5180), deep-links ?preset=<genre> for all 10
// genres, and asserts via the live store that each room has >=1 door and >=1
// window, each placed on a real wall and fitting within it. Screenshots each
// genre → multi-room/verify-out/genre-<id>.png for visual QA.

import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 5180
const BASE = `http://localhost:${PORT}/`
const OUT = new URL('../verify-out/', import.meta.url).pathname

const GENRES = [
  'bachelor', 'couple', 'family', 'anime_otaku', 'gamer',
  'sports', 'afrohemian', 'neo_deco', 'celestial', 'biophilic',
]
const BEDROOM_GENRES = new Set(['anime_otaku', 'celestial'])

let failures = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok' : 'FAIL'} - ${msg}`)
  if (!cond) failures++
}
async function waitForServer(timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try { if ((await fetch(BASE)).ok) return true } catch {}
    await sleep(300)
  }
  throw new Error('vite did not start')
}

mkdirSync(OUT, { recursive: true })
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
})

let browser
try {
  await waitForServer()
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1400,900'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })

  for (const g of GENRES) {
    await page.goto(`${BASE}?preset=${g}`, { waitUntil: 'networkidle0' })
    // wait for the preset to load into the store
    await page.waitForFunction(() => window.__roomio?.getState().design.personaGenre, { timeout: 6000 }).catch(() => {})
    await sleep(400)
    const data = await page.evaluate(() => {
      const st = window.__roomio.getState()
      const d = st.design
      return {
        genre: d.personaGenre,
        openings: d.openings.map((o) => ({ kind: o.kind, wallId: o.wallId, width: o.width, t: o.t })),
        walls: st.walls.map((w) => ({ id: w.id, length: w.length })),
      }
    })
    const doors = data.openings.filter((o) => o.kind === 'door').length
    const windows = data.openings.filter((o) => o.kind === 'window').length
    const wallById = Object.fromEntries(data.walls.map((w) => [w.id, w.length]))
    const allFit = data.openings.every(
      (o) => wallById[o.wallId] != null && o.width <= wallById[o.wallId] && o.t > 0 && o.t < 1,
    )
    ok(data.genre === g, `[${g}] preset loaded`)
    ok(doors >= 1, `[${g}] has a door (${doors})`)
    ok(windows >= 1, `[${g}] has a window (${windows})`)
    ok(allFit, `[${g}] every opening sits on a real wall and fits within it`)
    await page.screenshot({ path: `${OUT}genre-${g}.png` })
  }
  console.log(`\nBedroom genres covered: ${[...BEDROOM_GENRES].join(', ')}`)
} catch (err) {
  console.error(err)
  failures++
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll genres have default doors + windows')
process.exit(failures ? 1 : 0)
