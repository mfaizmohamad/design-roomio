// Verify the LIGHTING + Light Mode are live in the REAL Roomio app (not the harness).
// Boots the root Vite app, deep-links to a furnished persona room, and asserts the
// Light Mode toggle exists, locks furniture, and hides the bottom move-furniture hint.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 5180
const APP = `http://localhost:${PORT}/?preset=biophilic`
const OUT = new URL('../verify-out/', import.meta.url).pathname

let failures = 0
const ok = (c, m) => {
  console.log(`${c ? '  ok' : 'FAIL'} - ${m}`)
  if (!c) failures++
}

async function waitForServer(t = 40000) {
  const s = Date.now()
  while (Date.now() - s < t) {
    try {
      const r = await fetch(`http://localhost:${PORT}/`)
      if (r.ok) return
    } catch {}
    await sleep(300)
  }
  throw new Error('app did not start')
}

mkdirSync(OUT, { recursive: true })
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../..', import.meta.url).pathname, // repo root
  stdio: 'ignore',
})

let browser
try {
  await waitForServer()
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1440,900'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto(APP, { waitUntil: 'networkidle0' })
  await page.waitForSelector('canvas', { timeout: 20000 })
  await sleep(1500)

  const clickText = (t) =>
    page.evaluate((txt) => {
      const el = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(txt))
      if (el) { el.click(); return true }
      return false
    }, t)
  const exists = (sel) => page.evaluate((s) => !!document.querySelector(s), sel)
  const shot = async (name) => writeFileSync(OUT + name, await page.screenshot())
  const hasHint = () =>
    page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('.vp-hint, p.hint'))
      return els.some((e) => /drag to move|drag, rotate/i.test(e.textContent || ''))
    })

  // default state: lighting controls present, editing hint shown
  await shot('app-01-default.png')
  const hasToggle = await page.evaluate(() =>
    !!Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Light Mode')),
  )
  ok(hasToggle, 'Light Mode toggle is present in the real app')
  ok(await exists('canvas'), 'room renders (lit by the new LightingRig)')
  ok(await hasHint(), 'move-furniture hint shown by default (furniture editable)')

  // turn Light Mode ON
  ok(await clickText('Light Mode'), 'clicked Light Mode toggle')
  await sleep(700)
  await shot('app-02-lightmode-on.png')
  ok(!(await hasHint()), 'move-furniture hint HIDDEN in Light Mode')
  const banner = await page.evaluate(() =>
    Array.from(document.querySelectorAll('div')).some((d) => /furniture locked/i.test(d.textContent || '')),
  )
  ok(banner, 'Light Mode "furniture locked" banner shown')
  const barShown = await exists('input[aria-label="Time of day"]')
  ok(barShown, 'opening Light Mode reveals the lighting controls (were hidden by default)')

  // while OPEN: scrub the time slider to a low sun so the visible 3D sun + compass marker show
  await page.evaluate(() => {
    const el = document.querySelector('input[aria-label="Time of day"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, '0.84')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(700)
  await shot('app-04-low-sun.png')

  // close it -> default state restored, controls hidden again
  ok(await clickText('Light Mode'), 'clicked Light Mode toggle off')
  await sleep(600)
  await shot('app-03-lightmode-off.png')
  ok(await hasHint(), 'move-furniture hint returns when Light Mode is off (default state)')
  const controlsHidden = !(await exists('input[aria-label="Time of day"]'))
  ok(controlsHidden, 'lighting controls hidden when Light Mode is off (only the launcher shows)')

  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'} — screenshots in verify-out/`)
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}

process.exit(failures === 0 ? 0 : 1)
