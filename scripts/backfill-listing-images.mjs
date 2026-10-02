/**
 * Backfill: localize remote listing photos in an EXISTING public/listings.json.
 *
 * The scraper now mirrors photos at scrape time, but data scraped before that
 * change hotlinks signed Facebook CDN URLs that expire ~4 days after the
 * scrape. This script rescues such a dataset while the links still work:
 *
 *   - downloads every remote (http…) image to public/images/<listingId>/<n>.<ext>
 *   - rewrites `images` to the local app paths (/images/<id>/<n>.jpg)
 *   - preserves every original source URL in `imageSources` (same order)
 *   - localizes a remote video poster to /images/<id>/thumb.<ext> (`thumbSource`)
 *   - writes listings.json back ATOMICALLY (tmp+rename)
 *
 * Idempotent: already-local paths are left untouched, so re-running only
 * retries previously failed downloads. Exits 1 if any download failed (the
 * JSON is still written — failed entries keep their remote URL).
 *
 * Usage: node scripts/backfill-listing-images.mjs
 * Env:   OUT (default public/listings.json) · IMAGE_DIR (default public/images) ·
 *        IMAGE_TIMEOUT_MS (default 30000)
 */
import fs from 'node:fs'
import path from 'node:path'
import { downloadImage, downloadListingImages, writeJsonAtomic, IMAGE_TIMEOUT_MS } from './lib/listing-media.mjs'

const OUT = process.env.OUT || 'public/listings.json'
const IMAGE_DIR = path.resolve(process.env.IMAGE_DIR || 'public/images')
const isRemote = (u) => typeof u === 'string' && /^https?:/i.test(u)

const outPath = path.resolve(OUT)
if (!fs.existsSync(outPath)) {
  console.error(`No listings file at ${outPath} — nothing to backfill.`)
  process.exit(2)
}
const doc = JSON.parse(fs.readFileSync(outPath, 'utf8'))
if (!Array.isArray(doc.listings)) {
  console.error(`${outPath} has no listings[] — refusing to rewrite.`)
  process.exit(2)
}

let remote = 0
let downloaded = 0
const failures = []

for (const l of doc.listings) {
  const urls = l.images ?? []
  const remoteHere = urls.filter(isRemote).length
  if (remoteHere) {
    remote += remoteHere
    console.log(`listing ${l.id}: ${remoteHere} remote image(s)`)
    // keep any provenance recorded by a previous run for already-local entries
    const { images, imageSources } = await downloadListingImages(urls, l.id, IMAGE_DIR, {
      timeoutMs: IMAGE_TIMEOUT_MS,
      sources: l.imageSources ?? null,
    })
    downloaded += images.filter((img, i) => !isRemote(img) && isRemote(urls[i])).length
    failures.push(...images.filter(isRemote).map((u, i) => `${l.id} image #${i + 1}`))
    l.images = images
    l.imageSources = imageSources
  }

  // video poster can be a remote CDN URL too — mirror it next to the photos
  if (l.video && isRemote(l.video.thumb)) {
    remote += 1
    const file = await downloadImage(l.video.thumb, path.join(IMAGE_DIR, String(l.id)), 'thumb', { timeoutMs: IMAGE_TIMEOUT_MS })
    if (file) {
      downloaded += 1
      l.video.thumbSource = l.video.thumb
      l.video.thumb = `/images/${l.id}/${file}`
    } else {
      failures.push(`${l.id} video thumb`)
    }
  }
}

writeJsonAtomic(outPath, doc)

const localFiles = fs.existsSync(IMAGE_DIR)
  ? fs.readdirSync(IMAGE_DIR, { recursive: true }).filter((f) => fs.statSync(path.join(IMAGE_DIR, String(f))).isFile())
  : []
console.log(`\nRewrote ${outPath}`)
console.log(`  remote refs found: ${remote} · downloaded this run: ${downloaded} · local files on disk: ${localFiles.length}`)
if (failures.length) {
  console.error(`  ✗ ${failures.length} download(s) FAILED (remote URL kept): ${failures.join(', ')}`)
  console.error('  Re-run to retry while the CDN links are still valid.')
  process.exit(1)
}
console.log('  ✓ all listing media is local')
