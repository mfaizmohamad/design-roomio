// Headless verification for F1 first-person walk + collision.
// Run from repo root so puppeteer-core resolves: node camera-flythrough/scripts/verify-walk.mjs
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'http://localhost:5184'
const OUT = 'camera-flythrough/scripts/__shots'
import { mkdirSync } from 'node:fs'
mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,800'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
const errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message))
await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 })
await new Promise((r) => setTimeout(r, 1500))

let fail = 0
const ok = (c, m) => { console.log(`${c ? '✓' : '❌'} ${m}`); if (!c) fail++ }

await page.screenshot({ path: `${OUT}/01-orbit.png` })

// point-in-polygon + furniture containment, recomputed in node from colliders
function pointInPoly(pt, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ci = poly[i], cj = poly[j]
    if ((ci.z > pt.z) !== (cj.z > pt.z) && pt.x < ((cj.x - ci.x) * (pt.z - ci.z)) / (cj.z - ci.z) + ci.x) inside = !inside
  }
  return inside
}
function inFurniture(pt, furn, margin) {
  for (const o of furn) {
    const c = Math.cos(o.rot), s = Math.sin(o.rot)
    const dx = pt.x - o.cx, dz = pt.z - o.cz
    const lx = dx * c + dz * -s, lz = dx * s + dz * c
    if (Math.abs(lx) <= o.w / 2 + margin && Math.abs(lz) <= o.d / 2 + margin) return o
  }
  return null
}

const colliders = await page.evaluate(() => window.__fly.colliders())
ok(!!colliders && colliders.walls.length === 4, `colliders present (${colliders?.walls?.length} walls, ${colliders?.furniture?.length} furniture)`)

await page.evaluate(() => window.__fly.setMode('walk'))
await new Promise((r) => setTimeout(r, 300))
ok((await page.evaluate(() => window.__fly.getMode())) === 'walk', 'entered walk mode')

// Walk forward 1.8s from room center along 8 headings; assert always legal.
const RADIUS = 18
const headings = [0, 45, 90, 135, 180, 225, 270, 315]
for (const deg of headings) {
  // re-enter to reset to center each time
  await page.evaluate(() => window.__fly.setMode('orbit'))
  await page.evaluate(() => window.__fly.setMode('walk'))
  await page.evaluate((d) => window.__fly.setWalkYaw((d * Math.PI) / 180), deg)
  await page.evaluate(() => window.__fly.pressKeys(['KeyW']))
  await new Promise((r) => setTimeout(r, 1800))
  await page.evaluate(() => window.__fly.releaseKeys(['KeyW']))
  const pos = await page.evaluate(() => window.__fly.walkPosCm())
  const inside = pointInPoly(pos, colliders.polygon)
  // allow tiny epsilon inside the wall margin
  const b = colliders.bounds
  const wallMargin = colliders.wallThickness / 2 + RADIUS - 1
  const insideWalls = pos.x >= b.minX + wallMargin && pos.x <= b.maxX - wallMargin && pos.z >= b.minZ + wallMargin && pos.z <= b.maxZ - wallMargin
  const fur = inFurniture(pos, colliders.furniture, -2) // -2: must be clearly outside footprint
  ok(inside && insideWalls && !fur, `heading ${deg}°: legal pos (${pos.x.toFixed(0)},${pos.z.toFixed(0)}) inside=${inside} walls=${insideWalls} hitFurn=${fur ? fur : 'none'}`)
}

await page.screenshot({ path: `${OUT}/02-walk-pov.png` })
ok(errs.filter((e) => !/favicon|404/i.test(e)).length === 0, `no console errors${errs.length ? ' :: ' + errs.slice(0, 3).join(' | ') : ''}`)

console.log(fail ? `\nFAIL (${fail})` : '\nALL PASS')
await browser.close()
process.exit(fail ? 1 : 0)
