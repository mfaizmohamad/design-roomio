import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// ── WCAG 2.x relative-luminance / contrast helpers ──────────────────────────
function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
function contrast(fg: string, bg: string): number {
  const a = luminance(fg)
  const b = luminance(bg)
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

// Read the token values straight out of index.css so this test fails if anyone
// regresses the tokens back to a failing colour.
const css = readFileSync(
  fileURLToPath(new URL('./index.css', import.meta.url)),
  'utf8',
)
function token(name: string): string {
  const m = css.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,6})`))
  if (!m) throw new Error(`token --${name} not found in index.css`)
  return m[1]
}

const INK3 = token('ink-3')
const FOCUS_RING = token('focus-ring')

// Surfaces the muted --ink-3 text actually renders over in the app.
const MUTED_TEXT_SURFACES: Record<string, string> = {
  'white (--paper)': '#ffffff',
  'overall-size #f7f5f0': '#f7f5f0',
  'guest-pill #f2f0ea': '#f2f0ea',
  'lb-empty #fbfaf7': '#fbfaf7',
  'listings #f6f4ef': '#f6f4ef',
  'lb-tabs wash #f1efe9': '#f1efe9',
  'catalog-empty edge #fbfaf7': '#fbfaf7',
}

describe('WCAG contrast of a11y-critical tokens', () => {
  it('--ink-3 muted text clears AA (≥4.5:1) on every surface it is used on', () => {
    for (const [label, bg] of Object.entries(MUTED_TEXT_SURFACES)) {
      const ratio = contrast(INK3, bg)
      expect(ratio, `--ink-3 (${INK3}) on ${label} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('--ink-3 is meaningfully darker than the old failing #8a8780', () => {
    // guard: the old token failed AA on white (~3.58:1)
    expect(contrast('#8a8780', '#ffffff')).toBeLessThan(4.5)
    expect(luminance(INK3)).toBeLessThan(luminance('#8a8780'))
  })

  it('--focus-ring meets non-text contrast (≥3:1) on BOTH light and dark surfaces', () => {
    const onLight = contrast(FOCUS_RING, '#ffffff')
    const onDark = contrast(FOCUS_RING, '#111111')
    expect(onLight, `focus ring (${FOCUS_RING}) on #fff = ${onLight.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
    expect(onDark, `focus ring (${FOCUS_RING}) on #111 = ${onDark.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
  })

  it('the yellow brand tokens are (correctly) NOT used as focus rings — they fail 3:1 on white', () => {
    // documents WHY --focus-ring exists: --focus/--select cannot be the ring on light UI
    expect(contrast('#f5c518', '#ffffff')).toBeLessThan(3)
    expect(contrast('#f3b700', '#ffffff')).toBeLessThan(3)
  })
})
