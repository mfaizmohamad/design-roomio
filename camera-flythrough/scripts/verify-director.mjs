import puppeteer from 'puppeteer-core'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'http://localhost:5184'
const OUT = 'camera-flythrough/scripts/__shots'
import { mkdirSync } from 'node:fs'
mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,800'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
const errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message))
await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 })
await new Promise((r) => setTimeout(r, 1200))

let fail = 0
const ok = (c, m) => { console.log(`${c ? '✓' : '❌'} ${m}`); if (!c) fail++ }

ok((await page.evaluate(() => window.__fly.getMode())) === 'director', 'starts in director (top-down) mode')
await page.screenshot({ path: `${OUT}/03-director-topdown.png` })

ok((await page.evaluate(() => window.__fly.isPov())) === false, 'starts top-down (not POV)')
const pov = await page.evaluate(() => window.__fly.togglePov())
ok(pov === true, 'POV toggle flips to camera POV')
await new Promise((r) => setTimeout(r, 400))
await page.screenshot({ path: `${OUT}/04-director-pov.png` })

await page.evaluate(() => window.__fly.togglePov())
ok((await page.evaluate(() => window.__fly.isPov())) === false, 'POV toggle flips back to top-down')

ok(errs.filter((e) => !/favicon|404/i.test(e)).length === 0, `no console errors${errs.length ? ' :: ' + errs.slice(0, 2).join(' | ') : ''}`)
console.log(fail ? `\nFAIL (${fail})` : '\nALL PASS')
await browser.close()
process.exit(fail ? 1 : 0)
