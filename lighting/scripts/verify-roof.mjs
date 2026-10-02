// Capture the ceiling/roof behaviour in the harness:
//  - ?roof=1            : default high camera -> ceiling hidden; sun blocked from interior.
//  - ?roof=1&lowcam=1   : camera below the ceiling -> ceiling + downlights visible.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 5186
const OUT = new URL('../verify-out/', import.meta.url).pathname
let failures = 0
const ok = (c, m) => {
  console.log(`${c ? '  ok' : 'FAIL'} - ${m}`)
  if (!c) failures++
}

async function waitForServer(t = 30000) {
  const s = Date.now()
  while (Date.now() - s < t) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return
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
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,800'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })

  const stats = () =>
    page.evaluate(() => {
      const c = document.querySelector('canvas')
      const off = document.createElement('canvas')
      off.width = 160
      off.height = 100
      const ctx = off.getContext('2d')
      ctx.drawImage(c, 0, 0, 160, 100)
      const d = ctx.getImageData(0, 0, 160, 100).data
      const n = 160 * 100
      let sum = 0
      const lum = new Array(n)
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        lum[j] = l
        sum += l
      }
      return { mean: sum / n, lum }
    })
  const diff = (a, b) => {
    let changed = 0
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 18) changed++
    return changed / a.length
  }

  // High camera (default): ceiling hidden
  await page.goto(`http://localhost:${PORT}/?roof=1`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('canvas', { timeout: 15000 })
  await sleep(1200)
  const high = await stats()
  writeFileSync(OUT + 'roof-01-hidden.png', await page.screenshot())
  ok(high.mean > 70, `roofed room renders, lit by ceiling lights (mean ${high.mean.toFixed(0)})`)

  // Low camera: ceiling + downlights visible
  await page.goto(`http://localhost:${PORT}/?roof=1&lowcam=1`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('canvas', { timeout: 15000 })
  await sleep(1400)
  const low = await stats()
  writeFileSync(OUT + 'roof-02-visible.png', await page.screenshot())
  ok(low.mean > 70, `roofed interior still lit from the camera-below view (mean ${low.mean.toFixed(0)})`)
  ok(
    diff(high.lum, low.lum) > 0.12,
    `ceiling reveals when looking up vs hidden looking down (${(diff(high.lum, low.lum) * 100).toFixed(0)}% of view changes)`,
  )

  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'} — see verify-out/roof-*.png`)
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}
process.exit(failures === 0 ? 0 : 1)
