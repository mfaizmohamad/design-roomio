/**
 * Shared media helpers for the listings pipeline (scraper + image backfill).
 *
 * Listing photos/videos come from SIGNED Facebook CDN URLs that expire ~4 days
 * after a scrape, so every remote asset the app needs must be mirrored into
 * /public at scrape time (photos → /public/images/<listingId>/<n>.jpg, videos →
 * /public/videos/<id>.mp4). These helpers give every CDN fetch a hard
 * timeout/abort (a trickling CDN must not hang a run forever), verify image
 * payloads by magic bytes, write JSON atomically (tmp+rename) so readers of the
 * live /listings.json never see a torn file, and swap freshly-downloaded media
 * directories into place only AFTER all downloads succeed, so an interrupted
 * run never destroys the existing media set.
 */
import fs from 'node:fs'
import path from 'node:path'

export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export const CDN_HEADERS = { 'User-Agent': UA, Accept: '*/*', Referer: 'https://www.facebook.com/' }

export const IMAGE_TIMEOUT_MS = Number(process.env.IMAGE_TIMEOUT_MS || 30000)
export const VIDEO_TIMEOUT_MS = Number(process.env.VIDEO_TIMEOUT_MS || 90000)

/** Anything smaller than this is a CDN error page, not a photo. */
export const MIN_IMAGE_BYTES = 1024
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024

/**
 * fetch with a hard abort after `timeoutMs`. The signal also governs the body
 * read (arrayBuffer), so a chunked/trickling response cannot stall forever —
 * undici's per-chunk bodyTimeout alone does not cover that case.
 */
export function fetchWithTimeout(url, { timeoutMs = IMAGE_TIMEOUT_MS, headers = CDN_HEADERS } = {}) {
  return fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
}

/** '.jpg' | '.png' | '.webp' | '.gif' from file magic bytes, or null if not an image. */
export function sniffImageExt(buf) {
  if (!buf || buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp'
  if (buf.toString('ascii', 0, 5) === 'GIF87' || buf.toString('ascii', 0, 5) === 'GIF89') return '.gif'
  return null
}

/**
 * Download one image to <destDir>/<baseName><ext> (extension from magic bytes,
 * never from the URL). Returns the written filename, or null on ANY failure —
 * bad status, timeout, not actually an image, or absurd size — so callers can
 * fall back to the remote URL instead of shipping a broken local ref.
 */
export async function downloadImage(url, destDir, baseName, { timeoutMs = IMAGE_TIMEOUT_MS } = {}) {
  try {
    const res = await fetchWithTimeout(url, { timeoutMs })
    if (!res.ok) return null
    if (Number(res.headers.get('content-length') || 0) > MAX_IMAGE_BYTES) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const ext = sniffImageExt(buf)
    if (!ext || buf.length < MIN_IMAGE_BYTES || buf.length > MAX_IMAGE_BYTES) return null
    fs.mkdirSync(destDir, { recursive: true })
    const file = baseName + ext
    fs.writeFileSync(path.join(destDir, file), buf)
    return file
  } catch {
    return null // timeout/abort/network — caller keeps the remote URL
  }
}

/**
 * Download a listing's photo set into <imagesDir>/<listingId>/<n>.<ext> where
 * `imagesDir` is (a staging copy of) public/images. Returns
 *   { images, imageSources }
 * images[i]      — the local app path (/images/<id>/<n>.jpg), or the ORIGINAL
 *                  remote URL if that download failed (a short-lived CDN link
 *                  beats a broken local ref); already-local entries pass through.
 * imageSources[i] — the original source URL for images[i] (same order/length),
 *                  preserved so the provenance of every mirrored photo is kept.
 */
export async function downloadListingImages(urls, listingId, imagesDir, { timeoutMs = IMAGE_TIMEOUT_MS, sources = null } = {}) {
  const images = []
  const imageSources = []
  let n = 0
  for (const url of urls) {
    n += 1
    const source = sources?.[n - 1] ?? url
    imageSources.push(source)
    if (typeof url !== 'string' || !/^https?:/i.test(url)) {
      images.push(url) // already a local path — leave untouched (idempotent backfill)
      continue
    }
    const file = await downloadImage(url, path.join(imagesDir, String(listingId)), String(n), { timeoutMs })
    if (file) {
      images.push(`/images/${listingId}/${file}`)
    } else {
      console.warn(`  ⚠ image download failed (${listingId} #${n}) — keeping remote URL`)
      images.push(url)
    }
  }
  return { images, imageSources }
}

/**
 * Atomic JSON write: serialize to <file>.tmp in the same directory, then
 * rename over the target. The live file is always complete-or-untouched
 * (same idiom as server/index.js detect-file writes).
 */
export function writeJsonAtomic(filePath, data) {
  const abs = path.resolve(filePath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const tmp = abs + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, abs)
}

/**
 * Replace `finalDir` with `stagingDir` in one step (rm old + rename staging).
 * Call only after EVERY download into staging has finished: if the run dies
 * mid-download, the previous media set survives untouched. A missing staging
 * dir (nothing downloaded) still replaces finalDir with an empty dir, since
 * the new listings.json no longer references the old files.
 */
export function swapDirIntoPlace(stagingDir, finalDir) {
  const staging = path.resolve(stagingDir)
  const final = path.resolve(finalDir)
  fs.mkdirSync(staging, { recursive: true })
  fs.rmSync(final, { recursive: true, force: true })
  fs.renameSync(staging, final)
}
