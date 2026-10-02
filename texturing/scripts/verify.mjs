// Headless verification of the Agent H photo-texture harness (port 5189).
// Boots Vite, drives window.__tex, and asserts via canvas pixels:
//   - applying a fabric photo CHANGES the sofa render + adds surface DETAIL (weave) + textures
//     the body/cushions (targeted > 0) — i.e. it wraps and responds to lighting, no flat decal
//   - reverting returns the render to (near) the default
//   - applying wood to the table changes that render too
// Screenshots saved to verify-out/.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 5189
const APP_URL = `http://localhost:${PORT}/`
const OUT = new URL('../verify-out/', import.meta.url).pathname

let failures = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok' : 'FAIL'} - ${msg}`)
  if (!cond) failures++
}

async function waitForServer(timeoutMs = 40000) {
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
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,800'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  const shaderErrors = []
  const isShaderErr = (t) => /shader|glsl|compile|program|webgl/i.test(t)
  page.on('pageerror', (e) => {
    console.log('  [pageerror]', e.message)
    if (isShaderErr(e.message)) shaderErrors.push(e.message)
  })
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' && isShaderErr(t)) shaderErrors.push(t)
  })
  await page.goto(APP_URL, { waitUntil: 'networkidle0' })
  await page.waitForFunction('document.querySelector("canvas") && window.__tex', { timeout: 30000 })
  await sleep(1800) // let the first frames render under swiftshader

  // metric helpers (run in-page; avoids PNG decode in node)
  await page.evaluate(() => {
    window.__lumaRegion = (x, y, w, h) => {
      const c = document.querySelector('canvas')
      const off = document.createElement('canvas')
      off.width = c.width
      off.height = c.height
      const ctx = off.getContext('2d')
      ctx.drawImage(c, 0, 0)
      const d = ctx.getImageData(x, y, w, h).data
      let sum = 0,
        detail = 0
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const p = (j * w + i) * 4
          const L = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]
          sum += L
          if (i > 0) {
            const q = p - 4
            const Lq = 0.2126 * d[q] + 0.7152 * d[q + 1] + 0.0722 * d[q + 2]
            detail += Math.abs(L - Lq)
          }
        }
      return { mean: sum / (w * h), detail: detail / (w * h) }
    }
    window.__frameSig = () => {
      const c = document.querySelector('canvas')
      const off = document.createElement('canvas')
      off.width = c.width
      off.height = c.height
      off.getContext('2d').drawImage(c, 0, 0)
      const d = off.getContext('2d').getImageData(0, 0, c.width, c.height).data
      let s = 0
      for (let p = 0; p < d.length; p += 64) s += d[p] + d[p + 1] + d[p + 2]
      return s
    }
  })

  // device-pixel scale (dpr up to 2): canvas is larger than CSS px
  const dpr = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    return c.width / c.clientWidth
  })
  const R = (x, y, w, h) => [Math.round(x * dpr), Math.round(y * dpr), Math.round(w * dpr), Math.round(h * dpr)]
  const SOFA = R(360, 360, 360, 220) // region over the sofa (left-center)
  const TABLE = R(820, 360, 280, 180) // region over the table (right)

  const sofaBefore = await page.evaluate((r) => window.__lumaRegion(...r), SOFA)
  const sigBefore = await page.evaluate(() => window.__frameSig())
  await page.screenshot({ path: OUT + '01-default.png' })

  // APPLY FABRIC to the sofa
  await page.evaluate(() => window.__tex.apply('fabric'))
  await sleep(700)
  const st1 = await page.evaluate(() => window.__tex.state())
  const sofaAfter = await page.evaluate((r) => window.__lumaRegion(...r), SOFA)
  const sigAfter = await page.evaluate(() => window.__frameSig())
  await page.screenshot({ path: OUT + '02-fabric-applied.png' })

  ok(st1.targeted >= 2, `fabric textured the body+cushions (targeted=${st1.targeted})`)
  ok(Math.abs(sigAfter - sigBefore) > 1, 'applying fabric changed the rendered frame')
  ok(
    sofaAfter.detail > sofaBefore.detail * 1.4,
    `sofa gained surface detail/weave (detail ${sofaBefore.detail.toFixed(2)} → ${sofaAfter.detail.toFixed(2)})`,
  )

  // ADJUST TILING density (denser) — the world-space repeat must increase + the frame re-render
  const repeatAt40 = st1.repeatX
  await page.evaluate(() => window.__tex.setRepeatCm(15))
  await sleep(600)
  const stDense = await page.evaluate(() => window.__tex.state())
  const sigDense = await page.evaluate(() => window.__frameSig())
  await page.screenshot({ path: OUT + '03-fabric-dense.png' })
  ok(
    stDense.repeatX > repeatAt40 * 1.5,
    `denser tiling raised texture.repeat (${repeatAt40.toFixed(2)} @40cm → ${stDense.repeatX.toFixed(2)} @15cm)`,
  )
  ok(Math.abs(sigDense - sigAfter) > 0, 'the tiling change re-rendered the frame')

  // REVERT — back to the archetype default
  await page.evaluate(() => window.__tex.revert())
  await sleep(600)
  const st2 = await page.evaluate(() => window.__tex.state())
  const sofaReverted = await page.evaluate((r) => window.__lumaRegion(...r), SOFA)
  await page.screenshot({ path: OUT + '04-reverted.png' })
  ok(st2.mode === 'default', 'revert returns the piece to default mode')
  ok(
    Math.abs(sofaReverted.detail - sofaBefore.detail) < sofaBefore.detail * 0.6 + 0.5,
    `revert restored the flat default (detail back to ${sofaReverted.detail.toFixed(2)} ≈ ${sofaBefore.detail.toFixed(2)})`,
  )

  // WOOD on the TABLE
  await page.evaluate(() => window.__tex.setTarget('table'))
  const tableBefore = await page.evaluate((r) => window.__lumaRegion(...r), TABLE)
  await page.evaluate(() => window.__tex.apply('wood'))
  await sleep(700)
  const st3 = await page.evaluate(() => window.__tex.state())
  const tableAfter = await page.evaluate((r) => window.__lumaRegion(...r), TABLE)
  await page.screenshot({ path: OUT + '05-wood-table.png' })
  ok(st3.targeted >= 1, `wood textured the table top (targeted=${st3.targeted})`)
  ok(tableAfter.detail > tableBefore.detail * 1.3, `table gained wood grain (detail ${tableBefore.detail.toFixed(2)} → ${tableAfter.detail.toFixed(2)})`)

  // TRIPLANAR FALLBACK on the anisotropic tub (H1 safety net) — must compile + texture, no stretch
  await page.evaluate(() => window.__tex.setTarget('tub'))
  const sigPreTub = await page.evaluate(() => window.__frameSig())
  await page.evaluate(() => window.__tex.apply('fabric'))
  await sleep(800)
  const st4 = await page.evaluate(() => window.__tex.state())
  const sigPostTub = await page.evaluate(() => window.__frameSig())
  await page.screenshot({ path: OUT + '06-tub-triplanar.png' })
  ok(st4.targeted >= 1, `tub body textured (targeted=${st4.targeted})`)
  ok(st4.triplanar >= 1, `tub used the TRIPLANAR fallback (triplanarCount=${st4.triplanar})`)
  ok(sigPostTub !== sigPreTub, 'triplanar texturing re-rendered the tub (shader compiled + drew)')
  ok(shaderErrors.length === 0, `no shader/WebGL compile errors (${shaderErrors.length})`)

  console.log(failures ? `\n${failures} FAIL` : '\nALL OK')
} catch (e) {
  console.error('verify error:', e)
  failures++
} finally {
  if (browser) await browser.close()
  vite.kill()
  process.exit(failures ? 1 : 0)
}
