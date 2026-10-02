// EXTENSIVE texture diagnostics. Probes the textured floor under the realism stack: detail, sRGB
// colour-space correctness, tiling across depth, every quality level, flat-vs-realism, lights on/off,
// and whether the texture survives into the PATH-TRACED render. Prints PASS/WARN/FAIL + screenshots.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'verify-out', 'diag-tex')
const PORT = 5188
const URL = `http://localhost:${PORT}/`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0, warns = 0
const line = (v, m, extra = '') => { console.log(`  ${v === 'PASS' ? 'ok  ' : v === 'WARN' ? 'warn' : 'FAIL'} - ${m}${extra ? '  ::  ' + extra : ''}`); if (v === 'FAIL') fails++; if (v === 'WARN') warns++ }

// Measure texture detail (vertical-adjacent |lum diff|) + mean brightness in a floor sub-region,
// expressed in fractional canvas coords so we can probe near vs far floor.
const FLOOR = (x0, y0, x1, y1) => `(() => {
  const c=document.querySelector('canvas'); if(!c) return null;
  const W=520,H=340; const o=document.createElement('canvas'); o.width=W; o.height=H;
  const x=o.getContext('2d'); x.drawImage(c,0,0,W,H);
  const d=x.getImageData(0,0,W,H).data;
  let edge=0,sum=0,n=0;
  const X0=Math.floor(W*${x0}),X1=Math.floor(W*${x1}),Y0=Math.floor(H*${y0}),Y1=Math.floor(H*${y1});
  for(let y=Y0;y<Y1;y++)for(let xx=X0;xx<X1;xx++){
    const i=(y*W+xx)*4,i2=((y+2)*W+xx)*4;
    const L1=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2], L2=0.299*d[i2]+0.587*d[i2+1]+0.114*d[i2+2];
    edge+=Math.abs(L1-L2); sum+=L1; n++;
  }
  return { edge:edge/n, mean:sum/n };
})()`

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

  const near = () => page.evaluate(FLOOR(0.12, 0.72, 0.62, 0.96)) // front floor strip
  const far = () => page.evaluate(FLOOR(0.15, 0.55, 0.6, 0.7))    // receding floor near the walls

  // 1) detail present (realism on, high).
  const rHigh = await near()
  writeFileSync(join(OUT, 'tex-00-realism-high.png'), await page.screenshot({ encoding: 'binary' }))
  line(rHigh.edge > 1.5 ? 'PASS' : 'FAIL', 'textured floor shows plank detail (realism/high)', `edge ${rHigh.edge.toFixed(2)}`)

  // 2) sRGB colour space: floor renders at a sane mid brightness (authored tones ~luma 130) — not
  //    crushed dark (double-decoded) nor washed white (undecoded).
  line(rHigh.mean > 55 && rHigh.mean < 210 ? 'PASS' : 'FAIL', 'floor texture at correct sRGB brightness (not washed/crushed)', `mean ${rHigh.mean.toFixed(1)}`)

  // 3) tiling across depth: detail present in BOTH the near strip and the receding far strip.
  const farHigh = await far()
  line(farHigh.edge > 1.0 ? 'PASS' : 'WARN', 'texture tiles across depth (detail near AND far)', `near ${rHigh.edge.toFixed(2)} / far ${farHigh.edge.toFixed(2)}`)

  // 4) every quality level renders the texture (texture is a material map, not a post effect).
  for (const q of ['medium', 'low', 'high']) {
    await page.evaluate((qq) => window.__rendering.setQuality(qq), q)
    await sleep(800)
    const s = await near()
    line(s.edge > 1.2 ? 'PASS' : 'FAIL', `texture renders at quality=${q}`, `edge ${s.edge.toFixed(2)}`)
  }

  // 5) flat baseline vs realism: texture visible in BOTH (map is material-level), realism relights it.
  await page.evaluate('window.__rendering.setRealism(false)')
  await sleep(900)
  const flat = await near()
  writeFileSync(join(OUT, 'tex-01-flat.png'), await page.screenshot({ encoding: 'binary' }))
  line(flat.edge > 1.2 ? 'PASS' : 'FAIL', 'texture visible in flat baseline too (material map, not post-FX)', `edge ${flat.edge.toFixed(2)}`)
  await page.evaluate('window.__rendering.setRealism(true)')
  await sleep(900)

  // 6) lights off: texture still present (dimmer).
  await page.evaluate('window.__rendering.setLights(false)')
  await sleep(900)
  const off = await near()
  writeFileSync(join(OUT, 'tex-02-lights-off.png'), await page.screenshot({ encoding: 'binary' }))
  line(off.edge > 0.8 ? 'PASS' : 'WARN', 'texture still renders with lights off (dimmer)', `edge ${off.edge.toFixed(2)}, mean ${off.mean.toFixed(1)}`)
  await page.evaluate('window.__rendering.setLights(true)')
  await sleep(700)

  // 7) the texture survives into the PATH-TRACED still (the tracer bakes the material map).
  await page.evaluate('window.__heroWatchdogMs = 120000')
  await page.evaluate('window.__rendering.store.getState().patch({ heroRender: { samples: 5 } })')
  await page.evaluate('window.__rendering.store.getState().setHeroActive(true)')
  let hs = 0
  for (let w = 0; w < 80000; w += 3000) { await sleep(3000); hs = await page.evaluate('window.__rendering.store.getState().heroSamples'); if (hs >= 5) break }
  const traced = await near()
  writeFileSync(join(OUT, 'tex-03-pathtraced.png'), await page.screenshot({ encoding: 'binary' }))
  line(hs >= 5 && traced.edge > 1.2 ? 'PASS' : 'WARN', 'texture present in the PATH-TRACED render (tracer bakes the map)', `samples ${hs}, edge ${traced.edge.toFixed(2)}`)
  await page.evaluate('window.__rendering.store.getState().setHeroActive(false)')

  const real = errs.filter((e) => !/favicon|404|DevTools/i.test(e))
  line(real.length === 0 ? 'PASS' : 'FAIL', 'no console errors across texture session', `${real.length}`)
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}
console.log(`\nTEXTURE DIAGNOSTICS: ${fails} fail, ${warns} warn. Evidence in verify-out/diag-tex/`)
process.exit(fails ? 1 : 0)
