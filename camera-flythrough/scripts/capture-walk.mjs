import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'
const personas = (() => { const j = JSON.parse(readFileSync('src/data/personas.json', 'utf8')); return Array.isArray(j) ? j : (j.personas || []) })()
const P = (g) => personas.find((x) => x.genre_id === g)
const W = 1512, H = 950
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport: { width: W, height: H, deviceScaleFactor: 2 }, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`] })
const p = await b.newPage()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await p.goto('http://localhost:5180/?stage=furnish&seed=1', { waitUntil: 'networkidle0' }); await sleep(2800)
await p.evaluate((pp) => window.__roomio.getState().loadPreset(pp), P('neo_deco')); await sleep(1600)
await p.evaluate(() => window.__roomioFly.openPanel()); await sleep(500)
await p.evaluate(() => window.__roomioFly.setMode('walk')); await sleep(500)
// stand near a corner and look toward the room centre so the POV shows furniture
await p.evaluate(() => {
  const fly = window.__roomioFly
  const c = fly.handle.getColliders().bounds
  const fr = fly.handle.frame()
  const px = c.minX + 0.24 * (c.maxX - c.minX)
  const pz = c.minZ + 0.24 * (c.maxZ - c.minZ)
  fly.walk.posCm = { x: px, z: pz }
  const wx = (px - fr.cx) / 100, wz = (pz - fr.cz) / 100
  const yaw = Math.atan2(wx, wz) // face world origin (room centre)
  fly.walk.camera.rotation.set(0, yaw, 0)
  fly.walk.camera.quaternion.setFromEuler(fly.walk.camera.rotation)
})
await sleep(700)
const clip = await p.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } })
await p.screenshot({ path: 'docs/screenshots/uc-flythrough-walk.png', clip })
console.log('  ✓ uc-flythrough-walk (re-aimed)')
await b.close()
