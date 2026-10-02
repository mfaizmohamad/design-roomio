// Console-error sweep across every wizard stage + interaction (click-select,
// collision-bounded drag) + undo/redo, driven through the app store.
//
// Uses the verification harness: Chrome resolved via CHROME/candidates (no
// hardcoded path — PIPE-3), ephemeral dev server on a free port (no hardcoded
// :5180 — PIPE-5). Set BASE=http://host:port to reuse a running dev server.
import { withBrowser, openPage } from './lib/browser.mjs'
import { withDevServer } from './lib/dev-server.mjs'

const run = (BASE) =>
  withBrowser(async (browser) => {
    let totalErrors = 0
    const log = (...a) => console.log(...a)

    // 1) Console-error sweep across all stages. openPage collects console/page
    //    errors and critical() filters the favicon/401 noise for us.
    for (const [stage, label] of [
      ['', 'start'],
      ['?stage=step1', 'step1'],
      ['?stage=step2', 'step2'],
      ['?stage=step3&seed=1', 'step3'],
      ['?stage=step4&seed=1', 'step4'],
      ['?stage=furnish&seed=1', 'furnish'],
      ['?stage=step1&shape=u', 'u-shape'],
    ]) {
      const { page, critical } = await openPage(browser, `${BASE}/${stage}`, { settleMs: 2500 })
      const c = critical()
      const real = [...c.pageErrors.map((e) => 'PAGEERROR: ' + e), ...c.consoleErrors]
      log(`\n[${label}] ${real.length ? '❌ ' + real.length + ' error(s)' : '✓ no console errors'}`)
      real.forEach((e) => log('   ', e.slice(0, 200)))
      totalErrors += real.length
      await page.close()
    }

    // 2) Interaction test: click + drag a furniture item, verify select + collision-bounded move
    log('\n--- interaction: click-select + drag furniture (furnish) ---')
    {
      const { page } = await openPage(browser, `${BASE}/?stage=furnish&seed=1`, { waitForCanvas: true, settleMs: 2500 })

      const rect = await page.evaluate(() => {
        const c = document.querySelector('canvas')
        const r = c.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
      })

      // helper running in page: read store state
      const getState = () =>
        page.evaluate(() => {
          const st = window.__roomio.getState()
          return {
            sel: st.selectedFurnitureId,
            furniture: st.design.furniture.map((f) => ({ id: f.id, x: f.x, z: f.z, w: f.w, d: f.d, rot: f.rotation })),
            corners: st.design.corners,
          }
        })

      // try clicking several points to land on an item
      let selected = null
      const cx = rect.x + rect.w / 2
      const cy = rect.y + rect.h / 2
      for (const [dx, dy] of [[0, 60], [-120, 80], [120, 80], [0, 0], [-60, 120]]) {
        await page.mouse.move(cx + dx, cy + dy)
        await page.mouse.down()
        await page.mouse.up()
        const s = await getState()
        if (s.sel) {
          selected = s.sel
          break
        }
      }
      log(selected ? `  ✓ click selected an item (${selected})` : '  ❌ click did not select any item')
      if (!selected) totalErrors++

      if (selected) {
        const before = (await getState()).furniture.find((f) => f.id === selected)
        // grab the item (pointer down on it) then drag toward the upper-left wall
        await page.mouse.move(cx, cy + 60)
        await page.mouse.down()
        for (let i = 1; i <= 10; i++) {
          await page.mouse.move(cx - 30 * i, cy + 60 - 22 * i)
          await new Promise((r) => setTimeout(r, 16))
        }
        await page.mouse.up()
        const st = await getState()
        const after = st.furniture.find((f) => f.id === selected)
        const moved = Math.hypot(after.x - before.x, after.z - before.z)

        // inside-polygon check for all 4 footprint corners
        const inside = await page.evaluate(
          (item, corners) => {
            const cosA = Math.cos(item.rot), sinA = Math.sin(item.rot)
            const hw = item.w / 2, hd = item.d / 2
            const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => ({
              x: item.x + lx * cosA + lz * sinA,
              z: item.z - lx * sinA + lz * cosA,
            }))
            const pip = (pt) => {
              let inside = false
              for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
                const ci = corners[i], cj = corners[j]
                if (ci.z > pt.z !== cj.z > pt.z && pt.x < ((cj.x - ci.x) * (pt.z - ci.z)) / (cj.z - ci.z) + ci.x)
                  inside = !inside
              }
              return inside
            }
            // allow a small tolerance (wall thickness) by shrinking corners test: just require pip
            return pts.every(pip)
          },
          after,
          st.corners,
        )

        log(`  ${moved > 5 ? '✓' : '❌'} drag moved the item (${moved.toFixed(0)} cm)`)
        log(`  ${inside ? '✓' : '❌'} item stays inside the room polygon after drag (no wall clipping)`)
        if (moved <= 5) totalErrors++
        if (!inside) totalErrors++
      }
      await page.close()
    }

    // 3) Undo/redo logic (driven via the store)
    log('\n--- undo / redo ---')
    {
      const { page } = await openPage(browser, `${BASE}/?stage=furnish&seed=1`, { waitForCanvas: true, settleMs: 1500 })
      const r = await page.evaluate(() => {
        const S = () => window.__roomio.getState()
        const n0 = S().design.furniture.length
        S().addFurnitureCentered('table-dining')
        const n1 = S().design.furniture.length
        S().undo()
        const n2 = S().design.furniture.length
        S().redo()
        const n3 = S().design.furniture.length
        return { n0, n1, n2, n3 }
      })
      const ok = r.n1 === r.n0 + 1 && r.n2 === r.n0 && r.n3 === r.n0 + 1
      log(`  ${ok ? '✓' : '❌'} add→undo→redo restores count (${r.n0}→${r.n1}→${r.n2}→${r.n3})`)
      if (!ok) totalErrors++
      await page.close()
    }

    log(`\n==== ${totalErrors === 0 ? 'ALL CHECKS PASSED ✓' : totalErrors + ' issue(s) ❌'} ====`)
    return totalErrors
  }, { windowSize: '1680,1000' })

const totalErrors = process.env.BASE ? await run(process.env.BASE) : await withDevServer(({ url }) => run(url))
process.exit(totalErrors ? 1 : 0)
