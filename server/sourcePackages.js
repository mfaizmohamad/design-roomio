// Private staff evidence workflow. Metadata references are stored here; scanned
// source documents must stay in an access-controlled system outside public APIs.
import { createHash, randomUUID } from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from './auth.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_PACKAGES = 100
const MAX_BYTES = 64 * 1024
const SUBMITTERS = new Set(['owner', 'admin', 'publisher'])
const REVIEWERS = new Set(['owner', 'admin'])
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const validId = (value) => typeof value === 'string' && UUID_RE.test(value)
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const keys = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key))

const validPayload = (body) => {
  if (!object(body) || !keys(body, ['sourceRevision', 'documents', 'sourceRights', 'claims'])) return false
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BYTES || !text(body.sourceRevision, 160)) return false
  const docs = body.documents
  if (!Array.isArray(docs) || docs.length < 1 || docs.length > 20 ||
      !docs.every((d) => object(d) && keys(d, ['id', 'title', 'revision', 'reference', 'rightsScope']) &&
        text(d.id, 120) && text(d.title, 160) && text(d.revision, 160) &&
        text(d.reference, 300) && d.rightsScope === 'public-display') ||
      new Set(docs.map((d) => d.id)).size !== docs.length) return false
  const rights = body.sourceRights
  if (!object(rights) || !keys(rights, ['holder', 'approvalRef', 'scope']) ||
      !text(rights.holder, 160) || !text(rights.approvalRef, 160) || rights.scope !== 'public-display') return false
  const claims = body.claims
  const docIds = new Set(docs.map((d) => d.id))
  return Array.isArray(claims) && claims.length > 0 && claims.length <= 100 &&
    claims.every((c) => object(c) && keys(c,
      ['id', 'label', 'value', 'sourceDocumentId', 'sourceRevision', 'approvalRef', 'rightsScope']) &&
      text(c.id, 120) && text(c.label, 160) && text(c.value, 300) &&
      docIds.has(c.sourceDocumentId) && text(c.sourceRevision, 160) &&
      text(c.approvalRef, 160) && c.rightsScope === 'public-display') &&
    new Set(claims.map((c) => c.id)).size === claims.length
}

/** Mount private source-package routes beneath /api/orgs. A missing scope returns null. */
export function sourcePackageRoutes(query) {
  const router = Router()
  router.use(requireAuth)
  const base = '/:orgId/projects/:projectId/homes/:homeId/source-packages'
  const scope = async (req, res, review = false) => {
    const { orgId, projectId, homeId } = req.params
    if (![orgId, projectId, homeId].every(validId)) {
      res.status(404).json({ error: 'not found' }); return null
    }
    const { rows } = await query(
      `SELECT h.revision, h.data, m.role FROM developer_project_homes h
         JOIN organization_memberships m ON m.organization_id = h.organization_id
        WHERE h.organization_id = $1 AND h.project_id = $2 AND h.id = $3
          AND m.user_id = $4`, [orgId, projectId, homeId, req.user.id]
    )
    if (!rows[0]) { res.status(404).json({ error: 'not found' }); return null }
    if (!(review ? REVIEWERS : SUBMITTERS).has(rows[0].role)) {
      res.status(403).json({ error: 'forbidden' }); return null
    }
    return rows[0]
  }

  router.get(base, wrap(async (req, res) => {
    if (!await scope(req, res)) return
    const { rows } = await query(
      `SELECT p.id, p.home_revision AS "homeRevision", p.revision, p.status,
              p.source_revision AS "sourceRevision", p.documents, p.source_rights AS "sourceRights",
              p.claims, p.created_by AS "createdBy", p.submitted_by AS "submittedBy",
              r.decision, r.reviewer_id AS "reviewedBy", r.review_ref AS "reviewRef"
         FROM developer_source_packages p
         JOIN organization_memberships m ON m.organization_id = p.organization_id
         LEFT JOIN developer_source_reviews r ON r.package_id = p.id
        WHERE p.organization_id = $1 AND p.project_id = $2 AND p.home_id = $3
          AND m.user_id = $4 AND m.role IN ('owner', 'admin', 'publisher')
        ORDER BY p.created_at DESC, p.id`,
      [req.params.orgId, req.params.projectId, req.params.homeId, req.user.id]
    )
    res.set('Cache-Control', 'no-store').json(rows)
  }))

  router.post(base, wrap(async (req, res) => {
    const home = await scope(req, res)
    if (!home) return
    if (!validPayload(req.body)) return res.status(400).json({ error: 'invalid source package' })
    const id = randomUUID()
    const { orgId, projectId, homeId } = req.params
    const b = req.body
    // The bounded slot is chosen and inserted in one statement. Concurrent last
    // slots collide safely instead of exceeding the per-project database cap.
    const result = await query(
      `WITH free_slot AS (
         SELECT slots.slot FROM generate_series(1, $12::int) AS slots(slot)
          WHERE NOT EXISTS (SELECT 1 FROM developer_source_packages p
            WHERE p.project_id = $2 AND p.package_slot = slots.slot)
          ORDER BY slots.slot LIMIT 1)
       INSERT INTO developer_source_packages
         (id, organization_id, project_id, home_id, home_revision, home_sha256,
          package_slot, source_revision, documents, source_rights, claims, created_by)
       SELECT $4, h.organization_id, h.project_id, h.id, h.revision, $5,
              free_slot.slot, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10
         FROM developer_project_homes h CROSS JOIN free_slot
         JOIN organization_memberships m ON m.organization_id = h.organization_id
        WHERE h.organization_id = $1 AND h.project_id = $2 AND h.id = $3
          AND h.revision = $11 AND h.data = $13::jsonb
          AND m.user_id = $10 AND m.role IN ('owner', 'admin', 'publisher')
       ON CONFLICT DO NOTHING RETURNING id`,
      [orgId, projectId, homeId, id, sha(home.data), b.sourceRevision,
        JSON.stringify(b.documents), b.sourceRights, JSON.stringify(b.claims), req.user.id, home.revision, MAX_PACKAGES, home.data]
    )
    if (!result.rowCount) return res.status(409).json({ error: 'home changed or package limit reached' })
    res.status(201).json({ id, revision: 1, homeRevision: home.revision })
  }))

  router.put(`${base}/:packageId`, wrap(async (req, res) => {
    if (!await scope(req, res)) return
    if (!validId(req.params.packageId)) return res.status(404).json({ error: 'not found' })
    if (!object(req.body) || !Number.isSafeInteger(req.body.revision) || req.body.revision < 1) {
      return res.status(400).json({ error: 'valid revision required' })
    }
    const { revision, ...payload } = req.body
    if (!validPayload(payload)) return res.status(400).json({ error: 'invalid source package' })
    const result = await query(
      `UPDATE developer_source_packages p SET source_revision = $5,
          documents = $6::jsonb, source_rights = $7::jsonb, claims = $8::jsonb,
          revision = p.revision + 1
        WHERE p.organization_id = $1 AND p.project_id = $2 AND p.home_id = $3
          AND p.id = $4 AND p.revision = $9 AND p.status = 'draft'
          AND p.created_by = $10 AND EXISTS (
            SELECT 1 FROM organization_memberships m WHERE m.organization_id = p.organization_id
              AND m.user_id = $10 AND m.role IN ('owner', 'admin', 'publisher'))
        RETURNING revision`,
      [req.params.orgId, req.params.projectId, req.params.homeId, req.params.packageId,
        payload.sourceRevision, JSON.stringify(payload.documents), payload.sourceRights, JSON.stringify(payload.claims),
        revision, req.user.id]
    )
    if (!result.rowCount) return res.status(409).json({ error: 'package changed or submitted' })
    res.json({ id: req.params.packageId, revision: result.rows[0].revision })
  }))

  router.post(`${base}/:packageId/submit`, wrap(async (req, res) => {
    const home = await scope(req, res)
    if (!home) return
    if (!validId(req.params.packageId)) return res.status(404).json({ error: 'not found' })
    const revision = req.body?.revision
    if (!Number.isSafeInteger(revision) || revision < 1) return res.status(400).json({ error: 'valid revision required' })
    const result = await query(
      `UPDATE developer_source_packages p SET status = 'submitted', submitted_by = $7,
          submitted_at = now(), revision = p.revision + 1
         FROM developer_project_homes h
        WHERE p.organization_id = $1 AND p.project_id = $2 AND p.home_id = $3
          AND p.id = $4 AND p.revision = $5 AND p.status = 'draft'
          AND p.created_by = $7 AND p.home_revision = h.revision AND p.home_sha256 = $6
          AND h.organization_id = p.organization_id AND h.project_id = p.project_id
          AND h.id = p.home_id AND h.data = $8::jsonb
          AND EXISTS (SELECT 1 FROM organization_memberships m
            WHERE m.organization_id = p.organization_id AND m.user_id = $7
              AND m.role IN ('owner', 'admin', 'publisher'))
        RETURNING p.revision`,
      [req.params.orgId, req.params.projectId, req.params.homeId, req.params.packageId,
        revision, sha(home.data), req.user.id, home.data]
    )
    if (!result.rowCount) return res.status(409).json({ error: 'home or package changed' })
    res.json({ id: req.params.packageId, revision: result.rows[0].revision, status: 'submitted' })
  }))

  router.post(`${base}/:packageId/review`, wrap(async (req, res) => {
    const home = await scope(req, res, true)
    if (!home) return
    if (!validId(req.params.packageId)) return res.status(404).json({ error: 'not found' })
    const { decision, reviewRef } = req.body || {}
    if (!['approved', 'rejected'].includes(decision) || !text(reviewRef, 160)) {
      return res.status(400).json({ error: 'invalid review' })
    }
    const result = await query(
      `INSERT INTO developer_source_reviews (package_id, decision, reviewer_id, review_ref)
       SELECT p.id, $5, $6, $7 FROM developer_source_packages p
         JOIN developer_project_homes h ON h.organization_id = p.organization_id
          AND h.project_id = p.project_id AND h.id = p.home_id
         JOIN organization_memberships m ON m.organization_id = p.organization_id
        WHERE p.organization_id = $1 AND p.project_id = $2 AND p.home_id = $3
          AND p.id = $4 AND p.status = 'submitted' AND p.home_revision = h.revision
          AND p.home_sha256 = $8 AND h.data = $9::jsonb
          AND p.created_by <> $6 AND p.submitted_by <> $6
          AND m.user_id = $6 AND m.role IN ('owner', 'admin')
       ON CONFLICT DO NOTHING RETURNING package_id`,
      [req.params.orgId, req.params.projectId, req.params.homeId, req.params.packageId,
        decision, req.user.id, reviewRef.trim(), sha(home.data), home.data]
    )
    if (!result.rowCount) return res.status(409).json({ error: 'package unavailable for review' })
    res.status(201).json({ id: req.params.packageId, decision })
  }))
  return router
}
