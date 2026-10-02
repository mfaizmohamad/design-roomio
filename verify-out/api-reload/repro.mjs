// Live reproduction of api-reload-auth: a 304 on the /api/health probe must NOT
// drop a logged-in user into offline/guest mode.
//
// Drives the REAL shipped modules (Vite serves /src/api.ts & /src/auth.ts as
// ESM) under a forced-304 condition, exactly what a browser reload triggers
// once Express has handed out an ETag for /api/health.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'http://localhost:5321'
const OUT = process.argv[2] || '/Users/pratham/Desktop/personal/roomio/.claude/worktrees/agent-ab0688ff5529b2434/verify-out/api-reload'
const PHASE = process.argv[3] || 'before'

const results = {}
const log = (...a) => console.log(...a)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1280,900'],
})

// A "mode" state machine drives request interception so one page can probe
// several backend behaviours in sequence.
let mode = 'passthrough'
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })
await page.setCacheEnabled(true)
await page.setRequestInterception(true)
page.on('request', (req) => {
  const url = req.url()
  if (url.includes('/api/health')) {
    if (mode === 'force304') return req.respond({ status: 304, headers: { ETag: 'W/"stub"' }, body: '' })
    if (mode === 'force500') return req.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'db down' }) })
    if (mode === 'refuse') return req.abort('connectionrefused')
  }
  if (url.includes('/api/auth/me') && (mode === 'force304' || mode === 'authok')) {
    return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'u1', email: 'reload@test.dev', name: 'Reload User' } }) })
  }
  req.continue()
})

// Record every /api/health response status the browser actually surfaces.
const healthResponses = []
page.on('response', (res) => {
  if (res.url().includes('/api/health')) healthResponses.push(res.status())
})

await page.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 30000 })
await new Promise((r) => setTimeout(r, 800))

// Helper: run code in-page against the real modules.
const inPage = (fn) => page.evaluate(fn)

// 1) Baseline: real server, no interception. Should be reachable.
mode = 'passthrough'
results.baseline_backendAvailable = await inPage(async () => {
  const m = await import('/src/api.ts')
  return await m.backendAvailable()
})

// 2) THE BUG: force the health probe to answer 304 (the reload-revalidation
//    case) and ask the real backendAvailable().
mode = 'force304'
results.force304_backendAvailable = await inPage(async () => {
  const m = await import('/src/api.ts')
  return await m.backendAvailable()
})

// 3) Full authed-user boot with health=304 + /auth/me=logged-in. The real
//    auth store's init() decides authed vs offline.
results.force304_authStatus = await inPage(async () => {
  const auth = await import('/src/auth.ts')
  await auth.useAuth.getState().init()
  return auth.useAuth.getState().status
})

// 4) Genuinely-down backend must STILL yield unavailable (no regression).
mode = 'force500'
results.force500_backendAvailable = await inPage(async () => {
  const m = await import('/src/api.ts')
  return await m.backendAvailable()
})
mode = 'refuse'
results.refuse_backendAvailable = await inPage(async () => {
  const m = await import('/src/api.ts')
  return await m.backendAvailable()
})

results.healthResponseStatuses = healthResponses
results.phase = PHASE

// Screenshot the app in the force304 authed-boot state for the record.
mode = 'force304'
await inPage(async () => {
  const auth = await import('/src/auth.ts')
  await auth.useAuth.getState().init()
})
await new Promise((r) => setTimeout(r, 400))
await page.screenshot({ path: `${OUT}/${PHASE}-app-health304.png` })

fs.writeFileSync(`${OUT}/${PHASE}-results.json`, JSON.stringify(results, null, 2))
log(JSON.stringify(results, null, 2))

await browser.close()
