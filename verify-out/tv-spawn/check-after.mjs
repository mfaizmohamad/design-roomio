// AFTER-fix verification for WIZ-06.
// Scenario A: blank room + catalog TV → must spawn flush on a wall at TV
//             height, with NO placement warning.
// Scenario B: room whose walls are fully glazed (windows stretched to max on
//             all four walls) → fallback: TV floor-stands near a wall and the
//             placement warning (one-tap "Move to wall") appears.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE || 'http://localhost:5313'
const OUT = process.env.OUT || '.'
fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--window-size=1680,1000',
  ],
})

async function newFurnishPage() {
  const page = await browser.newPage()
  await page.setViewport({ width: 1680, height: 1000 })
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto(`${BASE}/?stage=furnish`, { waitUntil: 'networkidle0', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 2500))
  return page
}

const distSnippet = `
  const distToNearestWall = (x, z, corners) => {
    const seg = (px, pz, a, b) => {
      const abx = b.x - a.x, abz = b.z - a.z
      const len2 = abx * abx + abz * abz || 1
      let t = ((px - a.x) * abx + (pz - a.z) * abz) / len2
      t = Math.max(0, Math.min(1, t))
      return Math.hypot(px - (a.x + t * abx), pz - (a.z + t * abz))
    }
    let d = Infinity
    for (let i = 0; i < corners.length; i++) d = Math.min(d, seg(x, z, corners[i], corners[(i + 1) % corners.length]))
    return d
  }
`

// ── Scenario A ──────────────────────────────────────────────────────────────
{
  const page = await newFurnishPage()
  const a = await page.evaluate(`(() => {
    ${distSnippet}
    const store = window.__roomio
    const id = store.getState().addFurnitureCentered('decor-tv')
    const st = store.getState()
    const tv = st.design.furniture.find((f) => f.id === id)
    st.selectFurniture(null)
    return {
      tv: { x: tv.x, z: tv.z, rotation: tv.rotation },
      distToNearestWall: distToNearestWall(tv.x, tv.z, st.design.corners),
    }
  })()`)
  console.log('[A] TV spawn:', JSON.stringify(a))
  await new Promise((r) => setTimeout(r, 1800))
  const warnA = await page.evaluate(() => document.body.innerText.includes('Placement warnings'))
  console.log('[A] placement warning visible:', warnA, '(expected false)')
  await page.screenshot({ path: `${OUT}/after-tv-wall-mounted.png` })
  console.log('[A] saved', `${OUT}/after-tv-wall-mounted.png`)
  if (a.distToNearestWall > 12 || warnA) {
    console.log('[A] ❌ FAIL')
    process.exitCode = 1
  } else console.log('[A] ✓ TV mounted flush on a wall, no warning')
  await page.close()
}

// ── Scenario B ──────────────────────────────────────────────────────────────
{
  const page = await newFurnishPage()
  const b = await page.evaluate(`(() => {
    ${distSnippet}
    const store = window.__roomio
    let st = store.getState()
    // glaze every wall edge-to-edge
    for (const w of st.walls) store.getState().addOpening('windowDouble', w.id, 0.5)
    for (const o of store.getState().design.openings) store.getState().updateOpening(o.id, { width: 10000 })
    const id = store.getState().addFurnitureCentered('decor-tv')
    st = store.getState()
    const tv = st.design.furniture.find((f) => f.id === id)
    st.selectFurniture(null)
    return {
      tv: { x: tv.x, z: tv.z, rotation: tv.rotation },
      distToNearestWall: distToNearestWall(tv.x, tv.z, st.design.corners),
      openings: st.design.openings.map((o) => ({ wallId: o.wallId, width: o.width })),
    }
  })()`)
  console.log('[B] fallback spawn:', JSON.stringify(b))
  await new Promise((r) => setTimeout(r, 1800))
  const warnB = await page.evaluate(() => ({
    warning: document.body.innerText.includes('Placement warnings'),
    moveToWall: document.body.innerText.includes('Move to wall'),
  }))
  console.log('[B] warning visible:', JSON.stringify(warnB), '(expected both true)')
  await page.screenshot({ path: `${OUT}/after-glazed-fallback.png` })
  console.log('[B] saved', `${OUT}/after-glazed-fallback.png`)
  const nearWall = b.distToNearestWall > 70 && b.distToNearestWall < 130
  if (!nearWall || !warnB.warning || !warnB.moveToWall) {
    console.log('[B] ❌ FAIL')
    process.exitCode = 1
  } else console.log('[B] ✓ floor-standing near a wall, warning + Move to wall shown')
  await page.close()
}

await browser.close()
