// Project homes are tenant-owned snapshots, distinct from private `/api/designs`.
// Membership is checked on each request and again in every data statement, so
// removing a colleague immediately cuts off reads and pending writes.

import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from './auth.js'
import { validateWholeHome } from './designValidation.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EDITORS = new Set(['owner', 'admin', 'editor'])
const MAX_HOMES_PER_PROJECT = 100
const MAX_DESIGN_BYTES = 1_500_000
const MAX_REVISION = 2_147_483_646

const wrap = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next)

const validId = (value) => typeof value === 'string' && UUID_RE.test(value)
const toEpochMs = (value) => new Date(value).getTime()

const designIssue = (design) => {
  if (design === null || typeof design !== 'object' || Array.isArray(design)) {
    return { status: 400, error: 'whole-home design required' }
  }
  if (Buffer.byteLength(JSON.stringify(design)) > MAX_DESIGN_BYTES) {
    return { status: 413, error: 'design too large' }
  }
  const issue = validateWholeHome(design)
  if (issue) return { status: 400, error: issue }
  // The shared whole-home validator permits whitespace-only names for legacy
  // personal documents; project names become a database key/display label.
  if (design.name.trim().length === 0) return { status: 400, error: 'invalid home name' }
  return null
}

const revisionFrom = (req, res) => {
  const raw = req.get('X-Home-Revision')
  if (raw === undefined) {
    res.status(428).json({ error: 'home revision required' })
    return null
  }
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > MAX_REVISION) {
    res.status(400).json({ error: 'invalid home revision' })
    return null
  }
  return Number(raw)
}

/**
 * Mount project-home routes under `/api/orgs`. `query` must execute parameterized
 * SQL against the migrated database. No personal design becomes shared until
 * its owner calls the explicit import endpoint; null source IDs mean a home
 * was created directly. Database failures propagate to Express error handling.
 */
export function projectHomeRoutes(query) {
  const router = Router()
  router.use(requireAuth)

  const scope = async (req, res, edit = false) => {
    const { orgId, projectId, unitTypeId } = req.params
    if (![orgId, projectId, unitTypeId].every(validId)) {
      res.status(404).json({ error: 'not found' })
      return false
    }
    const { rows } = await query(
      `SELECT m.role FROM developer_unit_types t
         JOIN organization_memberships m ON m.organization_id = t.organization_id
        WHERE t.organization_id = $1 AND t.project_id = $2 AND t.id = $3
          AND m.user_id = $4`,
      [orgId, projectId, unitTypeId, req.user.id]
    )
    // A missing type and a foreign tenant both look absent to the caller.
    if (!rows[0]) {
      res.status(404).json({ error: 'not found' })
      return false
    }
    if (edit && !EDITORS.has(rows[0].role)) {
      res.status(403).json({ error: 'forbidden' })
      return false
    }
    return true
  }

  const create = async (req, res, design, sourceDesignId = null) => {
    const issue = designIssue(design)
    if (issue) return res.status(issue.status).json({ error: issue.error })
    const id = randomUUID()
    const { orgId, projectId, unitTypeId } = req.params
    const result = await query(
      `WITH free_slot AS (
         SELECT slots.slot FROM generate_series(1, $8::int) AS slots(slot)
          WHERE NOT EXISTS (
            SELECT 1 FROM developer_project_homes h
             WHERE h.project_id = $3 AND h.home_slot = slots.slot
          ) ORDER BY slots.slot LIMIT 1
       )
       INSERT INTO developer_project_homes
         (id, organization_id, project_id, unit_type_id, name, home_slot,
          data, source_design_id, imported_by_user_id)
       SELECT $1, t.organization_id, t.project_id, t.id, $5, free_slot.slot,
              $6::jsonb, $7, CASE WHEN $7::text IS NULL THEN NULL ELSE $9 END
         FROM developer_unit_types t
         JOIN organization_memberships m ON m.organization_id = t.organization_id
         CROSS JOIN free_slot
        WHERE t.organization_id = $2 AND t.project_id = $3 AND t.id = $4
          AND m.user_id = $9 AND m.role IN ('owner', 'admin', 'editor')
       ON CONFLICT DO NOTHING
       RETURNING id, revision`,
      [id, orgId, projectId, unitTypeId, design.name.trim(), design, sourceDesignId,
        MAX_HOMES_PER_PROJECT, req.user.id]
    )
    // The unique slot key handles concurrent last-slot requests; a failed
    // insert must never claim that a project home was saved.
    if (!result.rowCount) return res.status(409).json({ error: 'home unavailable or limit reached' })
    res.set('X-Home-Revision', String(result.rows[0].revision))
    return res.status(201).json({ id, revision: result.rows[0].revision })
  }

  const base = '/:orgId/projects/:projectId/unit-types/:unitTypeId/homes'

  router.get(base, wrap(async (req, res) => {
    if (!await scope(req, res)) return
    const { rows } = await query(
      `SELECT h.id, h.name, h.unit_type_id AS "unitTypeId", h.revision,
              h.updated_at AS "updatedAt"
         FROM developer_project_homes h
         JOIN organization_memberships m ON m.organization_id = h.organization_id
        WHERE h.organization_id = $1 AND h.project_id = $2 AND h.unit_type_id = $3
          AND m.user_id = $4
        ORDER BY h.updated_at DESC, h.id`,
      [req.params.orgId, req.params.projectId, req.params.unitTypeId, req.user.id]
    )
    res.json(rows.map((row) => ({ ...row, updatedAt: toEpochMs(row.updatedAt) })))
  }))

  router.post(base, wrap(async (req, res) => {
    if (!await scope(req, res, true)) return
    return create(req, res, req.body?.design)
  }))

  router.post(`${base}/import`, wrap(async (req, res) => {
    if (!await scope(req, res, true)) return
    const designId = req.body?.designId
    if (typeof designId !== 'string' || designId.length < 1 || designId.length > 256) {
      return res.status(400).json({ error: 'invalid design id' })
    }
    // The owner predicate is essential: knowing a personal design ID is never
    // authorization to copy it into a developer workspace.
    const { rows } = await query(
      `SELECT data FROM designs WHERE id = $1 AND user_id = $2`,
      [designId, req.user.id]
    )
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    return create(req, res, rows[0].data, designId)
  }))

  router.get(`${base}/:homeId`, wrap(async (req, res) => {
    if (!await scope(req, res)) return
    if (!validId(req.params.homeId)) return res.status(404).json({ error: 'not found' })
    const { rows } = await query(
      `SELECT h.id, h.name, h.unit_type_id AS "unitTypeId", h.revision,
              h.source_design_id AS "sourceDesignId", h.data AS design,
              h.updated_at AS "updatedAt"
         FROM developer_project_homes h
         JOIN organization_memberships m ON m.organization_id = h.organization_id
        WHERE h.organization_id = $1 AND h.project_id = $2 AND h.unit_type_id = $3
          AND h.id = $4 AND m.user_id = $5`,
      [req.params.orgId, req.params.projectId, req.params.unitTypeId,
        req.params.homeId, req.user.id]
    )
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.set('X-Home-Revision', String(rows[0].revision))
    res.json({ ...rows[0], updatedAt: toEpochMs(rows[0].updatedAt) })
  }))

  router.put(`${base}/:homeId`, wrap(async (req, res) => {
    if (!await scope(req, res, true)) return
    if (!validId(req.params.homeId)) return res.status(404).json({ error: 'not found' })
    const expected = revisionFrom(req, res)
    if (expected === null) return
    const design = req.body?.design
    const issue = designIssue(design)
    if (issue) return res.status(issue.status).json({ error: issue.error })
    const result = await query(
      `UPDATE developer_project_homes h
          SET name = $6, data = $7::jsonb, revision = h.revision + 1,
              updated_at = now()
        WHERE h.organization_id = $1 AND h.project_id = $2 AND h.unit_type_id = $3
          AND h.id = $4 AND h.revision = $5
          AND EXISTS (
            SELECT 1 FROM organization_memberships m
             WHERE m.organization_id = h.organization_id AND m.user_id = $8
               AND m.role IN ('owner', 'admin', 'editor')
          )
        RETURNING h.revision`,
      [req.params.orgId, req.params.projectId, req.params.unitTypeId,
        req.params.homeId, expected, design.name.trim(), design, req.user.id]
    )
    if (!result.rowCount) return res.status(409).json({ error: 'home changed in another session; reload before saving' })
    res.set('X-Home-Revision', String(result.rows[0].revision))
    res.json({ ok: true, id: req.params.homeId, revision: result.rows[0].revision })
  }))

  router.delete(`${base}/:homeId`, wrap(async (req, res) => {
    if (!await scope(req, res, true)) return
    if (!validId(req.params.homeId)) return res.status(404).json({ error: 'not found' })
    const expected = revisionFrom(req, res)
    if (expected === null) return
    let result
    try {
      result = await query(
        `DELETE FROM developer_project_homes h
          WHERE h.organization_id = $1 AND h.project_id = $2 AND h.unit_type_id = $3
            AND h.id = $4 AND h.revision = $5
            AND EXISTS (
              SELECT 1 FROM organization_memberships m
               WHERE m.organization_id = h.organization_id AND m.user_id = $6
                 AND m.role IN ('owner', 'admin', 'editor')
            )
            AND NOT EXISTS (
              SELECT 1 FROM developer_release_approvals a
               WHERE a.organization_id = h.organization_id
                 AND a.project_id = h.project_id AND a.home_id = h.id
            ) RETURNING h.id`,
        [req.params.orgId, req.params.projectId, req.params.unitTypeId,
          req.params.homeId, expected, req.user.id]
      )
    } catch (error) {
      // An approval can commit after the NOT EXISTS snapshot. The restrictive
      // FK serializes that race; 23503 means this home acquired a dependent
      // record, so surface a conflict rather than an internal server error.
      if (error.code === '23503') {
        return res.status(409).json({ error: 'linked home cannot be deleted' })
      }
      throw error
    }
    if (!result.rowCount) return res.status(409).json({ error: 'home changed or approved; reload before deleting' })
    res.json({ ok: true })
  }))

  return router
}
