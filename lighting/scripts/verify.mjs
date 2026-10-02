// Headless verification of the lighting harness (Agent E).
// Boots the Vite dev server, drives the lighting store, and asserts via canvas pixels:
//  - the furnished room is lit (not a dark box) and shadows are present
//  - scrubbing the time bar sweeps the shadows (image changes)
//  - rotating north swings the light (image changes); reverse differs again
//  - hiding both controls still renders the scene
// Saves screenshots to verify-out/.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 5186
const APP_URL = `http://localhost:${PORT}/`
const OUT = new URL('../verify-out/', import.meta.url).pathname

let failures = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok' : 'FAIL'} - ${msg}`)
  if (!cond) failures++
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(APP_URL)
      if (r.ok) return true
    } catch {}
    await sleep(300)
  }
  throw new Error('vite did not start')
}

mkdirSync(OUT, { recursive: true })

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
})

let browser
try {
  await waitForServer()
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--window-size=1280,800',
    ],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  await page.goto(APP_URL, { waitUntil: 'networkidle0' })
  await page.waitForSelector('canvas', { timeout: 15000 })
  await page.waitForFunction(() => !!window.__lighting, { timeout: 10000 })
  await sleep(800) // let a few frames render

  // helper: set lighting state from the page
  const set = (patch) =>
    page.evaluate((p) => {
      const s = window.__lighting.getState()
      if (p.timeOfDay !== undefined) s.setTimeOfDay(p.timeOfDay)
      if (p.northOffsetDeg !== undefined) s.setNorthOffset(p.northOffsetDeg)
      if (p.barVisible !== undefined) s.toggleBar(p.barVisible)
      if (p.northVisible !== undefined) s.toggleNorth(p.northVisible)
    }, patch)

  // helper: downscaled canvas stats + raw pixels for diffing
  const sample = () =>
    page.evaluate(() => {
      const c = document.querySelector('canvas')
      const off = document.createElement('canvas')
      off.width = 160
      off.height = 100
      const ctx = off.getContext('2d')
      ctx.drawImage(c, 0, 0, 160, 100)
      const d = ctx.getImageData(0, 0, 160, 100).data
      let sum = 0,
        dark = 0,
        n = 160 * 100
      const lum = new Array(n)
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        lum[j] = l
        sum += l
        if (l < 70) dark++
      }
      return { mean: sum / n, darkFrac: dark / n, lum }
    })

  const diff = (a, b) => {
    let changed = 0
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 18) changed++
    return changed / a.length
  }

  const shot = async (name) => {
    const buf = await page.screenshot({ encoding: 'binary' })
    writeFileSync(OUT + name, buf)
  }

  // 1) NOON — lit + shadows present
  await set({ timeOfDay: 0.5, northOffsetDeg: 0, barVisible: true, northVisible: true })
  await sleep(500)
  const noon = await sample()
  await shot('01-noon.png')
  ok(noon.mean > 80, `room is lit, not a dark box (mean luminance ${noon.mean.toFixed(0)} > 80)`)
  ok(noon.darkFrac > 0.015, `shadows present (dark pixel fraction ${(noon.darkFrac * 100).toFixed(1)}% > 1.5%)`)

  // 2) TIME SCRUB — shadows sweep
  await set({ timeOfDay: 0.25 })
  await sleep(400)
  const morning = await sample()
  await shot('02-morning.png')
  await set({ timeOfDay: 0.75 })
  await sleep(400)
  const afternoon = await sample()
  await shot('03-afternoon.png')
  ok(diff(morning.lum, afternoon.lum) > 0.03, `scrubbing time sweeps shadows (${(diff(morning.lum, afternoon.lum) * 100).toFixed(1)}% pixels changed)`)

  // 3) LOW SUN — warmer/dimmer than noon
  await set({ timeOfDay: 0.08 })
  await sleep(400)
  const dawn = await sample()
  await shot('04-dawn.png')
  ok(dawn.mean < noon.mean, `low-angle sun dims the scene (dawn mean ${dawn.mean.toFixed(0)} < noon ${noon.mean.toFixed(0)})`)

  // 4) NORTH ROTATE — light swings
  await set({ timeOfDay: 0.5, northOffsetDeg: 0 })
  await sleep(400)
  const n0 = await sample()
  await set({ northOffsetDeg: 90 })
  await sleep(400)
  const n90 = await sample()
  await shot('05-north90.png')
  ok(diff(n0.lum, n90.lum) > 0.03, `rotating north swings the light (${(diff(n0.lum, n90.lum) * 100).toFixed(1)}% pixels changed)`)

  // 5) NORTH REVERSE — flips 180
  await set({ northOffsetDeg: 180 })
  await sleep(400)
  const n180 = await sample()
  await shot('06-north180.png')
  ok(diff(n0.lum, n180.lum) > 0.03, `reverse north (180) changes light direction (${(diff(n0.lum, n180.lum) * 100).toFixed(1)}% changed)`)

  // 6) CONTROLS HIDDEN BY DEFAULT (Light Mode off) — only the launcher shows; scene still renders
  await set({ northOffsetDeg: 0 })
  await page.evaluate(() => window.__lighting.getState().toggleLightMode(false))
  await sleep(400)
  const hidden = await sample()
  await shot('07-controls-hidden.png')
  const barGone = await page.evaluate(() => !document.querySelector('input[aria-label="Time of day"]'))
  ok(barGone, 'controls hidden by default (Light Mode off) — only the launcher shows')
  const launcher = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).some((b) => /Light Mode/.test(b.textContent || '')),
  )
  ok(launcher, 'compact Light Mode launcher is present when closed')
  ok(hidden.mean > 80, `scene still renders with controls hidden (mean ${hidden.mean.toFixed(0)})`)

  // 7) LIGHT MODE — opens controls + locks furniture (badges) + hides the bottom editing hint
  const hintBefore = await page.evaluate(() => !!document.querySelector('p.hint'))
  ok(hintBefore, 'editing hint shown when Light Mode is off (default furniture state)')
  await page.evaluate(() => window.__lighting.getState().toggleLightMode(true))
  await sleep(500)
  await shot('07b-lightmode-on.png')
  const lm = await page.evaluate(() => ({
    on: window.__lighting.getState().lightMode,
    hint: !!document.querySelector('p.hint'),
    badges: document.querySelectorAll('.furniture-lock-badge').length,
    banner: Array.from(document.querySelectorAll('div')).some((d) => /furniture locked/i.test(d.textContent || '')),
  }))
  ok(lm.on === true, 'Light Mode turns on')
  ok(lm.hint === false, 'bottom editing hint HIDDEN in Light Mode')
  ok(lm.badges >= 5, `furniture shows lock badges in Light Mode (${lm.badges} locked)`)
  ok(lm.banner, 'Light Mode banner ("furniture locked") shown')
  // turn it off -> furniture back to default (editable), hint returns
  await page.evaluate(() => window.__lighting.getState().toggleLightMode(false))
  await sleep(400)
  const lmOff = await page.evaluate(() => ({
    on: window.__lighting.getState().lightMode,
    hint: !!document.querySelector('p.hint'),
    badges: document.querySelectorAll('.furniture-lock-badge').length,
  }))
  ok(lmOff.on === false && lmOff.hint === true && lmOff.badges === 0, 'Light Mode off -> furniture default state, hint back, no lock badges')

  // 8) MULTI-ROOM — two rooms each lit, sun still the only shadow caster
  await page.goto(APP_URL + '?multi=1', { waitUntil: 'networkidle0' })
  await page.waitForSelector('canvas', { timeout: 15000 })
  await page.waitForFunction(() => !!window.__lighting, { timeout: 10000 })
  await sleep(900)
  const multi = await sample()
  await shot('08-multiroom.png')
  const roomCount = await page.evaluate(() => Object.keys(window.__lighting.getState().rooms).length)
  ok(roomCount >= 2, `multi-room house has ${roomCount} rooms lit per-room`)
  ok(multi.mean > 80 && multi.darkFrac > 0.01, `both rooms lit with shadows (mean ${multi.mean.toFixed(0)}, dark ${(multi.darkFrac * 100).toFixed(1)}%)`)

  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'} — screenshots in verify-out/`)
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}

process.exit(failures === 0 ? 0 : 1)
