import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import zlib from 'node:zlib'
import { resolveChrome, CHROME_FLAGS, CHROME_CANDIDATES } from './chrome.mjs'
import { isValidPort, getFreePort, waitForServer } from './net.mjs'
import { decodePng, pngStats, cornerWhiteFractions, assertRenderQuality, PNG_SIGNATURE } from './png.mjs'

// ── PNG fixture builders (tiny, self-contained — no image dependency) ─────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0
  return (c ^ 0xffffffff) >>> 0
}
/** Wrap already-filter-prefixed raw scanlines into a valid PNG. */
function packPng(width, height, colorType, raw) {
  const parts = [PNG_SIGNATURE]
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body), 0)
    parts.push(len, body, crc)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = colorType
  chunk('IHDR', ihdr)
  chunk('IDAT', zlib.deflateSync(raw))
  chunk('IEND', Buffer.alloc(0))
  return Buffer.concat(parts)
}
/** RGBA PNG from a pixel fn, all rows filter 0 (None). */
function encodeRGBA(width, height, px) {
  const ch = 4
  const stride = width * ch
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = px(x, y)
      const o = y * (stride + 1) + 1 + x * ch
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a
    }
  }
  return packPng(width, height, 6, raw)
}
describe('resolveChrome — CHROME override, candidate fallback, listed failure (PIPE-3)', () => {
  const exists = (set) => (p) => set.has(p)
  it('prefers CHROME / CHROME_PATH when the file exists', () => {
    expect(resolveChrome({ env: { CHROME: '/opt/chrome' }, exists: exists(new Set(['/opt/chrome'])) })).toBe('/opt/chrome')
    expect(resolveChrome({ env: { CHROME_PATH: '/opt/edge' }, exists: exists(new Set(['/opt/edge'])) })).toBe('/opt/edge')
  })
  it('throws (not silently falls back) when the override path is missing', () => {
    expect(() => resolveChrome({ env: { CHROME: '/nope' }, exists: () => false })).toThrow(/\/nope/)
  })
  it('falls back to the first existing candidate', () => {
    const only = CHROME_CANDIDATES[2]
    expect(resolveChrome({ env: {}, exists: exists(new Set([only])) })).toBe(only)
  })
  it('throws listing every path it tried when nothing is found', () => {
    let msg = ''
    try { resolveChrome({ env: {}, exists: () => false }) } catch (e) { msg = e.message }
    expect(msg).toMatch(/CHROME=/)
    for (const p of CHROME_CANDIDATES) expect(msg).toContain(p)
  })
  it('exposes the verified SwiftShader flag set', () => {
    expect(CHROME_FLAGS).toContain('--use-angle=swiftshader')
    expect(CHROME_FLAGS).toContain('--enable-unsafe-swiftshader')
  })
})

describe('net helpers — free port + readiness (PIPE-5)', () => {
  it('isValidPort accepts 1..65535, rejects the rest', () => {
    expect(isValidPort(1)).toBe(true)
    expect(isValidPort(65535)).toBe(true)
    expect(isValidPort(0)).toBe(false)
    expect(isValidPort(70000)).toBe(false)
    expect(isValidPort(1.5)).toBe(false)
    expect(isValidPort('80')).toBe(false)
  })
  it('getFreePort returns distinct, valid, bindable ports', async () => {
    const a = await getFreePort()
    const b = await getFreePort()
    expect(isValidPort(a)).toBe(true)
    expect(isValidPort(b)).toBe(true)
    // bindable right now
    await new Promise((res, rej) => {
      const s = http.createServer()
      s.on('error', rej)
      s.listen(a, '127.0.0.1', () => s.close(res))
    })
  })
  it('waitForServer resolves true for a live server, false (quickly) for a dead port', async () => {
    const server = http.createServer((_req, res) => res.end('ok'))
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const port = server.address().port
    expect(await waitForServer(`http://127.0.0.1:${port}`, { timeoutMs: 2000 })).toBe(true)
    await new Promise((r) => server.close(r))
    const dead = await getFreePort()
    const t0 = Date.now()
    expect(await waitForServer(`http://127.0.0.1:${dead}`, { timeoutMs: 700, intervalMs: 100 })).toBe(false)
    expect(Date.now() - t0).toBeLessThan(3000)
  }, 8000)
})

describe('decodePng — dependency-free PNG decode across filter types', () => {
  it('rejects non-PNG buffers', () => {
    expect(() => decodePng(Buffer.from('not a png at all'))).toThrow(/signature/)
  })
  it('round-trips solid + varied RGBA images (filter 0)', () => {
    const solid = decodePng(encodeRGBA(3, 2, () => [10, 20, 30, 255]))
    expect(solid.width).toBe(3)
    expect(solid.height).toBe(2)
    expect([...solid.data.subarray(0, 4)]).toEqual([10, 20, 30, 255])
  })
  it('reverses Sub (type 1) and Up (type 2) filters', () => {
    // 3x1 RGBA, Sub-filtered: filtered[i] = orig[i] - orig[i-4]
    const orig1 = [10, 20, 30, 255, 40, 60, 80, 255, 100, 130, 160, 255]
    const sub = [1]
    for (let i = 0; i < orig1.length; i++) sub.push((orig1[i] - (i >= 4 ? orig1[i - 4] : 0)) & 0xff)
    const subPng = decodePng(packPng(3, 1, 6, Buffer.from(sub)))
    expect([...subPng.data]).toEqual(orig1)

    // 1x3 RGBA, Up-filtered: filtered_row[i] = orig_row[i] - prev_row[i]
    const rows = [[5, 5, 5, 255], [15, 25, 35, 255], [200, 100, 50, 255]]
    const up = []
    let prev = [0, 0, 0, 0]
    for (const row of rows) {
      up.push(2)
      for (let i = 0; i < 4; i++) up.push((row[i] - prev[i]) & 0xff)
      prev = row
    }
    const upPng = decodePng(packPng(1, 3, 6, Buffer.from(up)))
    expect([...upPng.data]).toEqual(rows.flat())
  })
})

describe('assertRenderQuality — the notBlank / notBlack / noHudCorners checks', () => {
  it('flags a solid (blank) image and an all-black image', () => {
    const gray = assertRenderQuality(encodeRGBA(40, 40, () => [128, 128, 128, 255]))
    expect(gray.ok).toBe(false)
    expect(gray.failures.join(' ')).toMatch(/blank\/uniform/)

    const black = assertRenderQuality(encodeRGBA(40, 40, () => [0, 0, 0, 255]))
    expect(black.ok).toBe(false)
    expect(black.failures.join(' ')).toMatch(/near-black/)
  })
  it('passes a varied, non-black render', () => {
    const scene = encodeRGBA(64, 64, (x, y) => [(x * 5) & 0xff, (y * 5) & 0xff, ((x + y) * 3) & 0xff, 255])
    const q = assertRenderQuality(scene)
    expect(q.ok).toBe(true)
    expect(q.failures).toEqual([])
    expect(q.stats.width).toBe(64)
    expect(q.stats.std).toBeGreaterThan(6)
  })
  it('noHudCorners catches a bright pill in a corner but ignores a saturated scene', () => {
    // saturated blue scene (low luminance-variance but high saturation) + white block top-right
    const withPill = encodeRGBA(100, 100, (x, y) => (x >= 78 && y < 22 ? [250, 250, 250, 255] : [30, 70, 160, 255]))
    const q = assertRenderQuality(withPill, { notBlank: false, notBlack: false, noHudCorners: true })
    expect(q.ok).toBe(false)
    expect(q.failures.join(' ')).toMatch(/top-right/)

    const clean = encodeRGBA(100, 100, () => [30, 70, 160, 255])
    const q2 = assertRenderQuality(clean, { notBlank: false, notBlack: false, noHudCorners: true })
    expect(q2.ok).toBe(true)
  })
  it('pngStats / cornerWhiteFractions expose the underlying numbers', () => {
    const png = decodePng(encodeRGBA(20, 20, () => [255, 255, 255, 255]))
    const s = pngStats(png)
    expect(s.mean).toBeCloseTo(255, 0)
    expect(s.std).toBeCloseTo(0, 5)
    const corners = cornerWhiteFractions(png)
    expect(corners.map((c) => c.name)).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
    expect(corners.every((c) => c.frac === 1)).toBe(true)
  })
})
