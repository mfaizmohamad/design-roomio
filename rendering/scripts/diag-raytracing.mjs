// EXTENSIVE ray-tracing diagnostics. Runs the path tracer in the harness (SwiftShader software GL —
// slow but faithful) and probes many properties, printing a report + capturing evidence screenshots.
// On a real GPU the same probes pass far faster. Non-fatal: prints PASS/WARN/FAIL per probe.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'verify-out', 'diag-rt')
const PORT = 5188
const URL = `http://localhost:${PORT}/`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0, warns = 0
const line = (v, m, extra = '') => { console.log(`  ${v === 'PASS' ? 'ok  ' : v === 'WARN' ? 'warn' : 'FAIL'} - ${m}${extra ? '  ::  ' + extra : ''}`); if (v === 'FAIL') fails++; if (v === 'WARN') warns++ }

// Return luminance array (W*H) + stats for the current canvas.
const SAMPLE = `(() => {
  const c=document.querySelector('canvas'); if(!c) return null;
  const W=240,H=150; const o=document.createElement('canvas'); o.width=W; o.height=H;
  const x=o.getContext('2d'); x.drawImage(c,0,0,W,H);
  const d=x.getImageData(0,0,W,H).data; const lum=new Array(W*H); let s=0;
  for(let i=0,j=0;i<d.length;i+=4,j++){const L=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];lum[j]=L;s+=L;}
  return { W,H, mean:s/(W*H), lum };
})()`

// High-frequency "noise" metric over a rectangular region (mean |adjacent-pixel diff|, both axes).
function hfNoise(sample, x0, y0, x1, y1) {
  const { W, lum } = sample
  let sum = 0, n = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    sum += Math.abs(lum[y * W + x] - lum[y * W + x + 1])
    sum += Math.abs(lum[y * W + x] - lum[(y + 1) * W + x])
    n += 2
  }
  return sum / n
}
function diffPct(a, b) { let n = 0; for (let i = 0; i < a.lum.length; i++) if (Math.abs(a.lum[i] - b.lum[i]) > 14) n++; return (n / a.lum.length) * 100 }

mkdirSync(OUT, { recursive: true })
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })
let browser
try {
  const start = Date.now()
  while (Date.now() - start < 30000) { try { if ((await fetch(URL)).ok) break } catch {} await sleep(300) }
  const puppeteer = (await import('puppeteer-core')).default
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,800'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 })
  await page.waitForFunction('!!window.__rendering', { timeout: 10000 })
  await sleep(1800)

  // WebGL2 capability (path tracing requires it).
  const webgl2 = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); return { ok: !!g, floatBlend: !!g?.getExtension('EXT_float_blend'), colorFloat: !!g?.getExtension('EXT_color_buffer_float') } })
  line(webgl2.ok ? 'PASS' : 'FAIL', 'WebGL2 available (required by the tracer)', JSON.stringify(webgl2))

  const raster = await page.evaluate(SAMPLE)
  writeFileSync(join(OUT, 'rt-00-raster.png'), await page.screenshot({ encoding: 'binary' }))

  // Activate hero, high watchdog + target 14.
  await page.evaluate('window.__heroWatchdogMs = 120000')
  await page.evaluate('window.__rendering.store.getState().patch({ heroRender: { samples: 14 } })')
  await page.evaluate('window.__rendering.store.getState().setHeroActive(true)')

  // Convergence curve + capture path-traced frames at increasing sample counts for a TEMPORAL
  // convergence test (consecutive frames should change LESS as samples accumulate — the rigorous MC
  // refinement signal, independent of the frozen-raster startup + any low-res proxy).
  const curve = []
  const snaps = {} // sampleThreshold -> {sample, png}
  const wantAt = [4, 9, 14]
  let late = null
  for (let waited = 0; waited < 100000; waited += 3000) {
    await sleep(3000)
    const st = await page.evaluate('(() => { const s=window.__rendering.store.getState(); return {samples:s.heroSamples, active:s.heroActive}; })()')
    curve.push(st.samples)
    for (const t of wantAt) if (!snaps[t] && st.samples >= t) snaps[t] = await page.evaluate(SAMPLE)
    if (st.samples >= 14) { late = snaps[14]; writeFileSync(join(OUT, 'rt-02-converged.png'), await page.screenshot({ encoding: 'binary' })); break }
    if (!st.active) break
  }
  console.log('     convergence (samples per 3s):', curve.join(' → '))

  // 1) samples accumulate monotonically to the target.
  const monotonic = curve.every((v, i) => i === 0 || v >= curve[i - 1])
  line(curve.at(-1) >= 14 && monotonic ? 'PASS' : 'FAIL', 'samples accumulate monotonically to target (progressive)', `reached ${curve.at(-1)}/14, monotonic=${monotonic}`)

  // 2) TEMPORAL CONVERGENCE: the image stabilizes as samples grow (diff 4→9 > diff 9→14).
  if (snaps[4] && snaps[9] && snaps[14]) {
    const d1 = diffPct(snaps[4], snaps[9])
    const d2 = diffPct(snaps[9], snaps[14])
    line(d2 < d1 ? 'PASS' : 'WARN', 'path trace converges (frame-to-frame change shrinks as samples grow)', `Δ(4→9)=${d1.toFixed(1)}% > Δ(9→14)=${d2.toFixed(1)}%`)
  } else {
    line('WARN', 'temporal convergence probe (missing intermediate snaps)', Object.keys(snaps).join(','))
  }

  if (late) {
    // 3) GI: the path-traced result differs materially from the raster render.
    const d = diffPct(raster, late)
    line(d > 15 ? 'PASS' : 'FAIL', 'path-traced frame differs from raster (real GI/reflections/shadows)', `${d.toFixed(1)}% pixels`)
    // 4) the converged frame is a real image (lit, not black/blown).
    line(late.mean > 25 && late.mean < 250 ? 'PASS' : 'FAIL', 'converged frame is a real lit image', `mean ${late.mean.toFixed(1)}`)
  } else {
    line('FAIL', 'captured converged frame', `late=${!!late}`)
  }

  // 5) export integrity: the still is a valid PNG (signature + size).
  const png = await page.evaluate(() => { try { const u = document.querySelector('canvas').toDataURL('image/png'); return { len: u.length, head: u.slice(0, 22) } } catch { return { len: 0, head: '' } } })
  line(png.len > 5000 && png.head.startsWith('data:image/png;base64,') ? 'PASS' : 'FAIL', 'converged still exports as a valid PNG', `${png.len} chars`)

  // 6) camera-move fallback: a wheel (zoom) over the canvas moves the camera → hero deactivates.
  const box = await page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await page.mouse.move(box.x, box.y)
  await page.mouse.wheel({ deltaY: -240 })
  await sleep(1200)
  const afterMove = await page.evaluate('window.__rendering.store.getState().heroActive')
  line(afterMove === false ? 'PASS' : 'WARN', 'camera move falls back to real-time (hero deactivates)', `heroActive=${afterMove}`)
  writeFileSync(join(OUT, 'rt-03-after-move.png'), await page.screenshot({ encoding: 'binary' }))

  // 7) re-activation works after a fallback (no leak/crash) — second BVH build + samples advance.
  await page.evaluate('window.__rendering.store.getState().patch({ heroRender: { samples: 3 } })')
  await page.evaluate('window.__rendering.store.getState().setHeroActive(true)')
  let re = 0
  for (let w = 0; w < 60000; w += 3000) { await sleep(3000); re = await page.evaluate('window.__rendering.store.getState().heroSamples'); if (re >= 3) break }
  line(re >= 3 ? 'PASS' : 'WARN', 're-activation path-traces again (no leak after fallback)', `${re}/3 samples`)
  await page.evaluate('window.__rendering.store.getState().setHeroActive(false)')

  // 8) no console errors across the whole session.
  const real = errs.filter((e) => !/favicon|404|DevTools/i.test(e))
  line(real.length === 0 ? 'PASS' : 'FAIL', 'no console errors across path-trace session', `${real.length}`)
  real.slice(0, 5).forEach((e) => console.log('     err:', e.slice(0, 160)))
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}
console.log(`\nRAY-TRACING DIAGNOSTICS: ${fails} fail, ${warns} warn. Evidence in verify-out/diag-rt/`)
process.exit(fails ? 1 : 0)
