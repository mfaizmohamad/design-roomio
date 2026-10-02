// Fails if the public demo build (dist-demo/) contains a client's name, scraped
// Facebook data, or any of the app's public/ listing files. Rules and the reason
// they exist: scripts/lib/demo-leaks.mjs.
//
// Run: npm run build:demo   (runs this after the vite build)

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beaconProblem, cspProblem, datasetNeedles, findLeaks } from './lib/demo-leaks.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist-demo')
const TEXT_EXT = /\.(html|js|mjs|css|json|txt|svg|map|xml|webmanifest)$|(^|\/)_headers$|(^|\/)_redirects$/

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })

if (!existsSync(DIST)) {
  console.error('✗ no dist-demo/ — run `npm run build:demo` first')
  process.exit(1)
}

// The dataset may be absent on a fresh clone; the name/pattern rules still run.
const datasetPath = join(ROOT, 'public', 'listings.json')
const needles = existsSync(datasetPath) ? datasetNeedles(JSON.parse(readFileSync(datasetPath, 'utf8'))) : []

const files = walk(DIST).map((full) => {
  const path = relative(DIST, full).split(sep).join('/')
  return { path, text: TEXT_EXT.test(path) ? readFileSync(full, 'utf8') : null }
})
const leaks = findLeaks(files, needles)

const csp = cspProblem(files.find((f) => f.path === 'index.html')?.text)
if (csp) leaks.push({ path: 'index.html', rule: 'missing CSP', match: csp })
const beacon = beaconProblem(files.find((f) => f.path === 'index.html')?.text)
if (beacon) leaks.push({ path: 'index.html', rule: 'analytics beacon', match: beacon })

if (leaks.length) {
  for (const l of leaks) console.error(`✗ ${l.path}: ${l.rule} (${l.match})`)
  console.error(
    '\nThe public demo must not ship client names or scraped personal data. Find the import that ' +
      'pulled it in and swap or remove it in vite.demo.config.ts — do not loosen the rule.',
  )
  process.exit(1)
}
console.log(`✓ demo build clean: ${files.length} files, ${needles.length} dataset values checked`)
