import type { MultiLevelHome } from './types'

export type EvidenceBasis = 'reported-printed' | 'inferred' | 'illustrative' | 'conflicting'

export interface EvidenceSource {
  id: string
  description: string
  locator: string
  revision: string | null
  custody: 'not-in-workspace' | 'held-and-reviewed'
  rights: 'unverified' | 'documented'
}

export type EvidenceReview =
  | { status: 'pending' }
  | { status: 'approved'; reviewer: string; reviewedAt: string; sourceRevision: string; approvalRef: string }

export interface EvidenceClaim {
  id: string
  subject: string
  value: string
  basis: EvidenceBasis
  sourceId?: string
  locator?: string
  review: EvidenceReview
  note?: string
}

export interface HomeEvidence {
  homeId: string
  sources: EvidenceSource[]
  claims: EvidenceClaim[]
}

const pending = { status: 'pending' } as const

// These numbers were transcribed in docs/embercrest-plan-review.md. The original
// presentation is not in this workspace, so they are evidence leads, not approvals.
const reportedDimensions: Array<[string, number, number]> = [
  ['Bedroom 1', 335, 425], ['Bedroom 2', 335, 425], ['Bedroom 3', 335, 365],
  ['Toilet 1', 150, 305], ['Toilet 2', 250, 135], ['Toilet 3', 150, 305], ['Toilet 4', 150, 245],
  ['Living & Dining', 650, 365], ['Kitchen', 448, 305], ['Family Room', 448, 305],
  ['Lobby', 155, 193], ['Upper Lobby', 165, 185], ['Upper Entry', 167, 180],
  ['Study Nook', 297, 135], ['Open Balcony', 667, 160],
  ['Open Balcony 1', 148, 360], ['Open Balcony 2', 148, 360],
]

const inferredDimensions: Array<[string, number, number]> = [
  ['Stair Hall', 328, 320], ['Corridor', 328, 105], ['Upper Corridor', 328, 105],
]

const footprintClaim = (name: string, widthCm: number, lengthCm: number, basis: EvidenceBasis): EvidenceClaim => ({
  id: `room-footprint:${name}`,
  subject: name,
  value: `${widthCm} × ${lengthCm} cm`,
  basis,
  ...(basis === 'reported-printed' ? { sourceId: 'duplex-pptx', locator: 'slide 1, floor-plan pages 4–5; flat 504' } : {}),
  review: pending,
})

/** Static claim ledger for the Embercrest prototype; no entry signifies developer or architect approval. */
export const EMBERCREST_EVIDENCE: HomeEvidence = {
  homeId: 'embercrest',
  sources: [
    {
      id: 'duplex-pptx',
      description: 'User-supplied Duplex.pptx, reportedly containing A&B Building floor plans and area statement',
      locator: 'slide 1; embedded plan pages 4–5; flat 504',
      revision: null,
      custody: 'not-in-workspace',
      rights: 'unverified',
    },
    {
      id: 'walkthrough',
      description: 'User-supplied furnished walkthrough dated 2026-09-26; style reference only',
      locator: 'full video; exact version unknown',
      revision: null,
      custody: 'not-in-workspace',
      rights: 'unverified',
    },
  ],
  claims: [
    ...reportedDimensions.map(([name, widthCm, lengthCm]) => footprintClaim(name, widthCm, lengthCm, 'reported-printed')),
    ...inferredDimensions.map(([name, widthCm, lengthCm]) => footprintClaim(name, widthCm, lengthCm, 'inferred')),
    {
      id: 'area:carpet', subject: 'Lower + upper carpet area', value: '83.27 + 65.30 = 148.57 m²',
      basis: 'reported-printed', sourceId: 'duplex-pptx', locator: 'slide 1; area statement', review: pending,
    },
    {
      id: 'area:balconies', subject: 'Lower + upper balcony area', value: '18.71 + 6.14 = 24.85 m²',
      basis: 'reported-printed', sourceId: 'duplex-pptx', locator: 'slide 1; area statement', review: pending,
    },
    {
      id: 'area:inclusive', subject: 'Carpet plus balconies', value: '173.42 m²',
      basis: 'reported-printed', sourceId: 'duplex-pptx', locator: 'slide 1; area statement', review: pending,
    },
    {
      id: 'area:marketing-conflict', subject: 'Marketing image carpet label', value: '1867 sq ft carpet',
      basis: 'conflicting', sourceId: 'duplex-pptx', locator: 'slide 1; marketing image versus area statement',
      review: pending, note: 'The numeric value aligns with balcony-inclusive 173.42 m², not 148.57 m² carpet.',
    },
    {
      id: 'geometry:placement', subject: 'Room positions and shared boundaries', value: 'model coordinates',
      basis: 'inferred', review: pending, note: 'Inferred from image scale; wall centre-line model.',
    },
    {
      id: 'geometry:height', subject: 'Wall thickness and storey height', value: '12 cm walls; 300 cm storeys',
      basis: 'inferred', review: pending,
    },
    {
      id: 'geometry:details', subject: 'Stairs, corridors, openings, curved balconies and recesses', value: 'simplified model geometry',
      basis: 'inferred', review: pending, note: 'The source notes 50 mm sunken toilets/balconies; renderer does not reproduce them.',
    },
    {
      id: 'interior:staging', subject: 'Furniture and finishes', value: 'illustrative staging',
      basis: 'illustrative', sourceId: 'walkthrough', locator: 'style reference only', review: pending,
      note: 'No inclusion schedule, product dimensions or asset rights are established.',
    },
  ],
}

/** Returns structural errors in the ledger, including any room whose footprint has no claim. */
export const validateHomeEvidence = (home: MultiLevelHome, evidence: HomeEvidence): string[] => {
  const issues: string[] = []
  if (home.id !== evidence.homeId) issues.push('Evidence home ID does not match the model')
  const sources = new Map(evidence.sources.map((source) => [source.id, source]))
  if (sources.size !== evidence.sources.length) issues.push('Duplicate source ID')
  const claims = new Map(evidence.claims.map((claim) => [claim.id, claim]))
  if (claims.size !== evidence.claims.length) issues.push('Duplicate claim ID')
  for (const claim of evidence.claims) {
    if (claim.basis === 'reported-printed' && (!claim.sourceId || !claim.locator)) {
      issues.push(`${claim.id}: reported print lacks source and locator`)
    }
    if (claim.sourceId && !sources.has(claim.sourceId)) issues.push(`${claim.id}: unknown source`)
    if (claim.review.status === 'approved') {
      const source = claim.sourceId ? sources.get(claim.sourceId) : undefined
      if (!claim.review.reviewer || !claim.review.reviewedAt || !claim.review.sourceRevision || !claim.review.approvalRef ||
        (source && (source.custody !== 'held-and-reviewed' || source.revision !== claim.review.sourceRevision))) {
        issues.push(`${claim.id}: approval lacks reviewed source revision and sign-off`)
      }
    }
  }
  for (const room of home.levels.flatMap((level) => level.rooms)) {
    const claim = claims.get(`room-footprint:${room.name}`)
    if (!claim) issues.push(`${room.name}: missing footprint claim`)
    else if (claim.value !== `${room.w} × ${room.l} cm`) issues.push(`${room.name}: footprint differs from claim`)
  }
  return issues
}

/** Returns publication blockers; an empty result requires source custody and explicit claim approval. */
export const publicationEvidenceIssues = (home: MultiLevelHome, evidence: HomeEvidence): string[] => [
  ...validateHomeEvidence(home, evidence),
  ...evidence.sources.filter((source) => source.custody !== 'held-and-reviewed' || !source.revision || source.rights !== 'documented')
    .map((source) => `${source.id}: source version, custody or rights unverified`),
  ...evidence.claims.filter((claim) => claim.review.status !== 'approved' || claim.basis === 'conflicting')
    .map((claim) => `${claim.id}: claim pending or conflicting`),
]
