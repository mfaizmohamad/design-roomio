// Headless verification of the persistence & sharing harness (Agent C, feature 2).
// Boots the Vite dev server and drives the real UI in Chrome to assert the
// trust-critical acceptance behaviours:
//   C2-1: new design autosaves; an edit flips status Saving… -> Saved; the edit
//         is optimistic (visible immediately); reload restores the design in the
//         My Designs grid WITH a thumbnail; manual save (Ctrl/Cmd-S) gives feedback.
// Screenshots land in verify-out/. Exits non-zero on any failed assertion.

import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 5187
const APP_URL = `http://localhost:${PORT}/`
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
      const r = await fetch(APP_URL)
      if (r.ok) return true
    } catch {}
    await sleep(300)
  }
  throw new Error('vite did not start')
}

const phase = (page) => page.$eval('[data-testid="save-status"]', (el) => el.getAttribute('data-phase'))
const statusText = (page) => page.$eval('[data-testid="save-status"]', (el) => el.textContent || '')
const clickByText = (page, text) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === t)
    if (!el) throw new Error(`button not found: ${t}`)
    el.click()
  }, text)

async function waitForPhase(page, want, timeoutMs = 6000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if ((await phase(page)) === want) return true
    await sleep(50)
  }
  return false
}

mkdirSync(OUT, { recursive: true })

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
})

let browser
try {
  await waitForServer()
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--window-size=1280,860',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 860 })
  // capture downloads (export artifacts) into a clean folder
  const DL = `${OUT}downloads/`
  try { rmSync(DL, { recursive: true, force: true }) } catch {}
  mkdirSync(DL, { recursive: true })
  const cdp = await page.target().createCDPSession()
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL })
  await page.goto(APP_URL, { waitUntil: 'networkidle0' })

  // Start clean so the run is deterministic.
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle0' })

  // 1) Create a new design → editor opens, status is Saved (autosaved on create).
  await clickByText(page, '+ New room')
  await page.waitForSelector('[data-testid="save-status"]', { timeout: 5000 })
  ok(await waitForPhase(page, 'saved', 4000), 'new design autosaves on create (no button)')
  await page.screenshot({ path: `${OUT}c2-1-editor.png` })

  // Capture the rev BEFORE the edit.
  const revBefore = await page.evaluate(() => window.__roomioRev?.() ?? null)

  // Record EVERY phase the indicator passes through (the 'saving' window is brief
  // because a local save is fast — sampling can miss it, so observe attributes).
  await page.evaluate(() => {
    window.__phases = []
    const el = document.querySelector('[data-testid="save-status"]')
    const push = () => window.__phases.push(el.getAttribute('data-phase'))
    push()
    new MutationObserver(push).observe(el, { attributes: true, attributeFilter: ['data-phase'] })
  })

  // 2) Make an edit → status passes through dirty → saving → saved (debounced).
  await clickByText(page, 'Move item →')
  ok(await waitForPhase(page, 'saved', 6000), 'save completes → "Saved <time>"')
  const phases = await page.evaluate(() => window.__phases)
  ok(phases.includes('dirty'), 'edit immediately marks unsaved (optimistic, debouncing)')
  ok(phases.includes('saving'), 'a debounced "Saving…" state is shown before Saved')
  const savedLabel = await statusText(page)
  ok(/saved/i.test(savedLabel), `status reads "${savedLabel.trim()}"`)

  // 3) rev incremented after the save (durable revision advanced).
  const revAfter = await page.evaluate(() => window.__roomioRev?.() ?? null)
  ok(revBefore !== null && revAfter !== null && revAfter > revBefore, `rev advanced ${revBefore} -> ${revAfter}`)

  // 4) Manual save (Ctrl/Cmd-S) gives feedback (no crash; lands on saved).
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyS')
  await page.keyboard.up('Control')
  ok(await waitForPhase(page, 'saved', 6000), 'manual Ctrl/Cmd-S resolves to Saved')

  // 4b) SIMULATED SAVE FAILURE → "retrying", data kept (never dropped), then recovery.
  const revBeforeFail = await page.evaluate(() => window.__roomioRev?.() ?? null)
  await page.evaluate(() => window.__roomioFail?.(true))
  await clickByText(page, 'Move item ↓')
  ok(await waitForPhase(page, 'error', 8000), 'save failure shows "Couldn’t save — retrying…"')
  const failText = await statusText(page)
  ok(/retry/i.test(failText), `failure status reads "${failText.trim()}"`)
  const revDuringFail = await page.evaluate(() => window.__roomioRev?.() ?? null)
  ok(revDuringFail === revBeforeFail, 'rev does NOT advance while saving fails (no false success)')
  const hasUnsaved = await page.evaluate(() => window.__roomioUnsaved?.() ?? null)
  ok(hasUnsaved === true, 'edit kept in memory while failing (not dropped)')
  await page.screenshot({ path: `${OUT}c2-2-retry.png` })
  // recover
  await page.evaluate(() => window.__roomioFail?.(false))
  ok(await waitForPhase(page, 'saved', 8000), 'turning storage back on → kept edit saves (recovers)')
  const revAfterRecover = await page.evaluate(() => window.__roomioRev?.() ?? null)
  ok(revAfterRecover > revBeforeFail, `rev advances after recovery ${revBeforeFail} -> ${revAfterRecover}`)

  // 4c) VERSION HISTORY — manual checkpoint creates a restore point; restore works.
  await clickByText(page, 'History')
  await clickByText(page, 'Save') // manual checkpoint
  await waitForPhase(page, 'saved', 6000)
  const restorePoints = await page.evaluate(
    () => [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Restore').length,
  )
  ok(restorePoints >= 1, 'manual checkpoint appears as a restore point in History')
  const revBeforeRestore = await page.evaluate(() => window.__roomioRev?.() ?? null)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Restore')
    btn?.click()
  })
  ok(await waitForPhase(page, 'saved', 6000), 'restoring a version saves cleanly')
  const revAfterRestore = await page.evaluate(() => window.__roomioRev?.() ?? null)
  ok(revAfterRestore > revBeforeRestore, 'restore is recorded as a new revision (history not destroyed)')

  // 5) Reload → design persists in My Designs WITH a thumbnail.
  await page.evaluate(() => history.pushState(null, '', '/')) // no-op; ensure same origin
  await page.reload({ waitUntil: 'networkidle0' })
  // back on the library (no design open after reload)
  const cards = await page.$$('button img')
  ok(cards.length >= 1, 'design appears as a card in My Designs after reload')
  const thumbSrc = cards.length ? await page.evaluate((img) => img.getAttribute('src') || '', cards[0]) : ''
  ok(thumbSrc.startsWith('data:image/'), 'card shows an auto-generated thumbnail (data URL)')
  await page.screenshot({ path: `${OUT}c2-1-library.png` })

  // 6) Reopen → the edited design loads back (round-trip through storage).
  await page.evaluate(() => {
    const card = document.querySelector('button img')?.closest('button')
    card?.click()
  })
  ok(await waitForPhase(page, 'saved', 4000), 'reopening a saved design loads it (status Saved)')

  // 7) C2-3 LIBRARY ACTIONS — duplicate, inline rename, delete + undo.
  await clickByText(page, '‹ My Designs')
  await sleep(300)
  const countCards = () => page.$$eval('img', (imgs) => imgs.filter((i) => (i.getAttribute('src') || '').startsWith('data:')).length)
  const before = await countCards()
  ok(before >= 1, `library shows ${before} card(s)`)

  // duplicate
  await clickByText(page, 'Duplicate')
  await sleep(500)
  const afterDup = await countCards()
  ok(afterDup === before + 1, `duplicate adds a card (${before} -> ${afterDup})`)
  const hasCopy = await page.evaluate(() => document.body.innerText.includes('(copy)'))
  ok(hasCopy, 'duplicated design is named "… (copy)"')

  // inline rename (rename the first card)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Rename')
    btn?.click()
  })
  await sleep(150)
  await page.evaluate(() => {
    const inp = document.querySelector('input[aria-label="Rename design"]')
    if (inp) {
      inp.value = ''
      inp.focus()
    }
  })
  await page.keyboard.type('Renamed Design')
  await page.keyboard.press('Enter')
  await sleep(500)
  const hasRenamed = await page.evaluate(() => document.body.innerText.includes('Renamed Design'))
  ok(hasRenamed, 'inline rename updates the card name')
  await page.screenshot({ path: `${OUT}c2-3-library.png` })

  // delete + undo
  const beforeDel = await countCards()
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Delete')
    btn?.click()
  })
  await sleep(400)
  const afterDel = await countCards()
  ok(afterDel === beforeDel - 1, `delete removes a card (${beforeDel} -> ${afterDel})`)
  const undoVisible = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Undo'))
  ok(undoVisible, 'delete shows an Undo affordance (not a trap)')
  await clickByText(page, 'Undo')
  await sleep(400)
  const afterUndo = await countCards()
  ok(afterUndo === beforeDel, `undo restores the deleted design (${afterDel} -> ${afterUndo})`)

  // 8) C2-4 SHARE + VIEW-ONLY SHOWCASE.
  // open a design, then the Share panel
  await page.evaluate(() => {
    const card = document.querySelector('button img')?.closest('button')
    card?.click()
  })
  await waitForPhase(page, 'saved', 4000)
  await clickByText(page, 'Share')
  await page.waitForSelector('[data-testid="share-panel"]', { timeout: 4000 })
  // defaults to "view"
  const accessSentence = await page.$eval('[data-testid="access-sentence"]', (el) => el.textContent || '')
  ok(/view/i.test(accessSentence), `share defaults to view: "${accessSentence.trim()}"`)
  const showcaseUrl = await page.$eval('[data-testid="showcase-url"]', (el) => el.value)
  ok(showcaseUrl.includes('showcase.html#s='), 'showcase link points at the isolated showcase entry')
  await page.screenshot({ path: `${OUT}c2-4-share.png` })

  // CRITICAL: open the showcase link in a FRESH incognito context (no localStorage,
  // like another device) and prove it is a read-only walkthrough of JUST this room,
  // with NO editor / library / other designs reachable.
  const ctx = await browser.createBrowserContext()
  const viewer = await ctx.newPage()
  await viewer.setViewport({ width: 1100, height: 760 })
  await viewer.goto(showcaseUrl, { waitUntil: 'networkidle0' })
  await sleep(800)
  const hasViewBadge = await viewer.$('[data-testid="view-only-badge"]')
  ok(!!hasViewBadge, 'showcase opens incognito (data came from the URL, not storage) with a View-only badge')
  const hasPlay = await viewer.$('[data-testid="play-walkthrough"]')
  ok(!!hasPlay, 'showcase offers a read-only walkthrough')
  const canvasOk = await viewer.$eval('canvas', (c) => c.width > 100 && c.height > 100).catch(() => false)
  ok(canvasOk, 'showcase renders a 3D canvas of the room')
  // ISOLATION: the showcase must NOT expose the editor / library / other designs.
  const leak = await viewer.evaluate(() => {
    const txt = document.body.innerText
    const hasEditorChrome =
      /My Designs/i.test(txt) || /New room/i.test(txt) || /New apartment/i.test(txt) || /Saving|Saved/i.test(txt)
    const hasShareBtn = [...document.querySelectorAll('button')].some((b) => /share/i.test(b.textContent || ''))
    const hasEditControls = [...document.querySelectorAll('button')].some((b) =>
      /Move item|Rotate item|Rename|Duplicate|Delete/i.test(b.textContent || ''),
    )
    const linksToEditor = [...document.querySelectorAll('a')].some((a) => /index\.html/i.test(a.getAttribute('href') || ''))
    return { hasEditorChrome, hasShareBtn, hasEditControls, linksToEditor }
  })
  ok(!leak.hasEditorChrome, 'showcase shows NO editor/library chrome (no My Designs / New / save status)')
  ok(!leak.hasEditControls, 'showcase shows NO edit controls')
  ok(!leak.hasShareBtn, 'showcase shows NO share/editor buttons')
  ok(!leak.linksToEditor, 'showcase has NO link back into the editor (index.html)')
  await viewer.screenshot({ path: `${OUT}c2-4-showcase.png` })
  await ctx.close()

  // 9) C2-5 EXPORTS — each button produces a real downloaded file.
  // (the Share panel is still open on the main page)
  const clickTestId = (id) =>
    page.evaluate((sel) => document.querySelector(`[data-testid="${sel}"]`)?.click(), id)
  const waitForFile = async (re, timeoutMs = 6000) => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const f = readdirSync(DL).filter((n) => re.test(n) && !n.endsWith('.crdownload'))
      if (f.length) return f[0]
      await sleep(150)
    }
    return null
  }
  await clickTestId('export-image')
  ok(!!(await waitForFile(/\.png$/)), 'export image → a .png file downloads')
  await clickTestId('export-shopping')
  ok(!!(await waitForFile(/\.csv$/)), 'export shopping list → a .csv file downloads')
  await clickTestId('export-pdf')
  const pdfName = await waitForFile(/\.pdf$/)
  ok(!!pdfName, 'export floor-plan → a .pdf file downloads')

  // 10) C2-6 BACKWARD COMPAT — an old single-room save (Agent A's pre-persistence
  // localStorage map) loads into My Designs via the one-time legacy import.
  const legacyCtx = await browser.createBrowserContext()
  const lp = await legacyCtx.newPage()
  await lp.goto(APP_URL, { waitUntil: 'networkidle0' })
  await lp.evaluate(() => {
    localStorage.clear()
    const room = {
      id: 'room-legacy', name: 'My Old Room', unit: 'ft', shape: 'rect',
      corners: [{ x: 0, z: 0 }, { x: 400, z: 0 }, { x: 400, z: 360 }, { x: 0, z: 360 }],
      wallHeight: 270, wallThickness: 12, openings: [],
      materials: { wallColor: '#e9e6df', floorTexture: 'oak' },
      furniture: [{ id: 'f1', archetype: 'bed-queen', category: 'bed', name: 'Queen Bed', x: 200, z: 200, rotation: 0, w: 165, d: 212, h: 50, color: '#8a9bb0' }],
      createdAt: 1, updatedAt: 2,
    }
    localStorage.setItem('roomio.designs.v1', JSON.stringify({ 'room-legacy': room }))
  })
  await lp.reload({ waitUntil: 'networkidle0' })
  await sleep(500)
  const legacyLoaded = await lp.evaluate(() => document.body.innerText.includes('My Old Room'))
  ok(legacyLoaded, 'an old single-room save (roomio.designs.v1) loads into My Designs')
  // and the original legacy key is left intact (non-destructive)
  const legacyIntact = await lp.evaluate(() => !!localStorage.getItem('roomio.designs.v1'))
  ok(legacyIntact, 'legacy data is preserved (non-destructive migration)')
  await legacyCtx.close()
} catch (err) {
  console.error(err)
  failures++
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll persistence checks passed')
process.exit(failures ? 1 : 0)
