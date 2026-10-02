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
await new Promise((r) => setTimeout(r, 1000))

let fail = 0
const ok = (c, m) => { console.log(`${c ? '✓' : '❌'} ${m}`); if (!c) fail++ }

// author a 4-point path
const wps = [[-2.3, 1.4], [-0.7, -0.6], [1.1, 0.7], [2.3, -1.3]]
for (const [x, z] of wps) await page.evaluate((x, z) => window.__fly.addWaypoint(x, z), x, z)
await page.evaluate(() => window.__fly.setDuration(6))

ok((await page.evaluate(() => window.__fly.totalTime())) === 6, 'total time = duration (6s, no dwell)')

// pose at t=0 and t=1 should differ (camera travels)
const p0 = await page.evaluate(() => window.__fly.poseAt(0))
const p1 = await page.evaluate(() => window.__fly.poseAt(1))
const travel = Math.hypot(p1.position[0] - p0.position[0], p1.position[2] - p0.position[2])
ok(travel > 2, `camera travels along path (${travel.toFixed(2)} m end-to-end)`)
ok(Math.hypot(p0.position[0] - p0.target[0], p0.position[2] - p0.target[2]) > 0.05, 'look target differs from position (turns)')

// constant speed: sample 60 steps, step distances near-uniform
const steps = []
let prev = (await page.evaluate(() => window.__fly.poseAt(0))).position
for (let i = 1; i <= 60; i++) {
  const p = (await page.evaluate((u) => window.__fly.poseAt(u), i / 60)).position
  steps.push(Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]))
  prev = p
}
const ratio = Math.max(...steps) / Math.min(...steps)
ok(ratio < 1.2, `constant speed (max/min step ratio ${ratio.toFixed(3)})`)

// play and confirm progress advances with wall-clock
await page.evaluate(() => window.__fly.seek(0))
await page.evaluate(() => window.__fly.play())
await new Promise((r) => setTimeout(r, 200))
await page.screenshot({ path: `${OUT}/07-playback-topdown.png` }) // gizmo mid-path
const prog = await page.evaluate(() => window.__fly.progress01())
ok(prog > 0.005 && prog < 1, `playing: progress advanced to ${(prog * 100).toFixed(1)}%`)

// switch to POV mid-flight and screenshot the gliding camera view
await page.evaluate(() => window.__fly.togglePov())
await new Promise((r) => setTimeout(r, 250))
await page.screenshot({ path: `${OUT}/08-playback-pov.png` })

// let it finish; non-loop should stop at 100% and pause
await new Promise((r) => setTimeout(r, 6500))
const done = await page.evaluate(() => ({ p: window.__fly.progress01(), playing: window.__fly.isPlaying() }))
ok(done.p > 0.98 && !done.playing, `reached end and auto-paused (p=${(done.p * 100).toFixed(0)}%, playing=${done.playing})`)

ok(errs.filter((e) => !/favicon|404/i.test(e)).length === 0, `no console errors${errs.length ? ' :: ' + errs.slice(0, 2).join(' | ') : ''}`)
console.log(fail ? `\nFAIL (${fail})` : '\nALL PASS')
await browser.close()
process.exit(fail ? 1 : 0)
