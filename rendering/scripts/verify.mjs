// Headless harness verification (Agent G). Spawns the rendering harness on :5188, drives it via
// window.__rendering with puppeteer + SwiftShader, samples canvas luminance, and proves the realism
// stack is doing visible, correct work vs the flat baseline. Screenshots land in verify-out/.
//
// Pattern mirrors lighting/camera-flythrough verify scripts (swiftshader flags, pixel sampling).

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'verify-out')
const PORT = 5188
const URL = `http://localhost:${PORT}/`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function ok(cond, msg) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} - ${msg}`)
  if (!cond) failures++
}

// In-page: draw the WebGL canvas into a small offscreen buffer and return luminance stats + array.
const SAMPLE = `(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const W = 160, H = 100;
  const off = document.createElement('canvas'); off.width = W; off.height = H;
  const ctx = off.getContext('2d');
  ctx.drawImage(c, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  const lum = new Array(W * H);
  let sum = 0, dark = 0, bright = 0;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const L = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lum[j] = L; sum += L;
    if (L < 12) dark++;
    if (L > 235) bright++;
  }
  const n = W * H;
  const mean = sum / n;
  let varsum = 0;
  for (let j = 0; j < n; j++) varsum += (lum[j] - mean) ** 2;
  return { mean, std: Math.sqrt(varsum / n), darkFrac: dark / n, brightFrac: bright / n, lum };
})()`

function diffPct(a, b) {
  let changed = 0
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 18) changed++
  return (changed / a.length) * 100
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(URL)
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    await sleep(300)
  }
  throw new Error('vite did not come up on ' + URL)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })

  let browser
  try {
    await waitForServer()
    const puppeteer = (await import('puppeteer-core')).default
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
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })

    const errors = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 })
    await page.waitForSelector('canvas', { timeout: 15000 })
    await page.waitForFunction('!!window.__rendering', { timeout: 10000 })
    await sleep(1800) // let IBL bake + composer + first frames settle

    // 1) Realism ON (default), high quality
    const realism = await page.evaluate(SAMPLE)
    writeFileSync(join(OUT, '02-realism-high.png'), await page.screenshot({ encoding: 'binary' }))
    ok(realism != null, 'sampled the realism (high) frame')
    ok(realism.mean > 20 && realism.mean < 250, `realism frame is not black/blown (mean ${realism.mean.toFixed(1)})`)
    ok(realism.darkFrac < 0.9, `realism frame is not mostly black (darkFrac ${(realism.darkFrac * 100).toFixed(1)}%)`)

    // 1a) TEXTURES: the textured floor renders with visible plank detail (high-frequency spatial
    // variation) AND at a sensible brightness (correct sRGB colour space — not washed white/black).
    const floor = await page.evaluate(() => {
      const c = document.querySelector('canvas')
      const W = 480, H = 300
      const o = document.createElement('canvas'); o.width = W; o.height = H
      const x = o.getContext('2d'); x.drawImage(c, 0, 0, W, H)
      const d = x.getImageData(0, 0, W, H).data
      let edge = 0, sum = 0, n = 0
      for (let y = Math.floor(H * 0.6); y < Math.floor(H * 0.9); y++) {
        for (let xx = Math.floor(W * 0.12); xx < Math.floor(W * 0.62); xx++) {
          const i = (y * W + xx) * 4, i2 = ((y + 2) * W + xx) * 4
          const L1 = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
          const L2 = 0.299 * d[i2] + 0.587 * d[i2 + 1] + 0.114 * d[i2 + 2]
          edge += Math.abs(L1 - L2); sum += L1; n++
        }
      }
      return { edge: edge / n, mean: sum / n }
    })
    ok(floor.edge > 1.5, `textured floor shows plank detail (vert edge ${floor.edge.toFixed(2)})`)
    ok(floor.mean > 40 && floor.mean < 230, `floor texture at sane brightness — sRGB not washed (mean ${floor.mean.toFixed(1)})`)

    // 1b) Turn the LIGHTS OFF — both the light AND the bloom glow must drop together.
    await page.evaluate('window.__rendering.setLights(false)')
    await sleep(900)
    const lightsOff = await page.evaluate(SAMPLE)
    writeFileSync(join(OUT, '07-lights-off.png'), await page.screenshot({ encoding: 'binary' }))
    ok(lightsOff.brightFrac < realism.brightFrac, `bulb glow (bloom) drops when lights off (${(realism.brightFrac * 100).toFixed(2)}% → ${(lightsOff.brightFrac * 100).toFixed(2)}%)`)
    ok(lightsOff.mean < realism.mean, `room dims when lights off (mean ${realism.mean.toFixed(1)} → ${lightsOff.mean.toFixed(1)})`)
    await page.evaluate('window.__rendering.setLights(true)')
    await sleep(600)

    // 2) Flat baseline (RealismLayer off)
    await page.evaluate('window.__rendering.setRealism(false)')
    await sleep(900)
    const flat = await page.evaluate(SAMPLE)
    writeFileSync(join(OUT, '01-flat-baseline.png'), await page.screenshot({ encoding: 'binary' }))
    ok(flat != null, 'sampled the flat baseline frame')

    // 3) The realism stack must VISIBLY change the image vs flat (tone map + IBL + AO + bloom).
    const d = diffPct(flat.lum, realism.lum)
    ok(d > 12, `realism differs from flat baseline (${d.toFixed(1)}% of pixels changed)`)
    console.log(`     flat:    mean ${flat.mean.toFixed(1)}  std ${flat.std.toFixed(1)}  bright ${(flat.brightFrac * 100).toFixed(2)}%`)
    console.log(`     realism: mean ${realism.mean.toFixed(1)}  std ${realism.std.toFixed(1)}  bright ${(realism.brightFrac * 100).toFixed(2)}%`)

    // 4) Quality "low" still renders (post drops, but IBL + tone mapping foundation stays) — no crash.
    await page.evaluate('window.__rendering.setRealism(true); window.__rendering.setQuality("low")')
    await sleep(1100)
    const low = await page.evaluate(SAMPLE)
    writeFileSync(join(OUT, '03-realism-low.png'), await page.screenshot({ encoding: 'binary' }))
    ok(low != null && low.mean > 20 && low.darkFrac < 0.9, `"low" quality still renders a lit room (mean ${low?.mean.toFixed(1)})`)

    // 5) Exposure knob visibly brightens (compensates ACES). Back to high + exposure up.
    await page.evaluate('window.__rendering.setQuality("high"); window.__rendering.setExposure(1.5)')
    await sleep(900)
    const exposed = await page.evaluate(SAMPLE)
    writeFileSync(join(OUT, '04-realism-exposure-1.5.png'), await page.screenshot({ encoding: 'binary' }))
    ok(exposed != null && exposed.mean > realism.mean - 1, `exposure 1.5 does not darken vs 1.0 (mean ${exposed?.mean.toFixed(1)} vs ${realism.mean.toFixed(1)})`)

    // 6) The pipeline ran headless without WebGL/postprocessing console errors.
    const realErrors = errors.filter((e) => !/favicon|404|Download the React DevTools/i.test(e))
    ok(realErrors.length === 0, `no console errors (${realErrors.length})`)
    if (realErrors.length) realErrors.slice(0, 6).forEach((e) => console.log('     err:', e.slice(0, 200)))
  } finally {
    if (browser) await browser.close()
    vite.kill('SIGTERM')
  }

  console.log(failures === 0 ? '\nALL PASSED — screenshots in verify-out/' : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
