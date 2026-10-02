import puppeteer from 'puppeteer-core'
import { mkdirSync, readdirSync, statSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'http://localhost:5184'
const DL = resolve('camera-flythrough/scripts/__downloads')
rmSync(DL, { recursive: true, force: true })
mkdirSync(DL, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,800'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
const client = await page.createCDPSession()
await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL })
await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 })
await new Promise((r) => setTimeout(r, 1000))

let fail = 0
const ok = (c, m) => { console.log(`${c ? '✓' : '❌'} ${m}`); if (!c) fail++ }

for (const [x, z] of [[-2, 1.5], [0, -1], [2, 1]]) await page.evaluate((x, z) => window.__fly.addWaypoint(x, z), x, z)
await page.evaluate(() => window.__fly.setDuration(2))
// trigger the real Export MP4 button (download:true)
await page.evaluate(async () => await window.__fly.capture(true))

// wait for the .mp4 to land
let file = null
for (let i = 0; i < 30; i++) {
  const files = readdirSync(DL).filter((f) => f.endsWith('.mp4'))
  if (files.length && !files[0].endsWith('.crdownload')) { file = files[0]; break }
  await new Promise((r) => setTimeout(r, 300))
}
ok(!!file, `MP4 downloaded to disk (${file})`)
if (file) {
  const p = resolve(DL, file)
  const size = statSync(p).size
  ok(size > 1000, `downloaded file non-trivial (${size} bytes)`)
  const head = readFileSync(p).subarray(4, 8).toString('latin1')
  ok(head === 'ftyp', `downloaded file is a valid MP4 (box='${head}')`)
}
console.log(fail ? `\nFAIL (${fail})` : '\nALL PASS')
await browser.close()
process.exit(fail ? 1 : 0)
