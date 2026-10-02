/**
 * Roomio flat-listings pipeline (no-broker listings).
 *
 * Scrapes a Facebook flatmate GROUP via a logged-in MEMBER session (cookies, never a
 * password) and writes a recency-sorted listings JSON the Roomio app loads at
 * /listings.json.
 *
 * HOW IT WORKS — GraphQL interception (not DOM scraping). The group feed loads via
 * /api/graphql/ responses whose JSON carries each post's id, full text, timestamp and
 * its OWN photo/video attachments. We capture those responses while scrolling and
 * parse the post nodes. This is why media is correctly associated per post: the photos
 * come from inside each post's own node — the permalink-page DOM instead mixes the post
 * with "Suggested Reels" and group-album photos, which caused unrelated images before.
 *
 * We keep OFFERING posts (someone posting a flat, usually with photos) and drop SEEKING
 * posts (someone asking for one). Per listing: text, phones (shown OPENLY + Call button),
 * photos, optional video, and parsed rent / BHK / locality / gender / occupancy.
 *
 * MEDIA IS MIRRORED LOCALLY. Photo/video URLs are signed FB CDN links that expire
 * ~4 days after the scrape, so photos are downloaded to public/images/<postId>/<n>.jpg
 * (original URLs preserved in `imageSources`) and videos to public/videos/<postId>.mp4.
 * Downloads go into *.staging dirs swapped into place only after ALL downloads finish,
 * every CDN fetch carries a hard timeout, and listings.json is written atomically
 * (tmp+rename) — an interrupted run never destroys existing media or tears the live JSON.
 *
 * ⚠️ Logged-in scraping (against Meta ToS). Use a DEDICATED burner that is a MEMBER of
 * the group; keep cookies out of git; run infrequently.
 *
 * Usage:
 *   FB_COOKIES=./scripts/fb-cookies.txt \
 *   GROUP_URL=https://www.facebook.com/groups/1792860891038652 \
 *   node scripts/scrape-listings.mjs
 *
 * Env: FB_COOKIES (required) · GROUP_URL · OUT (default public/listings.json) ·
 *      MAX_SCROLLS (18) · MAX_VIDEO_MB (40) · NO_VIDEO=1 to skip video · CHROME_PATH ·
 *      HEADLESS=0 to watch · IMAGE_DIR (public/images) · VIDEO_DIR (public/videos) ·
 *      IMAGE_TIMEOUT_MS (30000) · VIDEO_TIMEOUT_MS (90000).
 */
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { extractPhones, parseListing } from './lib/parse-listing.mjs'
import {
  IMAGE_TIMEOUT_MS,
  VIDEO_TIMEOUT_MS,
  fetchWithTimeout,
  downloadListingImages,
  writeJsonAtomic,
  swapDirIntoPlace,
} from './lib/listing-media.mjs'

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const GROUP = process.env.GROUP_URL || 'https://www.facebook.com/groups/1792860891038652'
const OUT = process.env.OUT || 'public/listings.json'
const COOKIES_PATH = process.env.FB_COOKIES
const MAX_SCROLLS = Number(process.env.MAX_SCROLLS || 18)
const VIDEO_DIR = process.env.VIDEO_DIR || 'public/videos'
const IMAGE_DIR = process.env.IMAGE_DIR || 'public/images'
const MAX_VIDEO_MB = Number(process.env.MAX_VIDEO_MB || 40)
const DOWNLOAD_VIDEO = !process.env.NO_VIDEO
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!COOKIES_PATH || !fs.existsSync(COOKIES_PATH)) {
  console.error('Set FB_COOKIES to a cookies file (Netscape cookies.txt or JSON) from a member burner account.')
  process.exit(2)
}

function loadCookies(p) {
  const raw = fs.readFileSync(p, 'utf8')
  if (raw.trimStart().startsWith('[')) {
    return JSON.parse(raw)
      .filter((c) => /facebook\.com$/.test((c.domain || '.facebook.com').replace(/^\./, '')))
      .map((c) => ({ name: c.name, value: c.value, domain: c.domain || '.facebook.com', path: c.path || '/' }))
  }
  const out = []
  for (let line of raw.split(/\r?\n/)) {
    if (line.startsWith('#HttpOnly_')) line = line.slice(10)
    else if (line.startsWith('#') || !line.trim()) continue
    const f = line.split('\t')
    if (f.length < 7 || !/facebook\.com$/.test(f[0].replace(/^\./, ''))) continue
    const c = { name: f[5], value: f[6], domain: f[0], path: f[2] || '/', secure: f[3] === 'TRUE' }
    if (Number(f[4]) > 0) c.expires = Number(f[4])
    out.push(c)
  }
  return out
}

/**
 * Parse captured /api/graphql/ response bodies into a Map<postId, {id,text,photos,
 * createdAt,videoUrl}>. FB streams newline-delimited JSON; we JSON.parse each line and
 * recursively find "story" nodes — an object carrying `message.text` and a post id
 * (post_id / story_fbid). Photos and video are collected from WITHIN that node, so they
 * belong to that post (no cross-post contamination).
 */
function parseGraphQL(bodies) {
  const chunks = []
  for (const body of bodies) {
    for (const line of body.split('\n')) {
      const s = line.trim()
      if (!s.startsWith('{')) continue
      try { chunks.push(JSON.parse(s)) } catch { /* partial chunk */ }
    }
  }
  const posts = new Map()
  // post_id and creation_time sit together in the story's metadata node (a sibling of
  // the message node), so build id→time here and join it onto posts afterwards.
  const timeById = new Map()
  const collectPhotos = (o, acc) => {
    if (!o || typeof o !== 'object') return
    if (Array.isArray(o)) { for (const x of o) collectPhotos(x, acc); return }
    if (o.photo_image?.uri) acc.add(o.photo_image.uri)
    else if (o.image?.uri && /scontent/.test(o.image.uri) && (o.__typename === 'Photo' || (o.image.width || 0) > 320)) acc.add(o.image.uri)
    for (const k in o) collectPhotos(o[k], acc)
  }
  const findVideo = (o) => {
    let url = null
    ;(function v(n) {
      if (url || !n || typeof n !== 'object') return
      if (Array.isArray(n)) { for (const x of n) v(x); return }
      if (n.__typename === 'Video') url = n.browser_native_sd_url || n.playable_url || n.browser_native_hd_url || url
      for (const k in n) v(n[k])
    })(o)
    return url
  }
  const walk = (o) => {
    if (!o || typeof o !== 'object') return
    if (Array.isArray(o)) { for (const x of o) walk(x); return }
    if (typeof o.post_id === 'string' && typeof o.creation_time === 'number') timeById.set(o.post_id, o.creation_time)
    const text = o.message && typeof o.message === 'object' ? o.message.text : undefined
    const id = o.post_id || o.story_fbid || (o.__typename === 'Story' ? o.id : undefined)
    if (typeof text === 'string' && text.length > 15 && id) {
      const key = String(id)
      const acc = new Set(); collectPhotos(o, acc)
      const entry = posts.get(key)
      if (!entry) posts.set(key, { id: key, text, photos: [...acc].slice(0, 8), videoUrl: findVideo(o) })
      else {
        if (text.length > entry.text.length) entry.text = text
        entry.photos = [...new Set([...entry.photos, ...acc])].slice(0, 8)
        entry.videoUrl = entry.videoUrl || findVideo(o)
      }
    }
    for (const k in o) walk(o[k])
  }
  for (const c of chunks) walk(c)
  for (const p of posts.values()) p.createdAt = timeById.get(p.id) || null
  return posts
}

/** Download a progressive mp4 (with audio) into <dir>/<id>.mp4; returns app path or null.
 *  Hard timeout on the whole fetch+body read — a hung/trickling CDN must not stall the run. */
async function downloadVideo(url, id, dir) {
  if (!url) return null
  try {
    const res = await fetchWithTimeout(url, { timeoutMs: VIDEO_TIMEOUT_MS })
    if (!res.ok) return null
    if (Number(res.headers.get('content-length') || 0) > MAX_VIDEO_MB * 1024 * 1024) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 10000 || buf.length > MAX_VIDEO_MB * 1024 * 1024) return null
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, id + '.mp4'), buf)
    return `/videos/${id}.mp4`
  } catch { return null }
}

/** Human "x ago" from a unix-seconds timestamp. */
function relTime(sec) {
  if (!sec) return null
  const m = Math.max(0, Math.round(Date.now() / 1000 - sec) / 60)
  if (m < 60) return `${Math.round(m)}m ago`
  if (m < 1440) return `${Math.round(m / 60)}h ago`
  return `${Math.round(m / 1440)}d ago`
}

// ── run ───────────────────────────────────────────────────────────────────────
const cookies = loadCookies(COOKIES_PATH)
if (!cookies.some((c) => c.name === 'c_user') || !cookies.some((c) => c.name === 'xs')) {
  console.error('Cookies missing c_user/xs — not an authenticated session.')
  process.exit(2)
}
const groupId = (GROUP.match(/groups\/([^/?]+)/) || [])[1] || 'group'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.HEADLESS === '0' ? false : 'new',
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--lang=en-US', '--window-size=1400,2400'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 2400 })
await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
await page.setCookie(...cookies)

const bodies = []
page.on('response', async (res) => {
  try { if (/\/api\/graphql\//.test(res.url())) bodies.push(await res.text()) } catch { /* stream closed */ }
})

await page.goto(GROUP.replace(/\/$/, '') + '/?locale=en_US', { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(4000)
const status = await page.evaluate(() => ({
  loginWall: /Log in to continue|You must log in/i.test(document.body.innerText) && !!document.querySelector('input[name="pass"]'),
  joinBtn: [...document.querySelectorAll('[role="button"],a')].some((e) => /^(Join group|Request to join)$/i.test((e.innerText || '').trim())),
}))
if (status.loginWall) { console.error('LOGIN_WALL — cookies invalid/expired.'); await browser.close(); process.exit(3) }
if (status.joinBtn) console.error('WARNING: account is not a MEMBER — content may be missing.')

for (let i = 0; i < MAX_SCROLLS; i++) { await page.evaluate(() => window.scrollBy(0, 1400)); await sleep(2200) }
await browser.close()

// parse → classify → keep offering flats
const posts = [...parseGraphQL(bodies).values()].map((p, i) => ({ ...p, _i: i, phones: extractPhones(p.text), ...parseListing(p.text) }))
const FLAT_RE = /\b(flat|flatmate|room|room ?mate|apartment|\d\s?bhk|\d\s?rk|studio|\bpg\b|occupancy|furnished|rent|vacant|brokerage|deposit|accommodation|possession|sq\.?\s?ft|carpet area|paying guest|to let)\b/i
// keep OFFERING flats; DROP seekers even if they mention a budget/BHK (that's their ask,
// not a listing). null-kind kept only when it carries a hard signal.
const kept = posts.filter((p) => p.kind !== 'seeking' && FLAT_RE.test(p.text) && (p.kind === 'offering' || p.rent != null || p.bhk != null || p.occupancy != null))
console.log(`GraphQL: ${posts.length} posts · offering ${posts.filter((p) => p.kind === 'offering').length} · seeking(dropped) ${posts.filter((p) => p.kind === 'seeking').length} → kept ${kept.length}`)

// newest first by post creation_time; feed order breaks ties / covers missing times
kept.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || a._i - b._i)

// Mirror each post's OWN media (correctly associated) locally: the CDN URLs are
// signed and expire in days. Everything downloads into *.staging dirs first —
// the live public/videos + public/images are only replaced after EVERY download
// has finished, so a crash/Ctrl-C mid-download never destroys the current set.
const videoStaging = path.resolve(VIDEO_DIR + '.staging')
const imageStaging = path.resolve(IMAGE_DIR + '.staging')
fs.rmSync(videoStaging, { recursive: true, force: true })
fs.rmSync(imageStaging, { recursive: true, force: true })
for (const p of kept) {
  p.videoFile = DOWNLOAD_VIDEO && p.videoUrl ? await downloadVideo(p.videoUrl, p.id, videoStaging) : null
  const dl = await downloadListingImages(p.photos, p.id, imageStaging, { timeoutMs: IMAGE_TIMEOUT_MS })
  p.localImages = dl.images
  p.imageSources = dl.imageSources
}
swapDirIntoPlace(videoStaging, VIDEO_DIR)
swapDirIntoPlace(imageStaging, IMAGE_DIR)

const listings = kept.map((p, seq) => ({
  id: p.id,
  postId: p.id,
  permalink: `https://www.facebook.com/groups/${groupId}/posts/${p.id}/`,
  author: null,
  text: p.text.slice(0, 2000),
  phones: p.phones,
  rent: p.rent,
  bhk: p.bhk,
  location: p.location,
  gender: p.gender,
  occupancy: p.occupancy,
  images: p.localImages, // local /images/<id>/<n>.jpg paths (remote URL kept only if its download failed)
  imageSources: p.imageSources, // original CDN URLs, same order as images
  video: p.videoFile ? { thumb: p.localImages[0] || null, src: null, file: p.videoFile } : null,
  hasVideo: !!p.videoFile,
  hasImages: p.localImages.length > 0,
  postedAbs: relTime(p.createdAt),
  seq,
}))

const outPath = path.resolve(OUT)
// atomic tmp+rename: the app fetches /listings.json live — never let it see a torn file
writeJsonAtomic(outPath, { group: { id: groupId, url: GROUP.replace(/\/$/, '') }, scrapedAt: new Date().toISOString(), count: listings.length, listings })
console.log(`Wrote ${listings.length} listings → ${outPath}`)
console.log(`  with photos: ${listings.filter((l) => l.hasImages).length} · with video: ${listings.filter((l) => l.hasVideo).length} · with phone: ${listings.filter((l) => l.phones.length).length}`)
