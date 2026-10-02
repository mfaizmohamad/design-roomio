// BEFORE-fix evidence for WIZ-06: add a flatscreen TV from the catalog path
// (addFurnitureCentered — same call the catalog button makes) in a blank room
// and record where it lands + whether the placement warning fires.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE || 'http://localhost:5313'
const OUT = process.env.OUT || '/tmp/tv-before'
fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--window-size=1680,1000',
  ],
})
const page = await browser.newPage()
await page.setViewport({ width: 1680, height: 1000 })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto(`${BASE}/?stage=furnish`, { waitUntil: 'networkidle0', timeout: 30000 })
await new Promise((r) => setTimeout(r, 2500))

const info = await page.evaluate(() => {
  const store = window.__roomio
  const st = store.getState()
  const id = st.addFurnitureCentered('decor-tv')
  const s2 = store.getState()
  const tv = s2.design.furniture.find((f) => f.id === id)
  // distance from TV center to nearest wall segment (centerline)
  const corners = s2.design.corners
  const distToSeg = (px, pz, a, b) => {
    const abx = b.x - a.x, abz = b.z - a.z
    const len2 = abx * abx + abz * abz || 1
    let t = ((px - a.x) * abx + (pz - a.z) * abz) / len2
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(px - (a.x + t * abx), pz - (a.z + t * abz))
  }
  let dist = Infinity
  for (let i = 0; i < corners.length; i++) {
    dist = Math.min(dist, distToSeg(tv.x, tv.z, corners[i], corners[(i + 1) % corners.length]))
  }
  s2.selectFurniture(null)
  return { tv: { x: tv.x, z: tv.z, rotation: tv.rotation, w: tv.w, d: tv.d, h: tv.h }, corners, distToNearestWall: dist }
})
console.log(JSON.stringify(info, null, 2))

await new Promise((r) => setTimeout(r, 1800))
const warning = await page.evaluate(() => {
  const t = document.body.innerText
  return {
    hasPlacementWarnings: t.includes('Placement warnings'),
    warningLine: (t.split('\n').find((l) => l.includes('against a wall')) || null),
  }
})
console.log(JSON.stringify(warning, null, 2))

await page.screenshot({ path: `${OUT}/before-tv-spawn.png` })
console.log('saved', `${OUT}/before-tv-spawn.png`)
await browser.close()
