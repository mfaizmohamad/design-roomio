/**
 * Furniture shopping list (brief §5) — turns a design into an actionable
 * "what I need to buy": every placed archetype aggregated by type + colour + size
 * with a count and the rooms it appears in. Pure + testable; the UI just downloads
 * the CSV / copies the text.
 */
import type { House } from '../scene/slices'

export interface ShoppingRow {
  name: string
  category: string
  archetype: string
  color: string
  /** cm */
  w: number
  d: number
  h: number
  qty: number
  rooms: string[]
}

const round = (n: number) => Math.round(n)

/** Aggregate identical items (same archetype + colour + size) across all rooms. */
export function buildShoppingList(house: House): ShoppingRow[] {
  const byKey = new Map<string, ShoppingRow>()
  for (const room of house.rooms) {
    const roomName = room.interior.name || room.type
    for (const f of room.interior.furniture) {
      const w = round(f.w)
      const d = round(f.d)
      const h = round(f.h)
      const color = (f.color || '').toLowerCase()
      const key = `${f.archetype}|${color}|${w}x${d}x${h}`
      const existing = byKey.get(key)
      if (existing) {
        existing.qty++
        if (!existing.rooms.includes(roomName)) existing.rooms.push(roomName)
      } else {
        byKey.set(key, {
          name: f.name || f.archetype,
          category: f.category,
          archetype: f.archetype,
          color: f.color || '',
          w,
          d,
          h,
          qty: 1,
          rooms: [roomName],
        })
      }
    }
  }
  // Group by category, then by name, for a readable list.
  return [...byKey.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  )
}

/** Total item count (sum of quantities). */
export function totalItems(rows: ShoppingRow[]): number {
  return rows.reduce((n, r) => n + r.qty, 0)
}

function csvCell(s: string | number): string {
  let str = String(s)
  // Neutralize CSV/formula injection: a cell whose first non-space char is a
  // formula trigger is prefixed with a quote so spreadsheets treat it as text,
  // not a live formula (=HYPERLINK/@SUM/+cmd/-2…). The shopping list is a shared
  // export artifact, so this is a real trust boundary.
  if (/^\s*[=+\-@\t\r]/.test(str)) str = `'${str}`
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

/** CSV with a header row (opens in any spreadsheet). */
export function shoppingListToCSV(rows: ShoppingRow[]): string {
  const header = ['Item', 'Category', 'Color', 'Width (cm)', 'Depth (cm)', 'Height (cm)', 'Qty', 'Rooms']
  const lines = [header.map(csvCell).join(',')]
  for (const r of rows) {
    lines.push(
      [r.name, r.category, r.color, r.w, r.d, r.h, r.qty, r.rooms.join('; ')].map(csvCell).join(','),
    )
  }
  return lines.join('\r\n')
}

/** Plain-text list (for copy-to-clipboard / a quick read). */
export function shoppingListToText(rows: ShoppingRow[], title = 'Shopping list'): string {
  const lines = [title, '='.repeat(title.length), '']
  for (const r of rows) {
    const size = `${r.w}×${r.d}×${r.h} cm`
    const color = r.color ? `, ${r.color}` : ''
    lines.push(`${r.qty}× ${r.name} (${size}${color}) — ${r.rooms.join(', ')}`)
  }
  lines.push('', `Total: ${totalItems(rows)} item${totalItems(rows) === 1 ? '' : 's'}`)
  return lines.join('\n')
}
