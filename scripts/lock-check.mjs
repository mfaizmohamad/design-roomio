// Lock regression: a locked item must NOT move on drag and must NOT rotate;
// unlocking restores movement. Both lock buttons (panel + 3D toolbar) must toggle.
//
// Uses the verification harness: resolves Chrome via CHROME/candidates (no
// hardcoded path — PIPE-3) and drives an ephemeral dev server on a free port
// (no hardcoded :5180 — PIPE-5). Set BASE=http://host:port to reuse a server.
import { withBrowser, openPage } from './lib/browser.mjs'
import { withDevServer } from './lib/dev-server.mjs'

const run = (base) =>
  withBrowser(async (browser) => {
    const { page } = await openPage(browser, `${base}/?stage=furnish&seed=1`, { waitForCanvas: true, settleMs: 2800 })

    const rect = await page.evaluate(() => {
      const c = document.querySelector('canvas')
      const r = c.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    })
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2

    const setLocked = (id, v) => page.evaluate((id, v) => window.__roomio.getState().updateFurniture(id, { locked: v }), id, v)
    const lockedOf = (id) => page.evaluate((id) => !!window.__roomio.getState().design.furniture.find((f) => f.id === id)?.locked, id)
    const posOf = (id) => page.evaluate((id) => { const f = window.__roomio.getState().design.furniture.find((x) => x.id === id); return { x: f.x, z: f.z, rot: f.rotation } }, id)
    const selOf = () => page.evaluate(() => window.__roomio.getState().selectedFurnitureId)

    // Drag starting from the item's CURRENT on-screen position (robust to any prior
    // camera orbit). We grab the pointer on the item, then sweep toward the room centre.
    async function dragItem() {
      const start = await page.evaluate(() => {
        const c = document.querySelector('canvas')
        const r = c.getBoundingClientRect()
        return { rx: r.x, ry: r.y, rw: r.width, rh: r.height }
      })
      // press at the canvas centre-ish where the selected item sits in the seed layout
      const sx = start.rx + start.rw / 2
      const sy = start.ry + start.rh / 2 + 60
      await page.mouse.move(sx, sy)
      await page.mouse.down()
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(sx - 24 * i, sy - 16 * i)
        await new Promise((r) => setTimeout(r, 18))
      }
      await page.mouse.up()
      await new Promise((r) => setTimeout(r, 60))
    }
    // Reset the camera between drags so a prior (locked) drag's orbit can't shift
    // where the item appears on screen.
    const resetCam = () => page.evaluate(() => window.__roomio.getState().fitView())

    let fails = 0
    const chk = (n, ok, e = '') => (ok ? console.log('  ✓', n) : (fails++, console.log('  ✗', n, e)))

    // select the item under the cursor
    let sel = null
    for (const [dx, dy] of [[0, 60], [-120, 80], [120, 80], [0, 0]]) {
      await page.mouse.click(cx + dx, cy + dy)
      sel = await selOf()
      if (sel) break
    }
    chk('selected an item under cursor', !!sel, String(sel))

    // Panel + 3D toolbar lock buttons toggle state
    const b0 = await lockedOf(sel)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /^(🔓 Lock|🔒 Locked)$/.test((x.textContent || '').trim()))
      b?.click()
    })
    await new Promise((r) => setTimeout(r, 150))
    chk('panel lock button toggles', (await lockedOf(sel)) !== b0)
    const b1 = await lockedOf(sel)
    await page.evaluate(() => document.querySelector('.tool-btn:not(.danger)')?.click())
    await new Promise((r) => setTimeout(r, 150))
    chk('3D toolbar lock button toggles', (await lockedOf(sel)) !== b1)

    // UNLOCK first (fresh camera) and assert drag moves it — establishes the drag works.
    await setLocked(sel, false)
    await resetCam()
    await new Promise((r) => setTimeout(r, 150))
    const beforeU = await posOf(sel)
    await dragItem()
    const afterU = await posOf(sel)
    const movedU = Math.hypot(afterU.x - beforeU.x, afterU.z - beforeU.z)
    chk('unlocked item DOES move on drag', movedU > 5, `moved ${movedU.toFixed(1)}cm`)

    // Now LOCK and assert the same drag does nothing (camera reset so the item is
    // back under the press point).
    await setLocked(sel, true)
    await resetCam()
    await new Promise((r) => setTimeout(r, 150))
    const before = await posOf(sel)
    await dragItem()
    const afterLocked = await posOf(sel)
    const movedLocked = Math.hypot(afterLocked.x - before.x, afterLocked.z - before.z)
    chk('locked item does NOT move on drag', movedLocked < 1.5, `moved ${movedLocked.toFixed(1)}cm`)

    console.log(`\n==== lock: ${fails === 0 ? 'ALL PASSED ✓' : fails + ' FAILED ❌'} ====`)
    return fails
  })

const fails = process.env.BASE ? await run(process.env.BASE) : await withDevServer(({ url }) => run(url))
process.exit(fails ? 1 : 0)
