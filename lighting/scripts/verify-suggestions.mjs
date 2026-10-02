// Verify the Suggestions panel collapse toggle (default open → click header → collapses).
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
let b
try {
  await wait()
  b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,900'] })
  const p = await b.newPage()
  await p.setViewport({ width: 1280, height: 900 })
  await p.goto('http://localhost:5180/?stage=furnish', { waitUntil: 'networkidle0' })
  await p.waitForSelector('canvas', { timeout: 20000 })
  await sleep(1200)

  // default OPEN: suggestion rows present (Dismiss buttons)
  const dismissCount = () => p.evaluate(() => Array.from(document.querySelectorAll('button')).filter((x) => x.textContent?.trim() === 'Dismiss').length)
  const headerPresent = await p.evaluate(() => !!Array.from(document.querySelectorAll('button')).find((x) => x.textContent?.includes('Suggestions')))
  ok(headerPresent, 'Suggestions panel + header present')
  const before = await dismissCount()
  ok(before > 0, `default OPEN — suggestion rows visible (${before} dismissable rows)`)
  writeFileSync(OUT + 'sugg-1-open.png', await p.screenshot())

  // click the header to COLLAPSE
  await p.evaluate(() => Array.from(document.querySelectorAll('button')).find((x) => x.textContent?.includes('Suggestions'))?.click())
  await sleep(400)
  const after = await dismissCount()
  ok(after < before, `clicking header collapses the rows (${before} → ${after})`)
  writeFileSync(OUT + 'sugg-2-collapsed.png', await p.screenshot())

  // click again to RE-OPEN
  await p.evaluate(() => Array.from(document.querySelectorAll('button')).find((x) => x.textContent?.includes('Suggestions'))?.click())
  await sleep(400)
  const reopened = await dismissCount()
  ok(reopened === before, `clicking again re-opens (${reopened})`)

  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'}`)
} finally {
  if (b) await b.close()
  vite.kill('SIGTERM')
}
process.exit(failures === 0 ? 0 : 1)
