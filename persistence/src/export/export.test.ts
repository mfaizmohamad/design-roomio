import { describe, it, expect } from 'vitest'
import { buildShoppingList, shoppingListToCSV, shoppingListToText, totalItems } from './shoppingList'
import { pdfFromJpeg } from './pdf'
import type { House, FurnitureItem } from '../scene/slices'

function fi(archetype: string, name: string, color: string, w: number, d: number, h: number): FurnitureItem {
  return { id: Math.random().toString(36).slice(2), archetype, category: archetype.split('-')[0], name, x: 0, z: 0, rotation: 0, w, d, h, color }
}

function houseWith(furnitureByRoom: { name: string; items: FurnitureItem[] }[]): House {
  return {
    schema_version: '1.0',
    house_id: 'h',
    name: 'Home',
    rooms: furnitureByRoom.map((r, i) => ({
      room_id: `r${i}`,
      type: 'living' as const,
      footprint: { shape: 'rectangular' as const, x: 0, z: 0, rotation: 0, w: 400, l: 400 },
      interior: {
        id: `r${i}`, name: r.name, unit: 'cm', shape: 'rect',
        corners: [{ x: 0, z: 0 }, { x: 400, z: 0 }, { x: 400, z: 400 }, { x: 0, z: 400 }],
        wallHeight: 270, wallThickness: 12, openings: [],
        materials: { wallColor: '#fff', floorTexture: 'oak' }, furniture: r.items, createdAt: 1, updatedAt: 1,
      },
    })),
    connectors: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('shopping list', () => {
  it('aggregates identical items by type+colour+size with counts and rooms', () => {
    const sofa = () => fi('sofa-3', '3-Seater Sofa', '#5b6b73', 220, 95, 85)
    const chair = () => fi('chair-dining', 'Dining Chair', '#222222', 45, 50, 90)
    const house = houseWith([
      { name: 'Living', items: [sofa(), sofa(), chair()] },
      { name: 'Dining', items: [chair(), chair()] },
    ])
    const rows = buildShoppingList(house)
    const sofaRow = rows.find((r) => r.archetype === 'sofa-3')!
    const chairRow = rows.find((r) => r.archetype === 'chair-dining')!
    expect(sofaRow.qty).toBe(2)
    expect(sofaRow.rooms).toEqual(['Living'])
    expect(chairRow.qty).toBe(3)
    expect(chairRow.rooms.sort()).toEqual(['Dining', 'Living'])
    expect(totalItems(rows)).toBe(5)
  })

  it('keeps differently-coloured same-archetype items as separate rows', () => {
    const house = houseWith([
      { name: 'A', items: [fi('chair-arm', 'Armchair', '#aa0000', 70, 70, 80), fi('chair-arm', 'Armchair', '#0000aa', 70, 70, 80)] },
    ])
    const rows = buildShoppingList(house)
    expect(rows.filter((r) => r.archetype === 'chair-arm')).toHaveLength(2)
  })

  it('CSV has a header + escapes commas; text lists quantities', () => {
    const house = houseWith([{ name: 'Den, cozy', items: [fi('table-coffee', 'Coffee, Table', '#6b5b4a', 110, 60, 40)] }])
    const rows = buildShoppingList(house)
    const csv = shoppingListToCSV(rows)
    expect(csv.split('\r\n')[0]).toContain('Item,Category,Color')
    expect(csv).toContain('"Coffee, Table"') // comma-bearing field quoted
    expect(csv).toContain('"Den, cozy"')
    const text = shoppingListToText(rows)
    expect(text).toContain('1× Coffee, Table')
    expect(text).toContain('Total: 1 item')
  })

  it('neutralizes CSV formula injection in user-controlled fields', () => {
    const house = houseWith([
      { name: '=cmd', items: [fi('misc-box', '=HYPERLINK("http://evil")', '+evil', 10, 10, 10), fi('chair-arm', '@SUM(A1)', '#fff', 10, 10, 10)] },
    ])
    const csv = shoppingListToCSV(buildShoppingList(house))
    // a leading =, +, @ must be prefixed with ' so it isn't evaluated as a formula
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m)
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).toContain("'@SUM(A1)")
    expect(csv).toContain("'+evil")
    expect(csv).toContain("'=cmd") // room name too
  })
})

describe('PDF writer (JPEG embed)', () => {
  // a tiny valid-enough JPEG byte sequence (header markers); structure test only
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9])

  it('produces a structurally valid single-page PDF embedding the image', () => {
    const pdf = pdfFromJpeg(fakeJpeg, 800, 600, { title: 'My Room — Floor plan', subtitle: '2 rooms' })
    const text = new TextDecoder('latin1').decode(pdf)
    expect(text.startsWith('%PDF-1.')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(text).toContain('/Type /Catalog')
    expect(text).toContain('/Filter /DCTDecode')
    expect(text).toContain('/Subtype /Image')
    // em-dash is ASCII-folded to '-' so Helvetica renders it
    expect(text).toContain('(My Room - Floor plan) Tj')
    expect(text).toContain('xref')
    expect(text).toContain('/Size 7')
    // the JPEG bytes are embedded verbatim
    expect(text).toContain(`/Length ${fakeJpeg.length} >>\nstream\n`)
  })

  it('xref offsets point at real "N 0 obj" markers', () => {
    const pdf = pdfFromJpeg(fakeJpeg, 100, 100, { title: 'T' })
    const text = new TextDecoder('latin1').decode(pdf)
    // xref body: "xref\n0 7\n", then the free entry, then 6 object entries.
    const xrefStart = text.indexOf('xref\n')
    const lines = text.slice(xrefStart).split('\n').slice(3, 9) // skip 'xref','0 7',free
    expect(lines).toHaveLength(6)
    lines.forEach((line, i) => {
      const off = parseInt(line.slice(0, 10), 10)
      expect(text.startsWith(`${i + 1} 0 obj`, off)).toBe(true)
    })
  })
})
