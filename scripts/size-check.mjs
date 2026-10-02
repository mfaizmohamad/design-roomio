// Bundle-size budget (CLAUDE.md §8, bead roomio-zhs.7).
//
// THE BUG THIS PREVENTS: the 3D engine is only affordable because it is behind
// `React.lazy` (see src/App.tsx) and a hand-tuned `manualChunks` (see the long
// comment in vite.config.ts). One stray *static* `import ... from 'three'` in an
// eagerly-reachable module — or losing the React.lazy boundary — makes the entry
// statically import three-core, and first load goes from ~99 KB gzip to ~400 KB+.
// `tsc`, `vitest` and `vite build` all stay green when that happens: the build
// still succeeds and NO INDIVIDUAL CHUNK CHANGES SIZE. Only the *shape* of the
// eager graph changes. That is why a per-chunk cap alone is not enough, and why
// the first check below walks the entry's static-import closure.
//
// Gate is on GZIPPED bytes: that is what the user actually downloads.
//
// Run: npm run check:size   (after `npm run build`)
//      node scripts/size-check.mjs dist-demo   (after `npm run build:demo`)

import { gzipSync } from 'node:zlib'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve as resolvePath, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
// Optional first arg picks the build to gate: `dist` (the app, default) or
// `dist-demo` (the public demo, see vite.demo.config.ts). Same budgets for both:
// the demo is a subset of the app, so it can only be smaller.
const DIST = join(ROOT, process.argv[2] ?? 'dist')
const KB = 1024

// ---------------------------------------------------------------------------
// Budgets, in KB of GZIPPED output.
//
// Measured by this script on the tree that introduced it (`npm run build`, vite
// 5.4.21). These are gzip level 9, so they read ~2-3% under the numbers vite's
// own build summary prints — compare against THIS script's output, not vite's.
//
//   eager (index.html entry + its modulepreloads):
//     index-*.js        47.9 KB gzip   (entry: app shell, wizard-less)
//     react-vendor-*.js 48.2 KB gzip   (react/react-dom/zustand — shared, pinned eager)
//     ------------------------------------------
//     total             96.2 KB gzip
//
//   largest single chunk:
//     index-*.js (lazy) 306.7 KB gzip  (1,078 KB raw)
//     three-core-*.js   304.5 KB gzip  (1,037 KB raw)
//
//   all JS, eager + lazy: 966.4 KB gzip
//     (the "~600 KB gzipped first meaningful load" in CLAUDE.md §8 is the wizard
//      path — eager + Wizard + r3f + three-core = ~620 KB — a subset of this.)
//
// Headroom is deliberately ASYMMETRIC:
//   - EAGER is tight (~20%). Its whole job is to trip on an un-split, and an
//     un-split adds 300+ KB, so a tight cap costs nothing and catches creep too.
//   - PER-CHUNK and TOTAL are looser (~8-11%), because a dependency patch bump
//     legitimately moves them by a few KB and a red CI on an unrelated PR is how
//     budgets get deleted.
// Raising a number here is a decision, not a fix: say why in the commit message.
const BUDGET_KB = {
  eagerJs: 120,
  chunk: 340,
  totalJs: 1100,
}

// Fingerprint for "three.js itself is in this file". Chosen over a chunk-NAME
// check (`three-core`) because names come from vite.config.ts and a rename would
// silently disable the check; this string comes from three's own renderer and
// survives minification. Verified present in three-core-*.js and absent from
// every other chunk on the tree that added this file.
const THREE_FINGERPRINT = 'WebGLRenderer'

const fmt = (bytes) => `${(bytes / KB).toFixed(1)} KB`
const gzipOf = (file) => gzipSync(readFileSync(file), { level: 9 }).length

/**
 * Static-import specifiers of a built ESM chunk.
 *
 * Matches `from"./x.js"`, bare side-effect `import"./x.js"` and `export …
 * from"./x.js"`, and deliberately NOT `import("./x.js")` — a dynamic import is
 * exactly the thing that keeps a chunk off the first load, so counting it would
 * defeat the check. The negative lookbehind on `(` is what separates the two.
 */
const staticImportsOf = (file) => {
  const src = readFileSync(file, 'utf8')
  const out = new Set()
  for (const m of src.matchAll(/(?:\bfrom|(?<![\w$)\].])\bimport)\s*["']([^"']+)["']/g)) {
    if (m[1].startsWith('.')) out.add(m[1])
  }
  return [...out]
}

/**
 * The first-load set: the entry script from index.html plus everything reachable
 * from it through STATIC imports only.
 *
 * Seeded from index.html (entry `<script type="module">` + `<link
 * rel="modulepreload">`, which vite emits for precisely this closure) and then
 * walked again through the chunk sources, so the check still holds if
 * `build.modulePreload` is ever turned off and the preload hints disappear.
 */
const eagerSet = () => {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8')
  const seeds = [
    ...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g),
    ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g),
  ].map((m) => m[1])
  if (seeds.length === 0) throw new Error('dist/index.html has no module entry — did the build run?')

  const seen = new Set()
  const queue = seeds.map((s) => join(DIST, s.replace(/^\//, '')))
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file) || !existsSync(file)) continue
    seen.add(file)
    for (const spec of staticImportsOf(file)) queue.push(resolvePath(dirname(file), spec))
  }
  return seen
}

const main = () => {
  if (!existsSync(DIST)) {
    console.error('✗ no dist/ — run `npm run build` first')
    process.exit(1)
  }

  const assets = join(DIST, 'assets')
  const jsFiles = readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .map((f) => join(assets, f))
  const eager = eagerSet()
  const fails = []

  // 1. First load. The un-split guard.
  const eagerJs = [...eager].filter((f) => f.endsWith('.js'))
  const eagerBytes = eagerJs.reduce((n, f) => n + gzipOf(f), 0)
  console.log('first load (entry + static imports):')
  for (const f of eagerJs.sort()) console.log(`  ${relative(DIST, f).padEnd(38)} ${fmt(gzipOf(f)).padStart(10)} gzip`)
  console.log(`  ${'TOTAL'.padEnd(38)} ${fmt(eagerBytes).padStart(10)} gzip   budget ${BUDGET_KB.eagerJs} KB\n`)
  if (eagerBytes > BUDGET_KB.eagerJs * KB) {
    fails.push(`first-load JS ${fmt(eagerBytes)} gzip > ${BUDGET_KB.eagerJs} KB budget`)
  }

  // 2. The engine must not be on the first load AT ALL — independent of size, so
  //    this still fires if someone raises the budget above instead of fixing it.
  for (const f of eagerJs) {
    if (readFileSync(f, 'utf8').includes(THREE_FINGERPRINT)) {
      fails.push(
        `three.js is in the EAGER chunk ${relative(DIST, f)} — the lazy 3D split is broken. ` +
          'Something reachable from src/main.tsx now statically imports three (directly, or via an ' +
          'island / @react-three package). Keep the engine behind React.lazy / dynamic import (CLAUDE.md §8).',
      )
    }
  }

  // 3. Per-chunk cap and total payload.
  console.log('all chunks:')
  let totalBytes = 0
  for (const f of jsFiles.sort()) {
    const gz = gzipOf(f)
    totalBytes += gz
    const tag = eager.has(f) ? 'eager' : 'lazy'
    console.log(`  ${relative(DIST, f).padEnd(38)} ${fmt(gz).padStart(10)} gzip  ${tag}`)
    if (gz > BUDGET_KB.chunk * KB) fails.push(`chunk ${relative(DIST, f)} ${fmt(gz)} gzip > ${BUDGET_KB.chunk} KB budget`)
  }
  console.log(`  ${'TOTAL'.padEnd(38)} ${fmt(totalBytes).padStart(10)} gzip   budget ${BUDGET_KB.totalJs} KB\n`)
  if (totalBytes > BUDGET_KB.totalJs * KB) {
    fails.push(`total JS ${fmt(totalBytes)} gzip > ${BUDGET_KB.totalJs} KB budget`)
  }

  if (fails.length) {
    for (const f of fails) console.error(`✗ ${f}`)
    console.error(
      '\nIf the growth is intentional, raise the matching number in BUDGET_KB and say why in the commit message.',
    )
    process.exit(1)
  }
  console.log('✓ bundle within budget')
}

main()
