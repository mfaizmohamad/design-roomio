import { describe, expect, it } from 'vitest'
import { asset, collection, home, organization, release, version } from './boundary'

const id = '11111111-1111-4111-8111-111111111111'

describe('developer API boundary', () => {
  it('rejects malformed collections instead of turning an API error into an empty workspace', () => {
    expect(() => collection({ error: 'forbidden' }, organization)).toThrow('invalid collection')
    expect(() => collection([{ id, name: 'Studio', role: 'sales' }, { id: 'bad', name: 'Other', role: 'owner' }], organization)).toThrow('invalid workspace data')
    expect(collection([], organization)).toEqual([])
  })

  it('accepts a known role and rejects unknown privileges', () => {
    expect(organization({ id, name: 'Developer', role: 'publisher' })).toEqual({ id, name: 'Developer', role: 'publisher' })
    expect(organization({ id, name: 'Developer', role: 'superuser' })).toBeNull()
  })

  it('requires a real positive revision before a home can appear', () => {
    const row = { id, unitTypeId: id, name: 'Duplex', revision: 2, updatedAt: 123 }
    expect(home(row)?.revision).toBe(2)
    expect(home({ ...row, revision: 0 })).toBeNull()
    expect(home({ ...row, updatedAt: 'yesterday' })).toBeNull()
  })

  it('reads sparse create-asset response and requires trustworthy version status', () => {
    expect(asset({ id, name: 'Chair' })).toEqual({ id, name: 'Chair', brand: null, sku: null })
    const row = { id, status: 'draft', sha256: null, measuredWidthCm: 60,
      measuredDepthCm: 61, measuredHeightCm: 80, approvedAt: null }
    expect(version(row)?.status).toBe('draft')
    expect(version({ ...row, status: 'published' })).toBeNull()
    expect(version({ ...row, measuredWidthCm: '60' })).toBeNull()
  })

  it('shows public links only for server-confirmed release states', () => {
    const row = { id, homeId: id, state: 'published', createdAt: '2026-09-30T09:36:00.000Z' }
    expect(release(row)?.state).toBe('published')
    expect(release({ ...row, state: 'draft' })).toBeNull()
    expect(release({ ...row, createdAt: 'invalid' })).toBeNull()
  })
})
