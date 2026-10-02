import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadFloorTextures, FLOOR_TEXTURES } from './floor-catalog.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MATERIALS = resolve(__dirname, '../../src/data/materials.ts')

describe('floor-catalog — parsed from materials.ts (single source of truth)', () => {
  it('parses a plausible number of floor textures', () => {
    expect(FLOOR_TEXTURES.length).toBeGreaterThan(15)
  })
  it('every entry has a real id + a well-formed base hex', () => {
    for (const t of FLOOR_TEXTURES) {
      expect(t.id).toBeTruthy()
      expect(t.base).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })
  it('stays in sync with the ids/base colours in materials.ts', () => {
    const src = readFileSync(MATERIALS, 'utf-8')
    for (const [id, base] of [['natural-oak', '#c79a62'], ['marble-tile', '#ebe9e6'], ['blue-tile', '#3f7fb0'], ['dark-concrete', '#6d6c69']]) {
      const t = FLOOR_TEXTURES.find((x) => x.id === id)
      expect(t, `${id} present`).toBeTruthy()
      expect(t.base).toBe(base)
      // and the id genuinely appears in the source file
      expect(src).toContain(`id: '${id}'`)
    }
  })
  it('is pure (re-parsing the same source is stable)', () => {
    const a = loadFloorTextures()
    const b = loadFloorTextures()
    expect(a).toEqual(b)
  })
})
