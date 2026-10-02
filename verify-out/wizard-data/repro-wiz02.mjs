import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'http://localhost:5316'
const OUT = process.argv[2] || '/tmp/wiz02'
const TAG = process.argv[3] || 'before'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1680,1000'],
})

const page = await browser.newPage()
await page.setViewport({ width: 1680, height: 1000 })
await page.goto(`${BASE}/?stage=step2`, { waitUntil: 'networkidle0', timeout: 30000 })
await new Promise((r) => setTimeout(r, 2500))

const readState = () =>
  page.evaluate(() => {
    const s = window.__roomio.getState()
    const c = s.design.corners
    const xs = c.map((p) => p.x), zs = c.map((p) => p.z)
    const w = Math.max(...xs) - Math.min(...xs)
    const d = Math.max(...zs) - Math.min(...zs)
    return { w, d, wallLen: s.walls.map((wl) => Math.round(wl.length)) }
  })

const before = await readState()
console.log(JSON.stringify({ phase: 'initial', ...before }))
await page.screenshot({ path: `${OUT}-${TAG}-01-initial.png` })

// --- Test A: absurd wall length 999999 cm ---
// switch unit to cm so bare number = cm
await page.evaluate(() => window.__roomio.getState().setUnit('cm'))
await new Promise((r) => setTimeout(r, 300))

const inputs = await page.$$('.len-input')
console.log('len-input count:', inputs.length)
await inputs[0].click({ clickCount: 3 })
await page.keyboard.type('999999')
await page.keyboard.press('Enter')
await new Promise((r) => setTimeout(r, 1200))

const afterBig = await readState()
console.log(JSON.stringify({ phase: 'after-999999', ...afterBig }))
// read what the input shows + aria-invalid
const inpInfo = await page.evaluate(() => {
  const el = document.querySelector('.len-input')
  return { value: el?.value, ariaInvalid: el?.getAttribute('aria-invalid'), cls: el?.className }
})
console.log('input after 999999:', JSON.stringify(inpInfo))
await page.screenshot({ path: `${OUT}-${TAG}-02-after-999999.png` })

// --- Test B: bare "." (NaN) ---
// reload fresh
await page.goto(`${BASE}/?stage=step2`, { waitUntil: 'networkidle0', timeout: 30000 })
await new Promise((r) => setTimeout(r, 1500))
await page.evaluate(() => window.__roomio.getState().setUnit('cm'))
await new Promise((r) => setTimeout(r, 200))
const inputs2 = await page.$$('.len-input')
await inputs2[0].click({ clickCount: 3 })
await page.keyboard.type('.')
await page.keyboard.press('Enter')
await new Promise((r) => setTimeout(r, 800))
const afterDot = await readState()
const dotInfo = await page.evaluate(() => {
  const el = document.querySelector('.len-input')
  return { value: el?.value, ariaInvalid: el?.getAttribute('aria-invalid'), cls: el?.className }
})
// also test parseLen directly if exposed? not exposed. check corners for NaN
const hasNaN = await page.evaluate(() => {
  const c = window.__roomio.getState().design.corners
  return c.some((p) => Number.isNaN(p.x) || Number.isNaN(p.z))
})
console.log(JSON.stringify({ phase: 'after-dot', ...afterDot, hasNaN, dotInfo }))
await page.screenshot({ path: `${OUT}-${TAG}-03-after-dot.png` })

// --- Test C: garbage "abc" ---
await inputs2[0].click({ clickCount: 3 })
await page.keyboard.type('abc')
await page.keyboard.press('Enter')
await new Promise((r) => setTimeout(r, 600))
const abcInfo = await page.evaluate(() => {
  const el = document.querySelector('.len-input')
  return { value: el?.value, ariaInvalid: el?.getAttribute('aria-invalid'), cls: el?.className }
})
console.log('input after abc:', JSON.stringify(abcInfo))
await page.screenshot({ path: `${OUT}-${TAG}-04-after-abc.png` })

await browser.close()
console.log('DONE')
