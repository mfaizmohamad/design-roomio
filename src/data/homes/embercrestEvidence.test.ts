import { describe, expect, it } from 'vitest'
import { EMBERCREST } from './embercrest'
import {
  EMBERCREST_EVIDENCE, publicationEvidenceIssues, validateHomeEvidence,
  type HomeEvidence,
} from './embercrestEvidence'

describe('Embercrest claim provenance', () => {
  it('accounts for every modeled footprint without asserting source approval', () => {
    expect(validateHomeEvidence(EMBERCREST, EMBERCREST_EVIDENCE)).toEqual([])
    const footprints = EMBERCREST_EVIDENCE.claims.filter((claim) => claim.id.startsWith('room-footprint:'))
    expect(footprints).toHaveLength(EMBERCREST.levels.flatMap((level) => level.rooms).length)
    expect(footprints.filter((claim) => claim.basis === 'reported-printed')).toHaveLength(17)
    expect(footprints.filter((claim) => claim.basis === 'inferred').map((claim) => claim.subject))
      .toEqual(['Stair Hall', 'Corridor', 'Upper Corridor'])
    expect(EMBERCREST_EVIDENCE.claims.every((claim) => claim.review.status === 'pending')).toBe(true)
  })

  it('blocks publication while original source versions, rights and review are missing', () => {
    const issues = publicationEvidenceIssues(EMBERCREST, EMBERCREST_EVIDENCE)
    expect(issues).toContain('duplex-pptx: source version, custody or rights unverified')
    expect(issues).toContain('area:marketing-conflict: claim pending or conflicting')
    expect(issues.length).toBeGreaterThan(20)
  })

  it('rejects a changed footprint and an unsupported printed claim', () => {
    const altered: HomeEvidence = {
      ...EMBERCREST_EVIDENCE,
      claims: EMBERCREST_EVIDENCE.claims.map((claim) => claim.id === 'room-footprint:Bedroom 1'
        ? { ...claim, value: '300 × 425 cm', sourceId: undefined }
        : claim),
    }
    expect(validateHomeEvidence(EMBERCREST, altered)).toEqual(expect.arrayContaining([
      'room-footprint:Bedroom 1: reported print lacks source and locator',
      'Bedroom 1: footprint differs from claim',
    ]))
  })

  it('rejects an approval assertion against an unavailable source revision', () => {
    const altered: HomeEvidence = {
      ...EMBERCREST_EVIDENCE,
      claims: EMBERCREST_EVIDENCE.claims.map((claim) => claim.id === 'area:carpet'
        ? { ...claim, review: { status: 'approved', reviewer: 'Reviewer', reviewedAt: '2026-09-29', sourceRevision: 'A', approvalRef: 'signoff' } }
        : claim),
    }
    expect(validateHomeEvidence(EMBERCREST, altered)).toContain('area:carpet: approval lacks reviewed source revision and sign-off')
  })
})
