// Verify the whole-house view: add rooms, toggle "View whole house", screenshot.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = new URL('../verify-out/', import.meta.url).pathname
const vite = spawn('npx', ['vite', '--port', '5180', '--strictPort'], { cwd: '/Users/pratham/Desktop/personal/roomio', stdio: 'ignore' })
async function wait() { for (let i = 0; i < 120; i++) { try { if ((await fetch('http://localhost:5180/')).ok) return } catch {} await sleep(300) } }

let b
let failures = 0
const ok = (c, m) => { console.log(`${c ? '  ok' : 'FAIL'} - ${m}`); if (!c) failures++ }
try {
  await wait()
  b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1440,900'] })
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900 })
  const errors = []
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

  await p.goto('http://localhost:5180/?preset=bachelor', { waitUntil: 'networkidle0' })
  await p.waitForSelector('canvas', { timeout: 20000 })
  await sleep(1500)

  const addRoom = async (i) => {
    await p.evaluate(() => document.querySelector('[data-testid="add-room"]')?.click())
    await sleep(300)
    await p.evaluate((idx) => { document.querySelector('[data-testid="room-type-picker"]')?.querySelectorAll('button')[idx]?.click() }, i)
    await sleep(1000)
  }
  const clickText = (t) => p.evaluate((txt) => {
    const el = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(txt))
    if (el) { el.click(); return true } return false
  }, t)

  await addRoom(0) // bedroom
  await addRoom(2) // kitchen (or whatever index 2 is)
  const chips = await p.$$eval('[data-testid="room-chip"]', (e) => e.length)
  ok(chips >= 3, `added rooms (${chips} total)`)

  // toggle whole-house view
  const toggled = await clickText('View whole house')
  ok(toggled, 'found + clicked "View whole house"')
  await sleep(1500)
  writeFileSync(OUT + 'house-1-overview.png', await p.screenshot())

  const inHouse = await p.evaluate(() => !!Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Edit a room')))
  ok(inHouse, 'switched to house mode (toggle now says "Edit a room")')

  // collider debug overlay: visualize the flythrough collision footprints
  const toggledCol = await clickText('Colliders')
  ok(toggledCol, 'found + clicked the "Colliders" debug toggle')
  await sleep(800)
  writeFileSync(OUT + 'house-3-colliders.png', await p.screenshot())

  // back to single room
  await clickText('Edit a room')
  await sleep(1000)
  writeFileSync(OUT + 'house-2-back.png', await p.screenshot())
  const backToRoom = await p.evaluate(() => !!Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('View whole house')))
  ok(backToRoom, 'switched back to single-room edit')

  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'} · errors=${JSON.stringify(errors)}`)
} finally {
  if (b) await b.close()
  vite.kill('SIGTERM')
}
process.exit(failures === 0 ? 0 : 1)
