/**
 * Guards the SHIPPED listings dataset (public/listings.json + public/images).
 *
 * Listing photos scraped from Facebook live on signed CDN URLs that expire
 * ~4 days after the scrape — the app must only ever reference the local
 * mirror. These tests fail if a scrape/backfill regresses to hotlinking, or
 * ships a local path whose file is missing/invalid.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sniffImageExt, MIN_IMAGE_BYTES } from './lib/listing-media.mjs'

const publicDir = fileURLToPath(new URL('../public', import.meta.url))
const docPath = path.join(publicDir, 'listings.json')
const isRemote = (u) => typeof u === 'string' && /^https?:/i.test(u)

const doc = JSON.parse(fs.readFileSync(docPath, 'utf8'))

describe('public/listings.json — shipped dataset shape', () => {
  it('has a consistent count and listing essentials', () => {
    expect(Array.isArray(doc.listings)).toBe(true)
    expect(doc.listings.length).toBeGreaterThan(0)
    expect(doc.count).toBe(doc.listings.length)
    for (const l of doc.listings) {
      expect(l.id, 'listing id').toBeTruthy()
      expect(Array.isArray(l.images), `images[] on ${l.id}`).toBe(true)
      expect(l.hasImages, `hasImages consistency on ${l.id}`).toBe(l.images.length > 0)
    }
  })

  it('never hotlinks remote/CDN photos — images and video posters are local paths', () => {
    for (const l of doc.listings) {
      for (const img of l.images) {
        expect(isRemote(img), `${l.id}: remote image ref ${img}`).toBe(false)
        expect(img, `${l.id}: unexpected image path ${img}`).toMatch(/^\/images\/[^/]+\/[\w-]+\.(jpg|png|webp|gif)$/)
      }
      if (l.video?.thumb != null) expect(isRemote(l.video.thumb), `${l.id}: remote video thumb`).toBe(false)
      if (l.video?.file != null) expect(l.video.file, `${l.id}: video file path`).toMatch(/^\/videos\//)
    }
    const raw = fs.readFileSync(docPath, 'utf8')
    const doc2 = JSON.parse(raw)
    for (const l of doc2.listings) delete l.imageSources // provenance MAY be fbcdn
    expect(JSON.stringify(doc2)).not.toMatch(/fbcdn/)
  })

  it('keeps provenance: imageSources aligns 1:1 with images where present', () => {
    for (const l of doc.listings) {
      if (l.imageSources !== undefined) {
        expect(l.imageSources.length, `imageSources length on ${l.id}`).toBe(l.images.length)
        for (const src of l.imageSources) expect(typeof src).toBe('string')
      }
    }
  })

  it('every referenced image file exists on disk and is a real image (>1KB, valid magic bytes)', () => {
    for (const l of doc.listings) {
      for (const img of l.images) {
        const file = path.join(publicDir, img)
        expect(fs.existsSync(file), `${l.id}: missing file ${img}`).toBe(true)
        const buf = fs.readFileSync(file)
        expect(buf.length, `${l.id}: suspiciously small ${img}`).toBeGreaterThan(MIN_IMAGE_BYTES)
        const ext = sniffImageExt(buf)
        expect(ext, `${l.id}: not an image ${img}`).not.toBe(null)
        expect(img.endsWith(ext), `${l.id}: extension lies about content ${img}`).toBe(true)
      }
    }
  })
})
