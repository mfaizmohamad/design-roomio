// Generic listing-replica shoot pipeline: renders every LISTING_FLATS replica
// (or one) from its own photo-matched `shots` (src/data/listingFlats.ts), plus
// the DEFAULT 1/2/3BHK template overviews used by listing cards without a
// replica.
//
//   node scripts/shoot-listing-replica.mjs            # all replicas + defaults
//   node scripts/shoot-listing-replica.mjs <id>       # one listing (replica OR dynamic)
//   node scripts/shoot-listing-replica.mjs defaults   # only the BHK templates
//
// A replica id (has hand-authored `shots` in LISTING_FLATS) renders from those
// exact photo-matched poses — replica-first, unchanged. ANY OTHER scraped id has
// no hand-authored shots, so it opens the generic metadata-built scene and the
// AUTO SHOT-PLANNER (src/three/shotPlanner.ts) composes professional per-room
// cameras for it (level → plumb verticals, ≤65° fov, two-point corner framing,
// ≥3 walls, never through a doorway), rendered LANDSCAPE 3:2.
//
// Output: <outRoot>/<listingId>/<shot.name>.jpg and <outRoot>/default/<BHK>.jpg
// (JPEG q85 — photographic content; PNG was 4-5x heavier for no visible gain).
// outRoot defaults to public/renders so the Listings page serves them directly
// (the cards' "3D view" tab — src/wizard/Listings.tsx builds the same paths).
//
// Every frame is VERIFIED before it is written, and a bad frame FAILS the shot
// instead of overwriting the committed asset:
//   1. hideChrome() runs per-shot (React remounts restore HUD nodes, so a
//      one-time sweep is not enough) — stylesheet for the known overlay classes
//      plus a computed-style sweep over every position:fixed element.
//   2. A DOM assert: no visible painted element may intersect the canvas clip.
//   3. Pixel stats on the captured frame: blank/black/white detection plus
//      HUD-zone checks (white pill corners, dark hint pill) as a backstop.
// Failed shots keep the previous image on disk, are retried a few times, then
// recorded; the run continues (per-listing AND per-shot isolation) and exits
// non-zero with a summary if anything failed.
//
// The script spawns its OWN dev server on a dedicated port. This is load-
// bearing, not convenience: a long-running dev server that has seen HMR edits
// serves the app graph with `?t=` cache-busting queries, so this script's
// plain-path `import('/src/...')` would load DUPLICATE module instances
// (separate zustand stores — the app ignores everything the script does).
// A fresh server has no HMR history, so both sides share one module graph.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 5191
const BASE = `http://localhost:${PORT}`
const VIEW_W = 1500 // browser viewport width (used to map fixed top-centre HUD into clip coords)
const JPEG_QUALITY = 85
const arg = process.argv[2] || null
const defaultsOnly = arg === 'defaults'
const onlyId = defaultsOnly ? null : arg
const OUT_ROOT = process.argv[3] ?? 'public/renders'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ────────────────────────────── chrome hiding ────────────────────────────────

// Known overlay classes/ids that float over the viewport. The stylesheet
// survives React remounts; the fixed-element sweep does not — hence per-shot.
const CHROME_CSS =
  '.vp-hint,.name-badge,.vp-tools,.lock-badge,.item-toolbar,#fly-launch,#fly-root{visibility:hidden!important}'

/** Hide app chrome overlaying the canvas. MUST run before every capture —
 *  React remounts (room switches, mode toggles) recreate HUD nodes. */
async function hideChrome(page) {
  await page.evaluate((css) => {
    let tag = document.getElementById('__shoot-hide')
    if (!tag) {
      tag = document.createElement('style')
      tag.id = '__shoot-hide'
      document.head.appendChild(tag)
    }
    tag.textContent = css
    // Sweep every fixed-position element (toolbars, launchers, panels, pills —
    // LightingControls, RenderControls, PlanArranger, the viewport toolbar and
    // the Sun-Mode notice all use inline `position: fixed`). Never touch the
    // canvas or anything containing it.
    const canvas = document.querySelector('.stage canvas') || document.querySelector('canvas')
    for (const el of document.body.querySelectorAll('*')) {
      if (!canvas || el === canvas || el.contains(canvas)) continue
      if (getComputedStyle(el).position === 'fixed') el.style.visibility = 'hidden'
    }
  }, CHROME_CSS)
}

/** DOM assert: list visible painted elements intersecting the canvas rect.
 *  Anything returned here would be baked into the screenshot. */
async function findVisibleChrome(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.stage canvas') || document.querySelector('canvas')
    if (!canvas) return ['<no canvas>']
    const cr = canvas.getBoundingClientRect()
    const offenders = []
    for (const el of document.body.querySelectorAll('*')) {
      if (el === canvas || el.contains(canvas)) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue
      const r = el.getBoundingClientRect()
      const ix = Math.min(r.right, cr.right) - Math.max(r.left, cr.left)
      const iy = Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top)
      if (ix < 4 || iy < 4) continue
      const paints =
        ['BUTTON', 'INPUT', 'IMG', 'SELECT', 'TEXTAREA', 'VIDEO', 'CANVAS', 'SVG'].includes(el.tagName.toUpperCase()) ||
        (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') ||
        cs.backgroundImage !== 'none' ||
        (cs.borderStyle !== 'none' && parseFloat(cs.borderWidth) > 0) ||
        cs.boxShadow !== 'none' ||
        Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())
      if (!paints) continue
      const cls = typeof el.className === 'string' ? el.className : ''
      offenders.push(`<${el.tagName.toLowerCase()}${cls ? ` .${cls.split(/\s+/)[0]}` : ''}> "${(el.textContent || '').trim().slice(0, 36)}"`)
      if (offenders.length >= 6) break
    }
    return offenders
  })
}

// ───────────────────────────── frame verification ────────────────────────────

/** Decode a captured frame in-page (no native deps) and return pixel stats:
 *  global mean/std luminance + per-HUD-zone white-pill / dark-pill fractions. */
async function analyzeFrame(page, buf, clip) {
  const zones = hudZones(clip)
  return page.evaluate(
    async (b64, zones) => {
      const img = new Image()
      img.src = 'data:image/jpeg;base64,' + b64
      await img.decode()
      const w = img.naturalWidth, h = img.naturalHeight
      const cv = document.createElement('canvas')
      cv.width = w
      cv.height = h
      const ctx = cv.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      const px = ctx.getImageData(0, 0, w, h).data
      let sum = 0, sum2 = 0
      const n = w * h
      for (let i = 0; i < px.length; i += 4) {
        const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
        sum += l
        sum2 += l * l
      }
      const mean = sum / n
      const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean))
      const zoneStats = {}
      for (const [name, [zx, zy, zw, zh]] of Object.entries(zones)) {
        const x0 = Math.max(0, Math.round(zx)), y0 = Math.max(0, Math.round(zy))
        const x1 = Math.min(w, Math.round(zx + zw)), y1 = Math.min(h, Math.round(zy + zh))
        let cnt = 0, white = 0, dark = 0
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * w + x) * 4
            const r = px[i], g = px[i + 1], b = px[i + 2]
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
            const l = 0.299 * r + 0.587 * g + 0.114 * b
            // white pill: near-pure neutral white (rgba(255,255,255,.86) composited)
            if (mn >= 243 && mx - mn <= 12) white++
            // dark hint pill: rgba(20,20,20,.78) composited → very dark neutral
            if (l <= 50 && mx - mn <= 16) dark++
            cnt++
          }
        }
        zoneStats[name] = cnt ? { whiteFrac: white / cnt, darkFrac: dark / cnt } : { whiteFrac: 0, darkFrac: 0 }
      }
      return { w, h, mean, std, zones: zoneStats }
    },
    Buffer.from(buf).toString('base64'), // puppeteer 22+ returns Uint8Array, not Buffer
    zones,
  )
}

/** HUD danger zones in CLIP coordinates. name-badge / vp-tools / vp-hint are
 *  absolute inside .stage (== clip origin); the viewport toolbar + Sun pill are
 *  fixed to the BROWSER-viewport centre, which sits left of the clip centre. */
function hudZones(clip) {
  const cx = VIEW_W / 2 - clip.x // viewport centre in clip coords
  return {
    topLeft: [8, 8, 330, 58], //         .name-badge pill
    topRight: [clip.width - 72, 8, 64, 210], // .vp-tools button stack
    topCenter: [cx - 270, 2, 540, 96], // fixed toolbar chips + Sun-Mode pill
    bottomCenter: [clip.width / 2 - 340, clip.height - 68, 680, 60], // .vp-hint
  }
}

/** Verdict on a captured frame. Empty array = shippable. `bytes` is the encoded
 *  JPEG size — a real furnished interior at q85 is 45-95KB; a near-uniform
 *  wall/ceiling close-up (camera stuck against a surface) compresses to 2-6KB,
 *  which luma-std alone can miss (a bright wall still has std ~11-29), so a byte
 *  floor is the decisive blank/degenerate guard. */
function frameProblems(a, bytes) {
  const p = []
  if (bytes < 16000) p.push(`degenerate frame (${(bytes / 1024).toFixed(1)}KB — real interiors are 45KB+)`)
  if (a.std < 16) p.push(`flat/near-uniform frame (luma std ${a.std.toFixed(1)})`)
  if (a.mean < 12) p.push(`black frame (mean luma ${a.mean.toFixed(1)})`)
  if (a.mean > 246) p.push(`white/washed frame (mean luma ${a.mean.toFixed(1)})`)
  const z = a.zones
  if (z.topLeft.whiteFrac > 0.25) p.push(`white pill in top-left (${(z.topLeft.whiteFrac * 100).toFixed(0)}%)`)
  if (z.topRight.whiteFrac > 0.3) p.push(`white buttons in top-right (${(z.topRight.whiteFrac * 100).toFixed(0)}%)`)
  if (z.topCenter.whiteFrac > 0.3) p.push(`white chips top-centre (${(z.topCenter.whiteFrac * 100).toFixed(0)}%)`)
  if (z.bottomCenter.darkFrac > 0.35) p.push(`dark hint pill bottom-centre (${(z.bottomCenter.darkFrac * 100).toFixed(0)}%)`)
  return p
}

// ───────────────────────────── condition waits ───────────────────────────────

/** Poll an in-page predicate instead of sleeping a fixed time. */
async function waitFor(page, fn, arg, { timeout = 15000, interval = 350, label = 'condition' } = {}) {
  const t0 = Date.now()
  for (;;) {
    let ok = false
    try {
      ok = await page.evaluate(fn, arg)
    } catch {
      // Poll loop: an evaluate that throws mid-navigation (context destroyed,
      // app not mounted yet) is an expected "not ready", not a failure. The
      // timeout below is the real failure path.
    }
    if (ok) return
    if (Date.now() - t0 > timeout) throw new Error(`timed out (${timeout}ms) waiting for ${label}`)
    await sleep(interval)
  }
}

/** The R3F <canvas> mounts at its intrinsic 300×150 and is only laid out to fill
 *  the stage a few frames later. Reading getBoundingClientRect before that yields
 *  the stale 300×150 box, so the screenshot clip is a tiny top-left patch and
 *  EVERY frame reads "blank/degenerate" — the shot fails verification forever
 *  even though the scene renders fine. (A fast-loading flat like the 5-room Malad
 *  1BHK loses this race; a slower one happens to win it — hence the intermittent
 *  blank frames.) Wait for the canvas to reach a real, laid-out size, THEN read
 *  its rect. On timeout, fall back to the current rect so a genuinely broken
 *  layout fails a shot's pixel verifier instead of crashing the whole listing. */
async function readClip(page, { timeout = 20000 } = {}) {
  try {
    await waitFor(
      page,
      () => {
        const c = document.querySelector('.stage canvas') || document.querySelector('canvas')
        const r = c && c.getBoundingClientRect()
        return !!r && r.width >= 400 && r.height >= 400
      },
      null,
      { label: 'canvas laid out to full size', timeout },
    )
  } catch (e) {
    console.log('  (readClip fallback: ' + String(e).slice(0, 90) + ')')
  }
  return page.evaluate(() => {
    const c = document.querySelector('.stage canvas') || document.querySelector('canvas')
    const r = c.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })
}

// Render settle: SwiftShader renders on the CPU, seconds per frame (see
// shared/LEARNINGS.md). An UNINTERRUPTED wait is essential — polling the frame
// by repeatedly screenshotting (readback + JPEG encode) competes with the CPU
// renderer and starves it, so a "wait until pixels stabilise" loop actually
// makes cold heavy scenes (e.g. a 5-room 1BHK in whole-house mode) paint SLOWER
// and time out blank. So we give the scene a generous quiet settle, then let the
// post-capture pixel verifier + retry-with-more-settle be the real quality gate.
const SETTLE = { house: 9000, room: 14000, initial: 7000 }

// ─────────────────────────────── capture core ────────────────────────────────

/** Settle (uninterrupted) → hide chrome → assert clean DOM → capture → verify
 *  pixels → write. A failing frame is NEVER written (the previous asset stays);
 *  each retry grants another full settle so an under-rendered cold frame gets
 *  more quiet render time rather than being re-grabbed immediately. */
async function captureVerified(page, clip, file, label, settleMs) {
  let last = []
  for (let attempt = 1; attempt <= 3; attempt++) {
    await sleep(settleMs) // quiet, uninterrupted SwiftShader render time
    await hideChrome(page) // per-shot: React remounts restore HUD nodes
    const offenders = await findVisibleChrome(page)
    if (offenders.length) {
      last = [`DOM chrome over canvas: ${offenders.join(' | ')}`]
      console.log(`  [${label}] attempt ${attempt}: ${last[0]}`)
      continue
    }
    const buf = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY, clip })
    const stats = await analyzeFrame(page, buf, clip)
    const problems = frameProblems(stats, buf.length)
    if (problems.length === 0) {
      writeFileSync(file, buf)
      console.log(`  shot -> ${file} (${(buf.length / 1024).toFixed(0)}KB · mean ${stats.mean.toFixed(0)} · std ${stats.std.toFixed(0)})`)
      return { ok: true, bytes: buf.length }
    }
    last = problems
    console.log(`  [${label}] attempt ${attempt} rejected: ${problems.join('; ')}`)
  }
  console.log(`  FAIL ${label}: ${last.join('; ')} (kept previous image)`)
  return { ok: false, problems: last }
}

/** Start (or retarget) an in-page per-frame pose hold. Room-mode CameraFit and
 *  house-mode HouseCameraFit both fire late on cold SwiftShader renders and
 *  would clobber a scripted pose — holding every frame makes the pose win for
 *  as long as the shot needs (cleared in clearPoseHold). */
async function holdPose(page, shot) {
  await page.evaluate((s) => {
    const w = window
    w.__HOLD = s
    if (!w.__HOLD_LOOP) {
      w.__HOLD_LOOP = true
      const tick = () => {
        const hs = w.__HOLD
        if (hs) {
          try {
            w.__CB.applyView({ cam: hs.cam, target: hs.target })
            const cam3 = w.__SB.getSceneHandle()?.camera
            if (cam3 && Math.abs(cam3.fov - hs.fov) > 0.01) {
              cam3.fov = hs.fov
              cam3.updateProjectionMatrix()
            }
          } catch {
            // Runs every frame: __CB/__SB come and go as the scene remounts, so
            // a throw here is a transient missing handle. Rethrowing would kill
            // the rAF loop permanently and freeze the pose for the whole shoot.
          }
        }
        requestAnimationFrame(tick)
      }
      tick()
    }
  }, shot)
}
const clearPoseHold = (page) => page.evaluate(() => { window.__HOLD = null }).catch(() => {})

// ─────────────────────────────────── main ────────────────────────────────────

const results = [] // { id, shot, ok, problems? }
const record = (id, shot, res) => results.push({ id, shot, ...res })

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
let browser
try {
  // wait for the dev server
  const t0 = Date.now()
  for (;;) {
    try { if ((await fetch(BASE)).ok) break } catch { /* server not listening yet — keep polling until the 30s timeout below */ }
    if (Date.now() - t0 > 30000) throw new Error('dev server did not start on ' + PORT)
    await sleep(300)
  }

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${VIEW_W},1500`],
  })

  // Which listings to shoot? Read the replica registry once via a throwaway page.
  const probe = await browser.newPage()
  await probe.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const replicaIds = await probe.evaluate(async () =>
    Object.keys((await import('/src/data/listingFlats.ts')).LISTING_FLATS),
  )
  await probe.close()
  // Every scraped listing (for validating a single DYNAMIC id).
  let listingIds = []
  try {
    listingIds = JSON.parse(readFileSync('public/listings.json', 'utf8')).listings.map((l) => l.id)
  } catch {
    // No scrape in the tree yet: the curated replicas below still shoot, and a
    // dynamic id simply will not resolve. Not a reason to abort the whole run.
  }
  const isReplicaId = (id) => replicaIds.includes(id)
  // Default run (no arg) still shoots only the curated replicas; a single arg may
  // be a replica OR any dynamic (planner-framed) scraped listing.
  const ids = defaultsOnly ? [] : onlyId ? [onlyId] : replicaIds
  if (onlyId && !isReplicaId(onlyId) && !listingIds.includes(onlyId))
    throw new Error(`unknown listing ${onlyId} (replicas: ${replicaIds.join(', ')})`)

  // ── Default template renders (normal listings' "3D view" tab) ──────────────
  if (defaultsOnly || !onlyId) {
    console.log('\n== default BHK templates ==')
    mkdirSync(`${OUT_ROOT}/default`, { recursive: true })
    for (const bhk of ['1BHK', '2BHK', '3BHK']) {
      let page
      try {
        page = await browser.newPage()
        await page.setViewport({ width: VIEW_W, height: 1000, deviceScaleFactor: 1 }) // landscape (16:10 cards)
        page.on('dialog', (d) => d.accept())
        await page.goto(`${BASE}/?stage=furnish`, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await page.waitForSelector('canvas', { timeout: 40000 })
        await page.evaluate(async (b) => {
          const h = (await import('/src/three/houseSession.ts')).useHouse.getState()
          ;({ '1BHK': h.loadFlat1BHK, '2BHK': h.loadFlat2BHK, '3BHK': h.loadFlat3BHK })[b]()
          ;(await import('/src/three/houseViewMode.ts')).useHouseView.getState().setMode('house')
        }, bhk)
        await waitFor(
          page,
          async () => {
            const h = (await import('/src/three/houseSession.ts')).useHouse.getState()
            const vm = (await import('/src/three/houseViewMode.ts')).useHouseView.getState()
            return h.rooms.length > 1 && vm.mode === 'house'
          },
          null,
          { label: `${bhk} loaded in house mode`, timeout: 20000 },
        )
        const clip = await readClip(page) // wait for real canvas size (not the 300×150 intrinsic)
        record('default', bhk, await captureVerified(page, clip, `${OUT_ROOT}/default/${bhk}.jpg`, `default/${bhk}`, SETTLE.house))
      } catch (e) {
        record('default', bhk, { ok: false, problems: [String(e).slice(0, 200)] })
        console.log(`  FAIL default/${bhk}: ${String(e).slice(0, 160)}`)
      } finally {
        if (page) await page.close().catch(() => {})
      }
    }
  }

  for (const id of ids) {
    const isReplica = isReplicaId(id)
    console.log(`\n== listing ${id} ${isReplica ? '(replica)' : '(dynamic · auto-planned)'} ==`)
    let page
    try {
      const OUT = `${OUT_ROOT}/${id}`
      mkdirSync(OUT, { recursive: true })

      page = await browser.newPage()
      // Replicas keep their tall viewport (hand-authored fovs framed for it).
      // Dynamic scenes render LANDSCAPE: a wider viewport so the stage canvas
      // (the wizard reserves a fixed side rail) still comes out landscape ~3:2.
      // The planner is then re-sized to the ACTUAL measured canvas aspect below.
      await page.setViewport(
        isReplica
          ? { width: VIEW_W, height: 1420, deviceScaleFactor: 1 }
          : { width: 2000, height: 1000, deviceScaleFactor: 1 },
      )
      page.on('dialog', (d) => d.accept())
      const errs = []
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
      page.on('pageerror', (e) => errs.push(String(e)))

      await page.goto(`${BASE}/?listing=${id}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForSelector('canvas', { timeout: 40000 })

      // Bridge the app's stores + buses (the ?listing= deep link loads the flat —
      // replica or generic metadata scene — itself; wait for it, don't sleep).
      await page.evaluate(async () => {
        const w = window
        w.__H = (await import('/src/three/houseSession.ts')).useHouse
        w.__VM = (await import('/src/three/houseViewMode.ts')).useHouseView
        w.__CB = await import('/src/three/cameraBus.ts')
        w.__SB = await import('/src/three/sceneBus.ts')
      })
      await waitFor(page, () => window.__H.getState().rooms.length > 0, null, {
        label: `flat ${id} loaded`,
        timeout: 30000,
      })

      const clip = await readClip(page) // wait for real canvas size (not the 300×150 intrinsic)
      // Real render aspect (canvas w/h) — the planner sizes fov/framing for it so
      // its ≥3-wall / composition guarantees match what actually gets rasterised.
      const renderAspect = clip.width / Math.max(1, clip.height)

      // Shots: replica → hand-authored poses (replica-first). Otherwise → the
      // auto shot-planner composes level, ≤65°, two-point-framed cameras from the
      // loaded rooms' bbox + doorways (layoutHouse) + furniture, sized for the
      // measured landscape aspect.
      const shots = await page.evaluate(async ({ lid, replica, aspect }) => {
        if (replica) return (await import('/src/data/listingFlats.ts')).LISTING_FLATS[lid].shots
        const H = window.__H.getState()
        const HL = await import('/src/three/houseLayout.ts')
        const SP = await import('/src/three/shotPlanner.ts')
        // layoutHouse cuts the inter-room doorways (not persisted on the design)
        // so the planner can avoid framing through them.
        const placed = HL.layoutHouse(H.rooms.map((e) => ({ design: e.design, pos: e.pos, type: e.type })))
        const extraById = new Map(placed.map((p) => [p.design.id, p.extraOpenings]))
        const rooms = H.rooms.map((e) => {
          const xs = e.design.corners.map((c) => c.x)
          const zs = e.design.corners.map((c) => c.z)
          const openings = [...e.design.openings, ...(extraById.get(e.design.id) || [])].map((o) => ({
            kind: o.kind, wallId: o.wallId, t: o.t, width: o.width, sill: o.sill,
          }))
          const furniture = e.design.furniture.map((f) => ({ x: f.x, z: f.z, w: f.w, d: f.d, rot: f.rotation }))
          return {
            name: e.design.name, type: e.type,
            w: Math.max(...xs) - Math.min(...xs), l: Math.max(...zs) - Math.min(...zs),
            x: e.pos.x, z: e.pos.z, openings, furniture,
          }
        })
        return SP.planFlatShots(rooms, { aspect })
      }, { lid: id, replica: isReplica, aspect: renderAspect })
      console.log(`  ${shots.length} shots (${isReplica ? 'hand-authored' : `auto-planned · aspect ${renderAspect.toFixed(2)}`})`)

      await sleep(SETTLE.initial) // first furnish + house render (quiet, uninterrupted)

      for (const shot of shots) {
        try {
          if (shot.mode === 'room') {
            await page.evaluate((name) => {
              const w = window
              w.__VM.getState().setMode('room')
              const H = w.__H.getState()
              const room = H.rooms.find((r) => r.design.name === name)
              if (!room) throw new Error('room not found: ' + name)
              if (H.activeId !== room.id) H.switchRoom(room.id)
            }, shot.room)
            // correctness gate: the ACTIVE room must be the one this file is named after
            await waitFor(
              page,
              (name) => {
                const H = window.__H.getState()
                const room = H.rooms.find((r) => r.design.name === name)
                return !!room && H.activeId === room.id
              },
              shot.room,
              { label: `active room = ${shot.room}`, timeout: 12000 },
            )
          } else {
            await page.evaluate(() => window.__VM.getState().setMode('house'))
          }

          // Hold the pose every frame while we settle + capture (room-mode
          // CameraFit / house-mode HouseCameraFit fire late on cold renders).
          await holdPose(page, shot)
          await waitFor(
            page,
            (s) => {
              const cam = window.__SB.getSceneHandle()?.camera
              if (!cam) return false
              const d = Math.hypot(cam.position.x - s.cam[0], cam.position.y - s.cam[1], cam.position.z - s.cam[2])
              return d < 0.1 && Math.abs(cam.fov - s.fov) < 0.6
            },
            shot,
            { label: `camera at ${shot.name} pose`, timeout: 25000 },
          )
          // settle inside captureVerified (room mode needs longer: room mount +
          // time-based ceiling fades + late CameraFit; house mode is quicker).
          const settleMs = shot.mode === 'room' ? SETTLE.room : SETTLE.house
          record(id, shot.name, await captureVerified(page, clip, `${OUT}/${shot.name}.jpg`, `${id}/${shot.name}`, settleMs))
        } catch (e) {
          record(id, shot.name, { ok: false, problems: [String(e).slice(0, 200)] })
          console.log(`  FAIL ${id}/${shot.name}: ${String(e).slice(0, 160)} (kept previous image)`)
        } finally {
          await clearPoseHold(page)
        }
      }

      const critical = errs.filter((e) => !/favicon|401|403|404|DevTools|Failed to load resource/i.test(e))
      if (critical.length) {
        console.log(`  ${critical.length} console errors:`)
        critical.slice(0, 6).forEach((e) => console.log('   err:', e.slice(0, 180)))
      } else {
        console.log('  no critical console errors')
      }

      // QA sheet: pair each render with the listing photo it recreates
      // (photo indexes come from the shot data; photo URLs from listings.json —
      // FB CDN links expire, so the sheet is for review right after a shoot).
      try {
        const doc = JSON.parse(readFileSync('public/listings.json', 'utf8'))
        const listing = doc.listings.find((l) => l.id === id)
        const rows = shots
          .map((s) => {
            const photo = listing?.images?.[s.photo]
            return `<div class="row"><h3>${s.name} · listing photo ${s.photo + 1}</h3>
            <div class="pair">${photo ? `<img src="${photo}">` : '<div class="miss">photo expired</div>'}<img src="./${s.name}.jpg"></div></div>`
          })
          .join('\n')
        writeFileSync(
          `${OUT}/compare.html`,
          `<!doctype html><meta charset="utf-8"><title>replica QA · ${id}</title>
<style>body{background:#111;color:#eee;font:14px system-ui;margin:20px}h3{margin:18px 0 6px;font-weight:600}
.pair{display:flex;gap:6px}.pair img{height:420px;border-radius:6px}.miss{width:315px;height:420px;display:flex;align-items:center;justify-content:center;background:#222;border-radius:6px;color:#777}</style>
<h1 style="font-size:18px">Photos vs renders — listing ${id}</h1>\n${rows}`,
        )
        console.log(`  QA sheet -> ${OUT}/compare.html`)
      } catch (e) {
        console.log('  (no QA sheet: ' + String(e).slice(0, 100) + ')')
      }
    } catch (e) {
      record(id, '(listing)', { ok: false, problems: [String(e).slice(0, 200)] })
      console.log(`  FAIL listing ${id}: ${String(e).slice(0, 160)} — continuing with next listing`)
    } finally {
      if (page) await page.close().catch(() => {})
    }
  }
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}

// ── summary + loud exit ───────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok)
console.log(`\n== shoot summary: ${results.length - failed.length}/${results.length} shots clean ==`)
for (const f of failed) console.log(`  FAILED ${f.id}/${f.shot}: ${(f.problems || []).join('; ')}`)
if (failed.length) {
  console.log('Failed shots kept their previous on-disk image; nothing bad was written.')
  process.exitCode = 1
}
