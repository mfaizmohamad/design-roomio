// DIAGNOSTIC (not a pass/fail test): observe whether the path tracer advances samples in this
// headless env (SwiftShader software GL) given a long window. Prints sample progression over time.

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
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message))
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 })
  await page.waitForFunction('!!window.__rendering', { timeout: 10000 })
  await sleep(1500)

  await page.evaluate('window.__heroWatchdogMs = 90000') // disable the early bail so we can observe
  await page.evaluate('window.__rendering.store.getState().patch({ heroRender: { samples: 16 } })')
  await page.evaluate('window.__rendering.store.getState().setHeroActive(true)')
  console.log('activated hero; polling samples...')
  for (let t = 2; t <= 46; t += 4) {
    await sleep(4000)
    const st = await page.evaluate('(() => { const s = window.__rendering.store.getState(); return { active: s.heroActive, samples: s.heroSamples, supported: s.heroSupported }; })()')
    console.log(`  t=${t}s  samples=${st.samples}  active=${st.active}  supported=${st.supported}`)
    if (st.samples >= 16 || !st.active) break
  }
  writeFileSync(join(OUT, '08-hero-diag.png'), await page.screenshot({ encoding: 'binary' }))
  const errReal = errs.filter((e) => !/favicon|404|DevTools/i.test(e))
  console.log('console errors:', errReal.length, errReal.slice(0, 4).join(' | ').slice(0, 400))
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}
process.exit(0)
