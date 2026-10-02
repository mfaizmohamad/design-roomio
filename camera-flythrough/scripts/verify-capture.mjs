import puppeteer from 'puppeteer-core'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'http://localhost:5184'

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
await new Promise((r) => setTimeout(r, 1000))

let fail = 0
const ok = (c, m) => { console.log(`${c ? '✓' : '❌'} ${m}`); if (!c) fail++ }

console.log('WebCodecs available in this browser:', await page.evaluate(() => window.__fly.webCodecs()))

// short path so the test is quick
for (const [x, z] of [[-2, 1.5], [0, -1], [2, 1]]) await page.evaluate((x, z) => window.__fly.addWaypoint(x, z), x, z)
await page.evaluate(() => window.__fly.setDuration(2)) // 2s @ 30fps ≈ 60 frames

const res = await page.evaluate(async () => await window.__fly.capture(false))
ok(!!res, 'capture returned a result')
if (res) {
  console.log(`   frames=${res.frames} ${res.width}x${res.height} @${res.fps}fps webcodecs=${res.webcodecs} bytes=${res.byteLength}`)
  ok(res.frames >= 50 && res.frames <= 70, `rendered ~60 frames (got ${res.frames})`)
  ok(res.byteLength > 1000, `produced a non-trivial MP4 buffer (${res.byteLength} bytes)`)
  // MP4 begins with an 'ftyp' box: bytes[4..8] === 'ftyp'
  const ftyp = String.fromCharCode(...res.head.slice(4, 8))
  ok(ftyp === 'ftyp', `valid MP4 container (box='${ftyp}')`)
  ok(res.width % 2 === 0 && res.height % 2 === 0, 'even dimensions (AVC requirement)')
}

ok(errs.filter((e) => !/favicon|404/i.test(e)).length === 0, `no console errors${errs.length ? ' :: ' + errs.slice(0, 3).join(' | ') : ''}`)
console.log(fail ? `\nFAIL (${fail})` : '\nALL PASS')
await browser.close()
process.exit(fail ? 1 : 0)
