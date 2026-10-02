/**
 * FLOOR_TEXTURES for the offline inference script, PARSED from the single source
 * of truth (src/data/materials.ts) so the script's floor-snapping stays in sync
 * with the app's real texture ids/base colours — no duplicated hex table to
 * drift. (A plain .mjs can't import the .ts module without a build step, so we
 * extract the object literals with a tolerant regex. Guarded by
 * scripts/lib/floor-catalog.test.mjs.)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MATERIALS_TS = resolve(__dirname, '../../src/data/materials.ts')

function field(entry, name) {
  const m = entry.match(new RegExp(`${name}:\\s*'([^']*)'`))
  return m ? m[1] : null
}

/** Parse the FLOOR_TEXTURES array literal from materials.ts. */
export function loadFloorTextures(src = readFileSync(MATERIALS_TS, 'utf-8')) {
  const start = src.indexOf('export const FLOOR_TEXTURES')
  if (start < 0) throw new Error('FLOOR_TEXTURES not found in materials.ts')
  const open = src.indexOf('[', start)
  const close = src.indexOf('\n]', open)
  const body = src.slice(open + 1, close)
  const out = []
  // Each texture is a single-line `{ id: '…', … , base: '#…', kind: '…', surface: '…' }` entry.
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('{') || !t.includes('id:')) continue
    const id = field(t, 'id')
    const base = field(t, 'base')
    if (!id || !base) continue
    out.push({ id, base, accent: field(t, 'accent'), kind: field(t, 'kind'), surface: field(t, 'surface') })
  }
  return out
}

export const FLOOR_TEXTURES = loadFloorTextures()
