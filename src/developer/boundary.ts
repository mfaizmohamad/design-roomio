const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
const id = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)
const label = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export type Organization = { id: string; name: string; role: 'owner' | 'admin' | 'editor' | 'publisher' | 'sales' }
export type Named = { id: string; name: string }
export type Unit = { id: string; label: string; unitTypeId: string }
export type Home = { id: string; name: string; unitTypeId: string; revision: number; updatedAt: number }
export type PersonalDesign = { id: string; name: string; isWholeHome: boolean }
export type Asset = { id: string; name: string; brand: string | null; sku: string | null }
export type Version = { id: string; status: 'reserved' | 'draft' | 'approved'; sha256: string | null; measuredWidthCm: number; measuredDepthCm: number; measuredHeightCm: number; approvedAt: string | null }
export type Release = { id: string; homeId: string; state: 'published' | 'retired'; createdAt: string }

/** Parse an API collection. Invalid shape throws; an empty array means an actual empty collection. */
export function collection<T>(value: unknown, parse: (value: unknown) => T | null): T[] {
  if (!Array.isArray(value)) throw new Error('The server returned an invalid collection')
  const parsed = value.map(parse)
  if (parsed.some((item) => item === null)) throw new Error('The server returned invalid workspace data')
  return parsed as T[]
}

/** Parse a tenant and current role; null means this row cannot be trusted. */
export function organization(value: unknown): Organization | null {
  const row = record(value)
  if (!row || !id(row.id) || !label(row.name) ||
      typeof row.role !== 'string' ||
      !['owner', 'admin', 'editor', 'publisher', 'sales'].includes(row.role)) return null
  return { id: row.id, name: row.name, role: row.role as Organization['role'] }
}

/** Parse project/unit type identity; null means the row is malformed. */
export function named(value: unknown): Named | null {
  const row = record(value)
  return row && id(row.id) && label(row.name) ? { id: row.id, name: row.name } : null
}

/** Parse a unit and its parent; null means the row is malformed. */
export function unit(value: unknown): Unit | null {
  const row = record(value)
  return row && id(row.id) && id(row.unitTypeId) && label(row.label)
    ? { id: row.id, unitTypeId: row.unitTypeId, label: row.label } : null
}

/** Parse a project home summary; null means its revision cannot safely be displayed. */
export function home(value: unknown): Home | null {
  const row = record(value)
  return row && id(row.id) && id(row.unitTypeId) && label(row.name) &&
    typeof row.revision === 'number' && Number.isSafeInteger(row.revision) && row.revision > 0 &&
    typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt)
    ? { id: row.id, unitTypeId: row.unitTypeId, name: row.name,
      revision: row.revision, updatedAt: row.updatedAt } : null
}

/** Parse a personal design summary; it becomes importable only after full design validation. */
export function personalDesign(value: unknown): PersonalDesign | null {
  const row = record(value)
  return row && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 256 && label(row.name)
    ? { id: row.id, name: row.name, isWholeHome: false } : null
}

/** Parse private asset identity; null means the row is malformed. */
export function asset(value: unknown): Asset | null {
  const row = record(value)
  return row && id(row.id) && label(row.name) &&
    (row.brand == null || typeof row.brand === 'string') &&
    (row.sku == null || typeof row.sku === 'string')
    ? { id: row.id, name: row.name, brand: typeof row.brand === 'string' ? row.brand : null,
      sku: typeof row.sku === 'string' ? row.sku : null } : null
}

/** Parse private asset status; null means the status must not be trusted. */
export function version(value: unknown): Version | null {
  const row = record(value)
  return row && id(row.id) && typeof row.status === 'string' &&
    ['reserved', 'draft', 'approved'].includes(row.status) &&
    (row.sha256 === null || typeof row.sha256 === 'string') &&
    [row.measuredWidthCm, row.measuredDepthCm, row.measuredHeightCm].every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0) &&
    (row.approvedAt === null || typeof row.approvedAt === 'string')
    ? { id: row.id, status: row.status as Version['status'], sha256: row.sha256 as string | null,
      measuredWidthCm: row.measuredWidthCm as number, measuredDepthCm: row.measuredDepthCm as number,
      measuredHeightCm: row.measuredHeightCm as number, approvedAt: row.approvedAt as string | null } : null
}

/** Parse staff-only release state; null means no public link may be shown. */
export function release(value: unknown): Release | null {
  const row = record(value)
  return row && id(row.id) && id(row.homeId) && typeof row.state === 'string' &&
    ['published', 'retired'].includes(row.state) &&
    typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt))
    ? { id: row.id, homeId: row.homeId, state: row.state as Release['state'], createdAt: row.createdAt } : null
}

/** Validate a full personal design before offering explicit project import. */
export function isWholeHomeDesign(value: unknown): boolean {
  const row = record(value)
  const house = record(row?.house)
  return Array.isArray(house?.levels) && house.levels.length > 0 &&
    Array.isArray(house.rooms) && house.rooms.length > 0
}
