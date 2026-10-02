// Headless verification of the in-app multi-room "Add room" + URL routing
// (Agent C). Boots the REAL app (root vite :5180) and drives Chrome to assert:
//   - the Furnish view shows an "Add room" control; adding a room creates a 2nd
//     room chip and switching between rooms works;
//   - every screen (and the active room) has its own URL (?stage=… [&room=…]);
//   - the browser BACK/FORWARD buttons move between screens AND rooms.
// Screenshots → multi-room/verify-out/. Exits non-zero on any failed assertion.

import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 5180
const BASE = `http://localhost:${PORT}/`
const OUT = new URL('../verify-out/', import.meta.url).pathname

let failures = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok' : 'FAIL'} - ${msg}`)
  if (!cond) failures++
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(BASE)
      if (r.ok) return true
    } catch {}
    await sleep(300)
  }
  throw new Error('vite did not start')
}

const title = (page) => page.$eval('.title', (el) => el.textContent || '').catch(() => '')
const clickByText = (page, text) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === t)
    if (!el) throw new Error(`button not found: ${t}`)
    el.click()
  }, text)
const roomParam = (page) => new URL(page.url()).searchParams.get('room')
const stageParam = (page) => new URL(page.url()).searchParams.get('stage')
async function waitForTitle(page, re, timeoutMs = 6000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (re.test(await title(page))) return true
    await sleep(100)
  }
  return false
}

mkdirSync(OUT, { recursive: true })
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../../', import.meta.url).pathname, // repo root
  stdio: 'ignore',
})

let browser
try {
  await waitForServer()
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1400,900'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })

  // ── URL routing across wizard stages ──
  await page.goto(`${BASE}?stage=step2&seed=1`, { waitUntil: 'networkidle0' })
  ok(await waitForTitle(page, /dimension/i), 'deep-link ?stage=step2 shows Step 2')
  ok(stageParam(page) === 'step2', `URL carries stage=step2 (${stageParam(page)})`)

  await clickByText(page, 'Next')
  ok(await waitForTitle(page, /doors and windows/i), 'Next → Step 3')
  ok(stageParam(page) === 'step3', 'URL updated to stage=step3')

  await clickByText(page, 'Next')
  await waitForTitle(page, /style/i)
  await clickByText(page, 'Design this room')
  ok(await waitForTitle(page, /furnish/i), 'Next → Furnish')
  ok(stageParam(page) === 'furnish', 'URL updated to stage=furnish')
  ok(!!roomParam(page), `Furnish URL carries a room id (${roomParam(page)})`)

  // ── browser BACK / FORWARD across stages ──
  await page.goBack({ waitUntil: 'networkidle0' })
  ok(await waitForTitle(page, /style/i), 'browser BACK → Step 4 (style)')
  ok(stageParam(page) === 'step4', 'URL after back is stage=step4')
  await page.goForward({ waitUntil: 'networkidle0' })
  ok(await waitForTitle(page, /furnish/i), 'browser FORWARD → Furnish')
  await page.screenshot({ path: `${OUT}app-furnish.png` })

  // ── multi-room: Add room + switch + URL per room + back/forward across rooms ──
  ok(!!(await page.$('[data-testid="add-room"]')), '"Add room" control is visible in Furnish')
  const room1 = roomParam(page)
  const chips0 = (await page.$$('[data-testid="room-chip"]')).length
  ok(chips0 === 1, `starts with 1 room chip (${chips0})`)

  await page.click('[data-testid="add-room"]')
  await page.waitForSelector('[data-testid="room-type-picker"]', { timeout: 4000 })
  await clickByText(page, 'Kitchen')
  await sleep(600)
  const chips1 = (await page.$$('[data-testid="room-chip"]')).length
  ok(chips1 === 2, `adding a room → 2 room chips (${chips1})`)
  const room2 = roomParam(page)
  ok(!!room2 && room2 !== room1, `new room has its own URL (room ${room1} → ${room2})`)
  await page.screenshot({ path: `${OUT}app-tworooms.png` })

  // switch back to room 1 (click the first room chip's switch button)
  await page.evaluate(() => {
    const chip = document.querySelector('[data-testid="room-chip"] button')
    chip?.click()
  })
  await sleep(500)
  ok(roomParam(page) === room1, `switching rooms updates the URL back to room1 (${roomParam(page)})`)

  // browser BACK should return to room 2 (rooms are distinct history entries)
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await sleep(500)
  ok(roomParam(page) === room2, `browser BACK navigates rooms (→ room2 ${roomParam(page)})`)
} catch (err) {
  console.error(err)
  failures++
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll multi-room + routing checks passed')
process.exit(failures ? 1 : 0)
