/**
 * OFFLINE batch: infer per-listing finishes (floor family → FLOOR_TEXTURES id,
 * wall base hex) from a listing's scraped photos, using CLASSICAL computer
 * vision only — no external model, no network, no asset downloads. Emits a
 * schema-shaped, confidence-annotated scene JSON that survives CDN image expiry
 * (committed to src/data/inferredScenes.json) and is consumed at runtime by
 * buildSceneFromListing (see src/data/inferredScenes.ts + src/data/flatTemplates.ts).
 *
 * Why classical-first: only 19/36 listings have photos (avg ~4 each) and most
 * environments have no VLM. The classical tier ALWAYS runs and never blocks the
 * metadata-only path. An OPTIONAL VLM tier (furniture labels via the Agent-B
 * detection-pipeline over Ollama) is gated behind `--vlm` + an availability
 * probe and degrades to a no-op when absent — it enriches, never gates.
 *
 * Pipeline per photo (all deterministic):
 *   1. Decode + downscale the JPEG in headless Chrome (puppeteer-core, the same
 *      engine the verify harness uses) → a small RGBA grid. No JPEG-decoder npm
 *      dependency, no writes to the user's tree.
 *   2. Gray-world WHITE BALANCE in linear light so a warm-lit white wall reads
 *      as an intrinsic (near-neutral) albedo, NOT beige (a raw-pixel read bakes
 *      in the illuminant — the exact failure the acceptance calls out).
 *   3. Region dominant color via a Lab-quantised histogram MODE (robust to
 *      furniture/rug contamination): FLOOR from the bottom band, WALL from the
 *      upper-middle band.
 *   4. Classify the floor family (wood/laminate → wood, marble, tile, concrete)
 *      from Lab lightness / chroma / hue + a texture (L-variance) statistic, and
 *      snap it to the nearest FLOOR_TEXTURES id within that family by ΔE.
 *   5. Aggregate across a listing's photos (weighted vote for family, weighted
 *      Lab median for wall) → per-field confidence. The runtime loader gates on
 *      confidence; low-confidence / missing fields fall back to the template.
 *
 * Usage:
 *   node scripts/infer-listing-scene.mjs            # classical, writes src/data/inferredScenes.json
 *   node scripts/infer-listing-scene.mjs --vlm      # + furniture labels IF Ollama is reachable
 *   node scripts/infer-listing-scene.mjs --only 4550979941893386,4550951808562866
 *   node scripts/infer-listing-scene.mjs --out /tmp/scenes.json --long-side 160
 *
 * Everything is an AI APPROXIMATION from photos — finishes are inferred, not
 * verified. Geometry stays metadata-driven (VLMs give labels, not dimensions).
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, extname } from 'node:path'
import { spawnSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'
import { resolveChrome, CHROME_FLAGS } from './lib/chrome.mjs'
import { FLOOR_TEXTURES } from './lib/floor-catalog.mjs'
import { rgbToLab, labToRgb, deltaE, hexToRgb, rgbToHex, whiteBalanceLinear, bandLab, stdOfL, classifyFloorGroup, dominantColor } from './lib/finish-infer.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, '..')

// ─────────────────────────────── CLI ───────────────────────────────
function parseArgs(argv) {
  const a = { vlm: false, only: null, longSide: 140, out: join(REPO, 'src/data/inferredScenes.json'),
    imagesDir: join(REPO, 'public/images'), listings: join(REPO, 'public/listings.json'), chrome: null }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === '--vlm') a.vlm = true
    else if (t === '--only') a.only = new Set(argv[++i].split(',').map((s) => s.trim()).filter(Boolean))
    else if (t === '--long-side') a.longSide = Math.max(48, Math.min(400, Number(argv[++i]) || 140))
    else if (t === '--out') a.out = resolve(argv[++i])
    else if (t === '--images-dir') a.imagesDir = resolve(argv[++i])
    else if (t === '--listings') a.listings = resolve(argv[++i])
    else if (t === '--chrome') a.chrome = argv[++i]
  }
  return a
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp'])

// Confidence floor for the SCRIPT to keep a field at all (clearly-garbage reads
// are dropped here; the runtime loader applies the stricter gate — see
// INFERENCE_CONFIDENCE_MIN in src/data/inferredScenes.ts).
const EMIT_MIN = 0.3

// ───────────────────── headless-Chrome JPEG decode ─────────────────────
/** Decode + downscale an image file to a small RGBA grid using a canvas in the
 *  page. Returns { w, h, data:Uint8ClampedArray-like Array } or null on failure. */
async function decodeDownscaled(page, absPath, longSide) {
  const ext = extname(absPath).toLowerCase().replace('.', '') || 'jpeg'
  const b64 = readFileSync(absPath).toString('base64')
  const dataUrl = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${b64}`
  return page.evaluate(
    async (url, target) => {
      const img = new Image()
      img.decoding = 'sync'
      const ok = await new Promise((res) => {
        img.onload = () => res(true)
        img.onerror = () => res(false)
        img.src = url
      })
      if (!ok || !img.naturalWidth) return null
      const scale = target / Math.max(img.naturalWidth, img.naturalHeight)
      const w = Math.max(1, Math.round(img.naturalWidth * Math.min(1, scale)))
      const h = Math.max(1, Math.round(img.naturalHeight * Math.min(1, scale)))
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0, w, h)
      const { data } = ctx.getImageData(0, 0, w, h)
      return { w, h, data: Array.from(data) }
    },
    dataUrl,
    longSide,
  )
}

// ───────────────────── per-image classical analysis ─────────────────────
const clamp01 = (x) => Math.max(0, Math.min(1, x))
/** Hermite smoothstep from 0 at `a` to 1 at `b`. */
function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Analyse one decoded image → per-image floor + wall reads (or null bits). */
function analyzeImage(decoded) {
  const { w, h, data } = decoded
  const { lin } = whiteBalanceLinear(data, w, h)

  // FLOOR: lower band, lifted off the extreme foreground (portrait phone shots
  // pack close-up clutter — a mattress edge, a poster — into the very bottom).
  // Keep wood's real chroma but reject deep shadow/black objects and the most-
  // saturated pixels (bright rugs/blankets); the largest surviving bin is the
  // floor when floor area > any single object.
  const floorLab = bandLab(lin, w, h, 0.55, 0.95, 0.06, 0.94)
  const floorDom = dominantColor(floorLab, { rejectDarkL: 26, rejectBrightL: 97, maxChroma: 38 })
  // WALL: upper-middle band. Walls are the bright, low-chroma majority up there;
  // reject dark furniture (high dark floor) and saturated art/objects.
  const wallLab = bandLab(lin, w, h, 0.12, 0.5, 0.05, 0.95)
  const wallDom = dominantColor(wallLab, { rejectDarkL: 42, rejectBrightL: 99, maxChroma: 20 })

  const floor = floorDom
    ? (() => {
        const cls = classifyFloorGroup(floorDom.lab)
        let confidence = cls.decisiveness * floorDom.coverage
        // A near-neutral DARK read at floor level is more likely shadow/furniture
        // than the floor material (Indian flats skew light tile/marble); after
        // exposure-normalisation a dim stone read under-reports albedo, so trust
        // it less. Wood is exempt (espresso/walnut are legitimately dark).
        if (cls.group === 'stone') confidence *= 0.45 + 0.55 * smoothstep(30, 60, floorDom.lab[0])
        return {
          group: cls.group,
          lab: floorDom.lab,
          hex: rgbToHex(...labToRgb(floorDom.lab)),
          confidence: clamp01(confidence),
          coverage: Number(floorDom.coverage.toFixed(2)),
          textureStd: Number(stdOfL(floorLab).toFixed(2)),
        }
      })()
    : null

  const wall = wallDom
    ? { lab: wallDom.lab, hex: rgbToHex(...labToRgb(wallDom.lab)), confidence: clamp01(wallDom.coverage) }
    : null

  return { floor, wall, dims: { w, h } }
}

// ───────────────────── per-listing aggregation ─────────────────────
function aggregateListing(perImage) {
  // FLOOR group (wood vs stone) — weighted vote by per-image confidence.
  const grpWeight = new Map()
  const grpLabs = new Map()
  let totalW = 0
  for (const im of perImage) {
    if (!im.floor) continue
    const g = im.floor.group
    grpWeight.set(g, (grpWeight.get(g) || 0) + im.floor.confidence)
    if (!grpLabs.has(g)) grpLabs.set(g, [])
    grpLabs.get(g).push({ lab: im.floor.lab, wsum: im.floor.confidence })
    totalW += im.floor.confidence
  }
  let floor = null
  if (totalW > 0) {
    let bestGrp = null, bestW = -1
    for (const [g, wt] of grpWeight) if (wt > bestW) { bestW = wt; bestGrp = g }
    const winners = grpLabs.get(bestGrp)
    const medLab = weightedLabMedian(winners)
    const meanConf = bestW / winners.length
    const agreement = bestW / totalW
    const confidence = clamp01(agreement * (0.55 + 0.45 * meanConf))
    const snap = snapFloor(bestGrp, medLab) // nearest texture within the group by colour
    floor = { family: snap.family, textureId: snap.id, group: bestGrp, baseHex: rgbToHex(...labToRgb(medLab)),
      snapDeltaE: Number(snap.dE.toFixed(1)), confidence: Number(confidence.toFixed(3)), photos: winners.length }
  }

  // WALL — weighted Lab mean + cross-photo consistency.
  const walls = perImage.filter((im) => im.wall && im.wall.confidence > 0.18).map((im) => ({ lab: im.wall.lab, wsum: im.wall.confidence }))
  let wall = null
  if (walls.length) {
    const meanLab = weightedLabMean(walls)
    let spread = 0
    for (const wl of walls) spread += deltaE(wl.lab, meanLab)
    spread /= walls.length
    const consistency = clamp01(1 - spread / 26)
    const meanConf = walls.reduce((s, x) => s + x.wsum, 0) / walls.length
    const confidence = clamp01(meanConf * (0.5 + 0.5 * consistency))
    wall = { hex: rgbToHex(...labToRgb(meanLab)), confidence: Number(confidence.toFixed(3)),
      consistency: Number(consistency.toFixed(2)), photos: walls.length }
  }
  return { floor, wall }
}

function weightedLabMean(items) {
  let L = 0, A = 0, B = 0, W = 0
  for (const it of items) { const w = it.wsum || 1; L += it.lab[0] * w; A += it.lab[1] * w; B += it.lab[2] * w; W += w }
  return [L / W, A / W, B / W]
}
// "Median" via the item nearest the weighted mean (robust, deterministic).
function weightedLabMedian(items) {
  const mean = weightedLabMean(items)
  let best = items[0].lab, bestD = Infinity
  for (const it of items) { const d = deltaE(it.lab, mean); if (d < bestD) { bestD = d; best = it.lab } }
  return best
}

// ───────────────────── floor group → texture snapping ─────────────────────
const FLOOR_BY_ID = Object.fromEntries(FLOOR_TEXTURES.map((f) => [f.id, f]))
// Real, floor-appropriate texture ids per group (excludes wall/ceiling/deck-only
// specialties). Within a group the exact texture is chosen by nearest colour.
const GROUP_CANDIDATES = {
  wood: ['natural-oak', 'light-oak', 'grey-wood', 'walnut', 'cherry', 'espresso', 'honey', 'ash', 'chevron'],
  stone: ['white-tile', 'grey-tile', 'sand-tile', 'slate-tile', 'check-tile', 'marble-tile', 'glossy-marble',
    'ivory-marble', 'blue-tile', 'terracotta-tile', 'light-concrete', 'mid-concrete', 'dark-concrete'],
}
/** Fine family label for a texture (for provenance / disclosure). */
function familyOfTexture(tex) {
  return tex.surface === 'marble' ? 'marble' : tex.kind // 'wood' | 'tile' | 'concrete' | 'marble'
}
function snapFloor(group, lab) {
  const ids = GROUP_CANDIDATES[group] || GROUP_CANDIDATES.stone
  let best = ids[0], bestD = Infinity
  for (const id of ids) {
    const t = FLOOR_BY_ID[id]
    const [r, g, b] = hexToRgb(t.base)
    const d = deltaE(lab, rgbToLab(r, g, b))
    if (d < bestD) { bestD = d; best = id }
  }
  return { id: best, dE: bestD, family: familyOfTexture(FLOOR_BY_ID[best]) }
}

// ───────────────────── OPTIONAL VLM furniture tier ─────────────────────
async function probeOllama() {
  const host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 1200)
    const res = await fetch(`${host.replace(/\/$/, '')}/api/tags`, { signal: ctl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const j = await res.json()
    return (j.models || []).map((m) => m.model || m.name).filter(Boolean)
  } catch {
    return null
  }
}
/** Best-effort furniture labels for a listing via the Agent-B detection pipeline.
 *  Any failure (no python, no deps, no model) → [] — never throws, never gates. */
function vlmFurnitureForImages(absImages) {
  const py = join(REPO, 'detection-pipeline', 'pipeline.py')
  if (!existsSync(py)) return []
  const votes = new Map()
  for (const img of absImages) {
    try {
      const r = spawnSync('python3', [py, img], { cwd: join(REPO, 'detection-pipeline'), encoding: 'utf-8', timeout: 60000 })
      if (r.status !== 0 || !r.stdout) continue
      const jsonStart = r.stdout.indexOf('{')
      if (jsonStart < 0) continue
      const doc = JSON.parse(r.stdout.slice(jsonStart, r.stdout.lastIndexOf('}') + 1))
      for (const p of doc.proposals || []) {
        const a = p.archetype || p.archetype_hint
        if (!a || a === 'none') continue
        const prev = votes.get(a) || { count: 0, conf: 0 }
        votes.set(a, { count: prev.count + 1, conf: Math.max(prev.conf, p.confidence ?? 0.5) })
      }
    } catch {
      /* degrade */
    }
  }
  return [...votes.entries()]
    .map(([archetype, v]) => ({ archetype, confidence: Number(clamp01(v.conf * Math.min(1, 0.5 + v.count * 0.25)).toFixed(2)) }))
    .sort((x, y) => y.confidence - x.confidence)
    .slice(0, 8)
}

// ─────────────────────────────── main ───────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const validIds = new Set()
  try {
    const doc = JSON.parse(readFileSync(args.listings, 'utf-8'))
    for (const l of doc.listings || []) validIds.add(l.id)
  } catch {
    /* no listings.json → accept whatever dirs exist */
  }

  const dirs = existsSync(args.imagesDir)
    ? readdirSync(args.imagesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : []
  const targets = dirs
    .filter((id) => (validIds.size ? validIds.has(id) : true))
    .filter((id) => (args.only ? args.only.has(id) : true))
    .sort()

  // VLM availability probe (gated behind --vlm; degrades to classical-only).
  let vlmModels = null
  if (args.vlm) {
    vlmModels = await probeOllama()
    console.log(vlmModels?.length
      ? `  VLM tier: Ollama reachable, models=[${vlmModels.join(', ')}] — enriching furniture labels`
      : '  VLM tier: requested but Ollama not reachable — classical-only (graceful)')
  } else {
    console.log('  VLM tier: OFF (pass --vlm to enable furniture labels via detection-pipeline)')
  }
  const useVlm = args.vlm && !!vlmModels?.length

  const browser = await puppeteer.launch({ executablePath: args.chrome || resolveChrome(), headless: 'new', args: CHROME_FLAGS })
  const page = await browser.newPage()

  const listings = {}
  const summary = []
  try {
    for (const id of targets) {
      const dir = join(args.imagesDir, id)
      const files = readdirSync(dir).filter((f) => IMAGE_EXT.has(extname(f).toLowerCase())).sort()
      const perImage = []
      const absImages = []
      for (const f of files) {
        const abs = join(dir, f)
        const decoded = await decodeDownscaled(page, abs, args.longSide)
        if (!decoded) { console.log(`    ! ${id}/${f}: decode failed, skipping`); continue }
        absImages.push(abs)
        perImage.push({ file: f, ...analyzeImage(decoded) })
      }
      if (!perImage.length) { console.log(`    ! ${id}: no decodable photos`); continue }

      const agg = aggregateListing(perImage)
      const record = {
        id,
        photoCount: perImage.length,
        source: useVlm ? 'classical+vlm' : 'classical',
      }
      if (agg.floor && agg.floor.confidence >= EMIT_MIN) record.floor = agg.floor
      if (agg.wall && agg.wall.confidence >= EMIT_MIN) record.wall = agg.wall
      record.furniture = useVlm ? vlmFurnitureForImages(absImages) : []
      // Compact per-photo provenance (what each photo voted for) — no pixels.
      record.perPhoto = perImage.map((im) => ({
        file: im.file,
        floorGroup: im.floor?.group ?? null,
        floorHex: im.floor?.hex ?? null,
        wallHex: im.wall?.hex ?? null,
      }))
      listings[id] = record
      summary.push({ id, floor: agg.floor, wall: agg.wall, photos: perImage.length })
      const ff = agg.floor ? `${agg.floor.family}→${agg.floor.textureId} (${agg.floor.confidence})` : 'none'
      const ww = agg.wall ? `${agg.wall.hex} (${agg.wall.confidence})` : 'none'
      console.log(`    ✓ ${id}  floor=${ff}  wall=${ww}  photos=${perImage.length}`)
    }
  } finally {
    await browser.close()
  }

  const out = {
    version: 1,
    kind: 'roomio.inferred-scenes',
    generatedAt: new Date().toISOString().slice(0, 10), // date-only → stable diffs
    generator: 'scripts/infer-listing-scene.mjs',
    method: 'classical-cv: downscale + gray-world white-balance (linear) + Lab-histogram region dominant color + heuristic floor-family + nearest-texture snap',
    disclaimer: 'AI APPROXIMATION from listing photos — finishes are inferred, not verified. Geometry stays metadata-driven (VLMs give labels, not dimensions).',
    confidenceMin: 0.5, // runtime loader (src/data/inferredScenes.ts) gates fields at this confidence
    vlm: useVlm ? { enabled: true, models: vlmModels } : { enabled: false },
    listings,
  }
  mkdirSync(dirname(args.out), { recursive: true })
  writeFileSync(args.out, JSON.stringify(out, null, 2) + '\n')
  console.log(`\n  wrote ${args.out}  (${Object.keys(listings).length}/${targets.length} listings)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
