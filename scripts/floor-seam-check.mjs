// Raster regression for the Embercrest upper-floor seam. Compare the old
// coplanar draw against the production material at the SAME camera position;
// restoring an unfixed material must fail because the white caps remain visible.
import assert from 'node:assert/strict'
import { withDevServer, withBrowser, openPage, shoot, assertRenderQuality } from './lib/harness.mjs'
import { decodePng } from './lib/png.mjs'
await withDevServer(async ({ url }) =>
  withBrowser(async (browser) => {
    const { page, critical } = await openPage(browser, `${url}/`, {
      viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
      waitUntil: 'domcontentloaded',
      settleMs: 500,
    })
    await page.evaluate(async () => {
      const { useRender } = await import('/rendering/src/store.ts')
      useRender.getState().setQuality('low')
      const { openHome } = await import('/src/homeLauncher.ts')
      openHome('embercrest')
      window.__roomio.getState().setStage('furnish')
    })
    await page.waitForSelector('canvas', { timeout: 120000 })
    await page.waitForSelector('.sidebar-toggle')
    await page.click('.sidebar-toggle')
    await page.evaluate(async () => {
      const { applyView } = await import('/src/three/cameraBus.ts')
      applyView({ cam: [5.5, 11, 13], target: [-1, 3, 1] })
    })
    await new Promise((resolve) => setTimeout(resolve, 2000))
    await page.evaluate(async () => {
      const { getSceneHandle } = await import('/src/three/sceneBus.ts')
      const handle = getSceneHandle()
      window.seamMaterials = []
      handle.scene.traverse((node) => {
        if (node.material?.name === 'roomio-floor' && !window.seamMaterials.includes(node.material))
          window.seamMaterials.push(node.material)
      })
      window.seamMaterials.forEach((material) => {
        material.userData.savedFloorOffset = material.polygonOffset
        material.polygonOffset = false
      })
      // Reapply after the sidebar resize and scene effects have settled, so the
      // automatic fit cannot replace the close inspection angle.
      const { applyView } = await import('/src/three/cameraBus.ts')
      applyView({ cam: [5.5, 11, 13], target: [-1, 3, 1] })
    })
    const before = await shoot(page, 'verify-out/floor-seam-before.png')
    await page.evaluate(() =>
      window.seamMaterials.forEach((material) => {
        material.polygonOffset = material.userData.savedFloorOffset
      }),
    )
    const shot = await shoot(page, 'verify-out/floor-seam-after.png')
    assert.equal(assertRenderQuality(shot, { notBlank: true, notBlack: true }).ok, true)
    const a = decodePng(before)
    const b = decodePng(shot)
    let removedWhite = 0
    for (let i = 0; i < a.width * a.height; i++) {
      const j = i * a.channels
      const k = i * b.channels
      const neutral = a.data[j] > 120 && a.data[j] - a.data[j + 2] < 60
      const darker = b.data[k] < a.data[j] - 40 && b.data[k + 2] < a.data[j + 2] - 40
      if (neutral && darker) removedWhite++
    }
    assert.ok(
      removedWhite > 20,
      `White wall caps still show through the floor (${removedWhite} pixels covered)`,
    )
    // A slope-dependent depth bias can also swallow entire raised rugs. The
    // correction should cover narrow caps, not thousands of pixels of furniture.
    assert.ok(
      removedWhite < a.width * a.height * 0.001,
      `Floor bias obscured raised rugs (${removedWhite} pixels covered)`,
    )
    const floors = await page.evaluate(() => window.seamMaterials.length)
    assert.equal(floors, 20)
    // Guest rendering works with the optional backend offline; report its
    // health failures separately, while failing every unexpected request.
    const errors = critical()
    assert.deepEqual(errors.pageErrors, [])
    assert.deepEqual(errors.consoleErrors, [])
    assert.deepEqual(
      errors.failedRequests.filter((r) => !r.url.endsWith('/api/health')),
      [],
    )
    console.log(
      JSON.stringify({
        floors,
        removedWhite,
        render: 'passed',
        beforeAfter: 'captured',
        offlineBackendRequests: errors.failedRequests.filter((r) => r.url.endsWith('/api/health'))
          .length,
      }),
    )
  }),
)
