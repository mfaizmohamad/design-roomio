import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {
  sniffImageExt,
  downloadImage,
  downloadListingImages,
  writeJsonAtomic,
  swapDirIntoPlace,
  MIN_IMAGE_BYTES,
} from './listing-media.mjs'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'listing-media-'))
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }))
const tmpDir = (name) => {
  const d = path.join(tmpRoot, name)
  fs.mkdirSync(d, { recursive: true })
  return d
}

// minimal valid magic-byte payloads, padded past the 1KB error-page floor
const pad = Buffer.alloc(2048)
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pad])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pad])
const WEBP = Buffer.concat([Buffer.from('RIFF....WEBP', 'ascii'), pad])

describe('sniffImageExt — file type from magic bytes, never from the URL', () => {
  it('recognizes jpeg/png/webp/gif', () => {
    expect(sniffImageExt(JPEG)).toBe('.jpg')
    expect(sniffImageExt(PNG)).toBe('.png')
    expect(sniffImageExt(WEBP)).toBe('.webp')
    expect(sniffImageExt(Buffer.concat([Buffer.from('GIF89a', 'ascii'), pad]))).toBe('.gif')
  })
  it('rejects non-images and truncated buffers', () => {
    expect(sniffImageExt(Buffer.from('<html>Not Found</html>' + '.'.repeat(100)))).toBe(null)
    expect(sniffImageExt(Buffer.from([0xff, 0xd8]))).toBe(null) // too short to trust
    expect(sniffImageExt(null)).toBe(null)
  })
})

describe('writeJsonAtomic — tmp+rename, never a torn live file', () => {
  it('writes parseable JSON and leaves no .tmp behind', () => {
    const file = path.join(tmpDir('atomic'), 'listings.json')
    writeJsonAtomic(file, { count: 2, listings: [{ id: 'a' }, { id: 'b' }] })
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).count).toBe(2)
    expect(fs.existsSync(file + '.tmp')).toBe(false)
  })
  it('replaces an existing file completely', () => {
    const file = path.join(tmpDir('atomic2'), 'listings.json')
    fs.writeFileSync(file, JSON.stringify({ old: true, huge: 'x'.repeat(10000) }))
    writeJsonAtomic(file, { fresh: true })
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ fresh: true })
  })
})

describe('swapDirIntoPlace — old media survives until replacements are complete', () => {
  it('replaces the final dir with staging contents', () => {
    const base = tmpDir('swap')
    const staging = path.join(base, 'images.staging')
    const final = path.join(base, 'images')
    fs.mkdirSync(path.join(final), { recursive: true })
    fs.writeFileSync(path.join(final, 'old.jpg'), 'old')
    fs.mkdirSync(staging, { recursive: true })
    fs.writeFileSync(path.join(staging, 'new.jpg'), 'new')
    swapDirIntoPlace(staging, final)
    expect(fs.existsSync(path.join(final, 'new.jpg'))).toBe(true)
    expect(fs.existsSync(path.join(final, 'old.jpg'))).toBe(false)
    expect(fs.existsSync(staging)).toBe(false)
  })
  it('an empty download set still clears stale media (new JSON no longer references it)', () => {
    const base = tmpDir('swap2')
    const final = path.join(base, 'videos')
    fs.mkdirSync(final, { recursive: true })
    fs.writeFileSync(path.join(final, 'stale.mp4'), 'stale')
    swapDirIntoPlace(path.join(base, 'videos.staging'), final) // staging never created
    expect(fs.readdirSync(final)).toEqual([])
  })
})

describe('downloadImage / downloadListingImages — against a local HTTP server', () => {
  /** @type {http.Server} */ let server
  /** @type {string} */ let base
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/ok.jpg') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(JPEG) }
      else if (req.url === '/ok.png') { res.writeHead(200); res.end(PNG) }
      else if (req.url === '/error-page') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>login wall</html>') }
      else if (req.url === '/tiny.jpg') { res.writeHead(200); res.end(JPEG.subarray(0, MIN_IMAGE_BYTES - 200)) }
      else if (req.url === '/trickle') {
        // chunked (no content-length) response that trickles forever — the
        // gen-07 hang: per-chunk body timeouts reset, only a hard abort stops it
        res.writeHead(200, { 'Content-Type': 'image/jpeg' })
        res.write(Buffer.from([0xff, 0xd8, 0xff]))
        const t = setInterval(() => res.write(Buffer.from([0x00])), 50)
        res.on('close', () => clearInterval(t))
      } else { res.writeHead(404); res.end('nope') }
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${server.address().port}`
  })
  afterAll(() => new Promise((r) => server.close(r)))

  it('downloads a valid image, naming the file from magic bytes', async () => {
    const dir = tmpDir('dl')
    expect(await downloadImage(`${base}/ok.jpg`, dir, '1')).toBe('1.jpg')
    expect(await downloadImage(`${base}/ok.png`, dir, '2')).toBe('2.png')
    expect(fs.statSync(path.join(dir, '1.jpg')).size).toBeGreaterThan(MIN_IMAGE_BYTES)
  })
  it('returns null for 404s, HTML error pages and sub-1KB payloads (writes nothing)', async () => {
    const dir = tmpDir('dl-bad')
    expect(await downloadImage(`${base}/missing.jpg`, dir, '1')).toBe(null)
    expect(await downloadImage(`${base}/error-page`, dir, '2')).toBe(null)
    expect(await downloadImage(`${base}/tiny.jpg`, dir, '3')).toBe(null)
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([])
  })
  it('aborts a trickling body at the hard timeout instead of hanging (gen-07)', async () => {
    const started = Date.now()
    const out = await downloadImage(`${base}/trickle`, tmpDir('dl-trickle'), '1', { timeoutMs: 500 })
    expect(out).toBe(null)
    expect(Date.now() - started).toBeLessThan(5000)
  }, 10000)
  it('downloadListingImages mirrors a photo set, keeping the remote URL for failures', async () => {
    const imagesDir = tmpDir('set')
    const urls = [`${base}/ok.jpg`, `${base}/missing.jpg`, '/images/L1/old.jpg']
    const { images, imageSources } = await downloadListingImages(urls, 'L1', imagesDir)
    expect(images).toEqual(['/images/L1/1.jpg', `${base}/missing.jpg`, '/images/L1/old.jpg'])
    expect(imageSources).toEqual(urls)
    expect(fs.existsSync(path.join(imagesDir, 'L1', '1.jpg'))).toBe(true)
  })
  it('preserves prior provenance for already-local entries (idempotent backfill)', async () => {
    const { images, imageSources } = await downloadListingImages(
      ['/images/L2/1.jpg'], 'L2', tmpDir('set2'),
      { sources: ['https://cdn.example/original-1.jpg'] },
    )
    expect(images).toEqual(['/images/L2/1.jpg'])
    expect(imageSources).toEqual(['https://cdn.example/original-1.jpg'])
  })
})
