// WI-6 responsive verification (RESP-01/02/04/05).
// Shoots every app screen at 4 breakpoints and asserts:
//   - no horizontal document overflow
//   - <700px: 3D design stages show the MobileGate (listings/start stay usable)
//   - >=700px: RenderControls panel fully inside the viewport (RESP-02)
//   - step2: every .dim-label inside the viewport (RESP-04)
//   - primary CTA (panel-foot .btn-primary) is not obscured by any overlay
//   - viewport meta has no user-scalable=no / maximum-scale (RESP-05)
// Usage: node verify-out/responsive/shoot-responsive.mjs  (dev server on :5306)

import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'http://localhost:5306'
const OUT = dirname(fileURLToPath(import.meta.url))
mkdirSync(OUT, { recursive: true })

const BREAKPOINTS = [
  { w: 390, h: 844, name: 'phone-390x844' },
  { w: 820, h: 1180, name: 'tablet-820x1180' },
  { w: 1280, h: 720, name: 'laptop-1280x720' },
  { w: 1440, h: 900, name: 'desktop-1440x900' },
]

const PAGES = [
  { q: '?stage=start', name: 'start', threeD: false },
  { q: '?stage=step1', name: 'step1', threeD: true },
  { q: '?stage=step2', name: 'step2', threeD: true },
  { q: '?stage=step3&seed=1', name: 'step3', threeD: true },
  { q: '?stage=step4&seed=1', name: 'step4', threeD: true },
  { q: '?stage=furnish&seed=1', name: 'furnish', threeD: true },
  { q: '?stage=listings', name: 'listings', threeD: false },
  { q: '?listing=4550925665232147', name: 'replica', threeD: true },
]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
})

let failures = 0
const fail = (msg) => {
  failures++
  console.log(`   ❌ ${msg}`)
}

for (const bp of BREAKPOINTS) {
  console.log(`\n=== ${bp.name} ===`)
  for (const pg of PAGES) {
    const page = await browser.newPage()
    await page.setViewport({ width: bp.w, height: bp.h })
    try {
      await page.goto(`${BASE}/${pg.q}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    } catch (e) {
      fail(`${pg.name}: navigation error ${e.message}`)
      await page.close()
      continue
    }
    await new Promise((r) => setTimeout(r, pg.threeD ? 3500 : 1500)) // let R3F / images settle

    const r = await page.evaluate(() => {
      const de = document.documentElement
      const vw = window.innerWidth
      const vh = window.innerHeight
      const inViewport = (rect, pad = 0) =>
        rect.left >= -pad && rect.top >= -pad && rect.right <= vw + pad && rect.bottom <= vh + pad

      const meta = document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? ''

      const gate = !!document.querySelector('.mobile-gate')

      // RenderControls panel (outer fixed div wraps the toggle button)
      const rcBtn = document.querySelector('button[aria-label="Toggle render quality panel"]')
      const rcRect = rcBtn ? rcBtn.parentElement.getBoundingClientRect() : null

      // dimension labels (step2)
      const dims = [...document.querySelectorAll('.dim-label')].map((el) => {
        const b = el.getBoundingClientRect()
        return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), ok: inViewport(b, 2) }
      })

      // primary CTA obstruction: is the topmost element at its center the CTA itself?
      const cta = document.querySelector('.panel-foot .btn-primary')
      let ctaObscured = null
      if (cta) {
        const b = cta.getBoundingClientRect()
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
        ctaObscured = !(hit === cta || cta.contains(hit) || hit?.contains?.(cta))
      }

      return {
        hOverflow: de.scrollWidth - de.clientWidth,
        meta,
        gate,
        rcRect: rcRect
          ? { l: Math.round(rcRect.left), r: Math.round(rcRect.right), t: Math.round(rcRect.top), b: Math.round(rcRect.bottom), ok: inViewport(rcRect, 1) }
          : null,
        dims,
        ctaObscured,
      }
    })

    const shot = join(OUT, `${bp.name}--${pg.name}.png`)
    await page.screenshot({ path: shot })

    const small = bp.w < 700
    const notes = []
    if (/user-scalable\s*=\s*no|maximum-scale/i.test(r.meta)) fail(`${pg.name}: viewport meta still blocks zoom (${r.meta})`)
    if (r.hOverflow > 1) fail(`${pg.name}: horizontal overflow ${r.hOverflow}px`)

    if (pg.threeD && small) {
      if (!r.gate) fail(`${pg.name}: expected MobileGate below 700px, got live editor`)
      else notes.push('gate ✓')
    } else if (pg.threeD) {
      if (r.gate) fail(`${pg.name}: gate shown at ${bp.w}px (should be >=700 only)`)
      if (!r.rcRect) notes.push('no RenderControls (n/a)')
      else if (!r.rcRect.ok) fail(`${pg.name}: RenderControls outside viewport ${JSON.stringify(r.rcRect)}`)
      else notes.push(`render-panel ✓ [${r.rcRect.l},${r.rcRect.r}]`)
      if (r.ctaObscured === true) fail(`${pg.name}: primary CTA obscured by an overlay`)
      else if (r.ctaObscured === false) notes.push('cta ✓')
      if (pg.name === 'step2') {
        const bad = r.dims.filter((d) => !d.ok)
        if (r.dims.length === 0) fail('step2: no .dim-label rendered')
        else if (bad.length) fail(`step2: ${bad.length}/${r.dims.length} dim-labels outside viewport ${JSON.stringify(bad)}`)
        else notes.push(`dim-labels ${r.dims.length}/4 ✓`)
      }
    }
    console.log(` [${pg.name}] ${notes.join(' · ') || 'ok'}`)
    await page.close()
  }
}

await browser.close()
console.log(failures ? `\n❌ ${failures} failure(s)` : '\n✓ all responsive checks passed')
process.exit(failures ? 1 : 0)
