// Verify the realism layer wired into the REAL app (root vite :5180). Proves the mount renders:
// RenderControls panel present, canvas lit (not black), no critical console errors, + a screenshot
// of realism in the actual app. Run from repo root: `node rendering/scripts/verify-app.mjs`.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 5180
const BASE = `http://localhost:${PORT}`
const OUT = 'rendering/verify-out'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fail = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) fail++ }

const NEO = (() => {
  try {
    const j = JSON.parse(readFileSync('src/data/personas.json', 'utf8'))
    return (Array.isArray(j) ? j : j.personas || []).find((x) => x.genre_id === 'neo_deco')
  } catch { return null }
})()

const MEAN = `(() => {
  const c = document.querySelector('canvas'); if (!c) return null;
  const o = document.createElement('canvas'); o.width=160; o.height=100;
  const x = o.getContext('2d'); x.drawImage(c,0,0,160,100);
  const d = x.getImageData(0,0,160,100).data; let s=0,dark=0;
  for (let i=0;i<d.length;i+=4){const L=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];s+=L;if(L<12)dark++;}
  return { mean:s/16000, darkFrac:dark/16000 };
})()`

mkdirSync(OUT, { recursive: true })
// Serve the PRODUCTION build (dist/) via `vite preview` — no dev dep-optimization 504 churn, and it
// proves the built app mount. (Run `npx vite build` first.)
const vite = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })

let browser
try {
  const start = Date.now()
  while (Date.now() - start < 30000) {
    try { if ((await fetch(BASE)).ok) break } catch {} // eslint-disable-line
    await sleep(300)
  }
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1440,900'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message))

  await page.goto(`${BASE}/?stage=furnish&seed=1`, { waitUntil: 'networkidle0', timeout: 30000 })
  await sleep(3500)
  const hasCanvas = await page.evaluate(() => !!document.querySelector('canvas'))
  if (!hasCanvas) {
    const body = await page.evaluate(() => document.body.innerText.slice(0, 400))
    console.log('     NO CANVAS. body text:', JSON.stringify(body))
    console.log('     console errors:', errs.slice(0, 8).join('\n       '))
    writeFileSync(`${OUT}/10-app-NOCANVAS.png`, await page.screenshot({ encoding: 'binary' }))
  }
  ok(hasCanvas, 'app rendered a canvas (auth bypassed, no crash)')
  // Deterministic furnished room (seed furnishing is flaky) so the realism has something to light.
  const nFurn = await page.evaluate(() => window.__roomio?.getState?.().design.furniture.length ?? -1)
  if (nFurn === 0 && NEO) {
    await page.evaluate((p) => window.__roomio.getState().loadPreset(p), NEO)
    await sleep(1800)
  }

  // (1) the realism layer's RenderControls panel is mounted in the app.
  const panel = await page.evaluate(() => document.body.innerText.includes('Beauty shot') || document.body.innerText.includes('🎬'))
  ok(panel, 'RenderControls panel present in the real app (mount rendered)')

  // (2) the scene renders lit (the composer + IBL are active; not a black canvas).
  const s = await page.evaluate(MEAN)
  ok(s && s.mean > 25 && s.darkFrac < 0.85, `app canvas renders lit (mean ${s?.mean.toFixed(1)}, dark ${(s?.darkFrac * 100).toFixed(1)}%)`)
  writeFileSync(`${OUT}/10-app-realism.png`, await page.screenshot({ encoding: 'binary' }))

  // (2a) TEXTURES: A's procedural floor texture renders with visible detail under the realism layer.
  const floor = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    const W = 480, H = 300
    const o = document.createElement('canvas'); o.width = W; o.height = H
    const x = o.getContext('2d'); x.drawImage(c, 0, 0, W, H)
    const d = x.getImageData(0, 0, W, H).data
    let edge = 0, sum = 0, n = 0
    for (let y = Math.floor(H * 0.6); y < Math.floor(H * 0.92); y++) {
      for (let xx = Math.floor(W * 0.35); xx < Math.floor(W * 0.85); xx++) {
        const i = (y * W + xx) * 4, i2 = ((y + 2) * W + xx) * 4
        const L1 = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        const L2 = 0.299 * d[i2] + 0.587 * d[i2 + 1] + 0.114 * d[i2 + 2]
        edge += Math.abs(L1 - L2); sum += L1; n++
      }
    }
    return { edge: edge / n, mean: sum / n }
  })
  ok(floor.edge > 1.2 && floor.mean > 30 && floor.mean < 235, `floor texture renders with detail under realism (edge ${floor.edge.toFixed(2)}, mean ${floor.mean.toFixed(1)})`)

  // (2b) the LIGHTS TOGGLE works in the app: clicking it dims the scene (E's room lights go off).
  const clickLights = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Lights (on|off)/.test(x.textContent || ''))
    if (b) { b.click(); return true }
    return false
  })
  ok(await clickLights(), 'Lights toggle button found + clicked')
  await sleep(1200)
  const off = await page.evaluate(MEAN)
  writeFileSync(`${OUT}/11-app-lights-off.png`, await page.screenshot({ encoding: 'binary' }))
  ok(off && s && off.mean < s.mean - 1, `lights OFF dims the scene (mean ${s?.mean.toFixed(1)} → ${off?.mean.toFixed(1)})`)
  await clickLights() // back on
  await sleep(1000)
  const back = await page.evaluate(MEAN)
  ok(back && s && Math.abs(back.mean - s.mean) < 6, `lights back ON restores brightness (mean ${back?.mean.toFixed(1)} ≈ ${s?.mean.toFixed(1)})`)

  // (3) no critical console errors from the realism mount (ignore backend-auth / favicon noise).
  const critical = errs.filter((e) => !/favicon|401|unauthorized|403|404|Download the React DevTools|ffmpeg/i.test(e))
  ok(critical.length === 0, `no critical console errors (${critical.length})`)
  if (critical.length) critical.slice(0, 6).forEach((e) => console.log('     err:', e.slice(0, 200)))
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}
console.log(fail ? `\n${fail} FAILED` : '\nAPP MOUNT OK — screenshot in rendering/verify-out/10-app-realism.png')
process.exit(fail ? 1 : 0)
