// Render A's real furniture (?probe=furniture) under realism lighting + screenshot, to verify NEW
// furniture (washing machine). Usage: node rendering/scripts/verify-furniture.mjs <suffix>
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..'), OUT = join(ROOT, 'verify-out'), PORT = 5188
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const suffix = process.argv[2] || 'probe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })
let browser
try {
  const t = Date.now(); while (Date.now() - t < 30000) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await sleep(300) }
  const puppeteer = (await import('puppeteer-core')).default
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,800'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto(`http://localhost:${PORT}/?probe=furniture`, { waitUntil: 'networkidle0', timeout: 30000 })
  await page.waitForSelector('canvas', { timeout: 15000 })
  await sleep(2000)
  writeFileSync(join(OUT, `furniture-${suffix}.png`), await page.screenshot({ encoding: 'binary' }))
  const real = errs.filter((e) => !/favicon|404|DevTools/i.test(e))
  console.log(`furniture-${suffix}.png written; console errors: ${real.length}`)
  real.slice(0, 4).forEach((e) => console.log('  err:', e.slice(0, 160)))
} finally { if (browser) await browser.close(); vite.kill('SIGTERM') }
process.exit(0)
