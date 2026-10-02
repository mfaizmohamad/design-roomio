// Verify the G5 hero PATH TRACER actually ray-traces (not just falls back). SwiftShader is a software
// GL — the first sample takes ~18s (shader compile + BVH build) then it climbs — so we raise the
// watchdog and allow a long window. Proves: (1) samples advance (real path tracing), (2) the
// path-traced frame DIFFERS from the raster frame (genuine GI/ray-tracing, not the raster passed
// through), (3) the still is exportable as PNG, (4) returning to live restores the raster view.
// On a real GPU this converges in a second or two.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'verify-out')
const PORT = 5189
const URL = `http://localhost:${PORT}/`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} - ${m}`); if (!c) failures++ }

const SAMPLE = `(() => {
  const c = document.querySelector('canvas'); if (!c) return null;
  const W=160,H=100; const o=document.createElement('canvas'); o.width=W; o.height=H;
  const x=o.getContext('2d'); x.drawImage(c,0,0,W,H);
  const d=x.getImageData(0,0,W,H).data; const lum=new Array(W*H); let s=0,dark=0;
  for(let i=0,j=0;i<d.length;i+=4,j++){const L=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];lum[j]=L;s+=L;if(L<12)dark++;}
  return { mean:s/(W*H), darkFrac:dark/(W*H), lum };
})()`
const diffPct = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 14) n++; return (n / a.length) * 100 }

mkdirSync(OUT, { recursive: true })
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })
let browser
try {
  const start = Date.now()
  while (Date.now() - start < 30000) { try { if ((await fetch(URL)).ok) break } catch {} await sleep(300) }
  const puppeteer = (await import('puppeteer-core')).default
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,800'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 })
  await page.waitForFunction('!!window.__rendering', { timeout: 10000 })
  await sleep(1800)

  // raster reference frame (realism on, hero off)
  const raster = await page.evaluate(SAMPLE)
  ok(raster && raster.mean > 20, `raster reference frame captured (mean ${raster?.mean.toFixed(1)})`)

  // raise the watchdog + small target, then path-trace
  await page.evaluate('window.__heroWatchdogMs = 90000')
  await page.evaluate('window.__rendering.store.getState().patch({ heroRender: { samples: 6 } })')
  await page.evaluate('window.__rendering.store.getState().setHeroActive(true)')

  let samples = 0, active = true
  for (let waited = 0; waited < 60000; waited += 3000) {
    await sleep(3000)
    const st = await page.evaluate('(() => { const s=window.__rendering.store.getState(); return {samples:s.heroSamples, active:s.heroActive}; })()')
    samples = st.samples; active = st.active
    if (samples >= 6 || !active) break
  }
  ok(samples >= 6, `path tracer accumulated samples (${samples}/6) — ray tracing runs`)
  ok(active, 'hero stayed active (did not falsely bail)')

  const traced = await page.evaluate(SAMPLE)
  writeFileSync(join(OUT, '05-hero-pathtraced.png'), await page.screenshot({ encoding: 'binary' }))
  const d = diffPct(raster.lum, traced.lum)
  ok(d > 15, `path-traced frame DIFFERS from raster (${d.toFixed(1)}% of pixels) — genuine ray-traced GI`)

  // the converged still is exportable as a PNG (what the Download button reads).
  const png = await page.evaluate(() => { try { return document.querySelector('canvas').toDataURL('image/png').length } catch { return 0 } })
  ok(png > 5000, `converged still exports as PNG (${png} chars)`)

  // returning to live restores the raster view.
  await page.evaluate('window.__rendering.store.getState().setHeroActive(false)')
  await sleep(1500)
  const live = await page.evaluate(SAMPLE)
  ok(live && live.mean > 20 && live.darkFrac < 0.9, `raster view restored after hero (mean ${live?.mean.toFixed(1)})`)

  const realErrors = errs.filter((e) => !/favicon|404|DevTools/i.test(e))
  ok(realErrors.length === 0, `no console errors (${realErrors.length})`)
  if (realErrors.length) realErrors.slice(0, 6).forEach((e) => console.log('     err:', e.slice(0, 200)))
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}
console.log(failures === 0 ? '\nRAY TRACING VERIFIED — path-traced still in verify-out/05-hero-pathtraced.png' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
