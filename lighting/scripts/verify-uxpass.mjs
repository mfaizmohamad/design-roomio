// Verify the UX pass: empty-state onboarding, category filter chips,
// consolidated toolbar (Plan view / Colliders), and the top-down plan-view snap.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = new URL('../verify-out/', import.meta.url).pathname
const vite = spawn('npx', ['vite', '--port', '5180', '--strictPort'], { cwd: '/Users/pratham/Desktop/personal/roomio', stdio: 'ignore' })
async function wait() { for (let i = 0; i < 120; i++) { try { if ((await fetch('http://localhost:5180/')).ok) return } catch {} await sleep(300) } }
let failures = 0
const ok = (c, m) => { console.log(`${c ? '  ok' : 'FAIL'} - ${m}`); if (!c) failures++ }
const hasText = (p, t) => p.evaluate((s) => document.body.innerText.includes(s), t)
let b
try {
  await wait()
  b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,900'] })
  const p = await b.newPage()
  await p.setViewport({ width: 1280, height: 900 })
  await p.goto('http://localhost:5180/?stage=furnish', { waitUntil: 'networkidle0' })
  await p.waitForSelector('canvas', { timeout: 20000 })
  await sleep(1200)
  const clickText = (t) => p.evaluate((txt) => { const el = Array.from(document.querySelectorAll('button')).find((x) => x.textContent?.includes(txt)); if (el) { el.click(); return true } return false }, t)
  const cards = () => p.evaluate(() => document.querySelectorAll('.catalog-card').length)

  // UX2: empty-state onboarding
  ok(await hasText(p, "Your room is empty"), 'empty-state onboarding card shown for a new room')
  writeFileSync(OUT + 'ux-1-panel.png', await p.screenshot())

  // UX1: category filter chips (click "Sofas" → grid narrows to sofas; "All" restores)
  const before = await cards()
  ok(before > 0, `catalog cards present in default All view (${before})`)
  await clickText('Sofas')
  await sleep(300)
  const after = await cards()
  ok(after < before && after > 0, `selecting a category filters the grid (${before} → ${after})`)
  await clickText('All')
  await sleep(300)
  const restored = await cards()
  ok(restored === before, `selecting All restores the full catalog (${after} → ${restored})`)

  // UX3: consolidated toolbar present with aria-labels
  const aria = await p.evaluate(() => ({
    plan: !!document.querySelector('button[aria-label="Top-down 2D plan view"]'),
    colliders: !!document.querySelector('button[aria-label="Toggle the collision-footprint debug overlay"]'),
  }))
  ok(aria.plan && aria.colliders, 'consolidated toolbar buttons present with aria-labels')

  // UX4: plan-view snap (click → camera goes top-down)
  await sleep(300)
  ok(await clickText('Plan view'), 'clicked "Plan view"')
  await sleep(900)
  writeFileSync(OUT + 'ux-2-planview.png', await p.screenshot())

  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`)
} finally {
  if (b) await b.close()
  vite.kill('SIGTERM')
}
process.exit(failures === 0 ? 0 : 1)
