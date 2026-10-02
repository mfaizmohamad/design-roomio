// Organization and project routes for the developer workspace. Every lookup
// scopes by membership at request time, so a removed member loses access even
// when their 30-day login session is still valid.

import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from './auth.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STAFF_ROLES = new Set(['admin', 'editor', 'publisher', 'sales'])
const MANAGERS = new Set(['owner', 'admin'])
const EDITORS = new Set(['owner', 'admin', 'editor'])
const MAX_ORGS_PER_OWNER = 10
const MAX_MEMBERS_PER_ORG = 50
const MAX_PROJECTS_PER_ORG = 50
const MAX_UNIT_TYPES_PER_PROJECT = 100
const MAX_UNITS_PER_PROJECT = 1000

const wrap = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next)

const validName = (value, max = 120) =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max

/**
 * Mount authenticated organization, project, unit-type, and unit routes.
 * `query` is a parameterized database helper; each request verifies membership.
 */
export function organizationRoutes(query) {
  const router = Router()
  router.use(requireAuth)

  const membership = async (req, res, allowed = null) => {
    const orgId = req.params.orgId
    if (typeof orgId !== 'string' || !UUID_RE.test(orgId)) {
      res.status(404).json({ error: 'not found' })
      return null
    }
    const { rows } = await query(
      `SELECT role FROM organization_memberships
        WHERE organization_id = $1 AND user_id = $2`,
      [orgId, req.user.id]
    )
    // Identical missing and non-member responses avoid revealing tenant IDs.
    if (!rows[0]) {
      res.status(404).json({ error: 'not found' })
      return null
    }
    if (allowed && !allowed.has(rows[0].role)) {
      res.status(403).json({ error: 'forbidden' })
      return null
    }
    return rows[0].role
  }

  const project = async (req, res) => {
    const projectId = req.params.projectId
    if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) {
      res.status(404).json({ error: 'not found' })
      return null
    }
    const { rows } = await query(
      `SELECT id, name FROM developer_projects
        WHERE organization_id = $1 AND id = $2`,
      [req.params.orgId, projectId]
    )
    if (!rows[0]) {
      res.status(404).json({ error: 'not found' })
      return null
    }
    return rows[0]
  }

  router.get('/', wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT o.id, o.name, m.role
         FROM organizations o
         JOIN organization_memberships m ON m.organization_id = o.id
        WHERE m.user_id = $1
        ORDER BY o.created_at DESC`,
      [req.user.id]
    )
    res.json(rows)
  }))

  router.post('/', wrap(async (req, res) => {
    const name = req.body?.name
    if (!validName(name)) return res.status(400).json({ error: 'invalid organization name' })
    const { rows: count } = await query(
      `SELECT count(*)::int AS n FROM organizations WHERE owner_user_id = $1`,
      [req.user.id]
    )
    if (count[0].n >= MAX_ORGS_PER_OWNER) {
      return res.status(409).json({ error: 'organization limit reached' })
    }
    const id = randomUUID()
    // One statement ensures a failed membership insert cannot strand an org.
    const created = await query(
      `WITH free_slot AS (
         SELECT slots.slot FROM generate_series(1, $4::int) AS slots(slot)
          WHERE NOT EXISTS (
            SELECT 1 FROM organizations o
             WHERE o.owner_user_id = $3 AND o.owner_slot = slots.slot
          ) ORDER BY slots.slot LIMIT 1
       ), created AS (
         INSERT INTO organizations (id, name, owner_user_id, owner_slot)
         SELECT $1, $2, $3, slot FROM free_slot
         ON CONFLICT DO NOTHING RETURNING id
       )
       INSERT INTO organization_memberships (organization_id, user_id, role, member_slot)
       SELECT id, $3, 'owner', 1 FROM created RETURNING organization_id`,
      [id, name.trim(), req.user.id, MAX_ORGS_PER_OWNER]
    )
    // The slot unique key also enforces the cap when two creations race after
    // both pass the count check; a loser cannot claim a success it did not write.
    if (!created.rowCount) return res.status(409).json({ error: 'organization limit reached' })
    res.status(201).json({ id, name: name.trim(), role: 'owner' })
  }))

  router.get('/:orgId', wrap(async (req, res) => {
    const role = await membership(req, res)
    if (!role) return
    const { rows } = await query(
      `SELECT id, name FROM organizations WHERE id = $1`, [req.params.orgId]
    )
    res.json({ ...rows[0], role })
  }))

  router.get('/:orgId/members', wrap(async (req, res) => {
    if (!await membership(req, res)) return
    const { rows } = await query(
      `SELECT m.user_id AS "userId", m.role, u.name, u.email
         FROM organization_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1 ORDER BY m.created_at`,
      [req.params.orgId]
    )
    res.json(rows)
  }))

  router.post('/:orgId/members', wrap(async (req, res) => {
    if (!await membership(req, res, MANAGERS)) return
    const { userId, role } = req.body || {}
    if (typeof userId !== 'string' || !UUID_RE.test(userId) ||
        typeof role !== 'string' || !STAFF_ROLES.has(role)) {
      return res.status(400).json({ error: 'invalid member' })
    }
    const { rows: count } = await query(
      `SELECT count(*)::int AS n FROM organization_memberships WHERE organization_id = $1`,
      [req.params.orgId]
    )
    if (count[0].n >= MAX_MEMBERS_PER_ORG) {
      return res.status(409).json({ error: 'member limit reached' })
    }
    const inserted = await query(
      `WITH free_slot AS (
         SELECT slots.slot FROM generate_series(1, $4::int) AS slots(slot)
          WHERE NOT EXISTS (
            SELECT 1 FROM organization_memberships m
             WHERE m.organization_id = $1 AND m.member_slot = slots.slot
          ) ORDER BY slots.slot LIMIT 1
       )
       INSERT INTO organization_memberships (organization_id, user_id, role, member_slot)
       SELECT $1, u.id, $3, free_slot.slot FROM users u CROSS JOIN free_slot
        WHERE u.id = $2
       ON CONFLICT DO NOTHING
       RETURNING user_id`,
      [req.params.orgId, userId, role, MAX_MEMBERS_PER_ORG]
    )
    if (!inserted.rowCount) return res.status(409).json({ error: 'member unavailable or already added' })
    res.status(201).json({ userId, role })
  }))

  router.delete('/:orgId/members/:userId', wrap(async (req, res) => {
    if (!await membership(req, res, MANAGERS)) return
    const userId = req.params.userId
    if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
      return res.status(404).json({ error: 'not found' })
    }
    // The owner membership is the organization's recovery path; never remove it.
    const result = await query(
      `DELETE FROM organization_memberships
        WHERE organization_id = $1 AND user_id = $2 AND role <> 'owner'
        RETURNING user_id`,
      [req.params.orgId, userId]
    )
    if (!result.rowCount) return res.status(404).json({ error: 'not found' })
    res.json({ ok: true })
  }))

  router.get('/:orgId/projects', wrap(async (req, res) => {
    if (!await membership(req, res)) return
    const { rows } = await query(
      `SELECT id, name FROM developer_projects
        WHERE organization_id = $1 ORDER BY created_at DESC`,
      [req.params.orgId]
    )
    res.json(rows)
  }))

  router.post('/:orgId/projects', wrap(async (req, res) => {
    if (!await membership(req, res, MANAGERS)) return
    const name = req.body?.name
    if (!validName(name)) return res.status(400).json({ error: 'invalid project name' })
    const { rows: count } = await query(
      `SELECT count(*)::int AS n FROM developer_projects WHERE organization_id = $1`,
      [req.params.orgId]
    )
    if (count[0].n >= MAX_PROJECTS_PER_ORG) {
      return res.status(409).json({ error: 'project limit reached' })
    }
    const id = randomUUID()
    const inserted = await query(
      `WITH free_slot AS (
         SELECT slots.slot FROM generate_series(1, $4::int) AS slots(slot)
          WHERE NOT EXISTS (
            SELECT 1 FROM developer_projects p
             WHERE p.organization_id = $2 AND p.project_slot = slots.slot
          ) ORDER BY slots.slot LIMIT 1
       )
       INSERT INTO developer_projects (id, organization_id, name, project_slot)
       SELECT $1, $2, $3, slot FROM free_slot
       ON CONFLICT DO NOTHING RETURNING id`,
      [id, req.params.orgId, name.trim(), MAX_PROJECTS_PER_ORG]
    )
    if (!inserted.rowCount) return res.status(409).json({ error: 'project limit reached' })
    res.status(201).json({ id, name: name.trim() })
  }))

  router.get('/:orgId/projects/:projectId', wrap(async (req, res) => {
    if (!await membership(req, res)) return
    const found = await project(req, res)
    if (found) res.json(found)
  }))

  router.get('/:orgId/projects/:projectId/unit-types', wrap(async (req, res) => {
    if (!await membership(req, res)) return
    if (!await project(req, res)) return
    const { rows } = await query(
      `SELECT id, name FROM developer_unit_types
        WHERE organization_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
      [req.params.orgId, req.params.projectId]
    )
    res.json(rows)
  }))

  router.post('/:orgId/projects/:projectId/unit-types', wrap(async (req, res) => {
    if (!await membership(req, res, EDITORS)) return
    if (!await project(req, res)) return
    const name = req.body?.name
    if (!validName(name)) return res.status(400).json({ error: 'invalid unit type name' })
    const { rows: count } = await query(
      `SELECT count(*)::int AS n FROM developer_unit_types
        WHERE organization_id = $1 AND project_id = $2`,
      [req.params.orgId, req.params.projectId]
    )
    if (count[0].n >= MAX_UNIT_TYPES_PER_PROJECT) {
      return res.status(409).json({ error: 'unit type limit reached' })
    }
    const id = randomUUID()
    const inserted = await query(
      `WITH free_slot AS (
         SELECT slots.slot FROM generate_series(1, $5::int) AS slots(slot)
          WHERE NOT EXISTS (
            SELECT 1 FROM developer_unit_types t
             WHERE t.project_id = $3 AND t.type_slot = slots.slot
          ) ORDER BY slots.slot LIMIT 1
       )
       INSERT INTO developer_unit_types (id, organization_id, project_id, name, type_slot)
       SELECT $1, $2, $3, $4, slot FROM free_slot
       ON CONFLICT DO NOTHING RETURNING id`,
      [id, req.params.orgId, req.params.projectId, name.trim(), MAX_UNIT_TYPES_PER_PROJECT]
    )
    if (!inserted.rowCount) return res.status(409).json({ error: 'unit type limit reached' })
    res.status(201).json({ id, name: name.trim() })
  }))

  router.get('/:orgId/projects/:projectId/units', wrap(async (req, res) => {
    if (!await membership(req, res)) return
    if (!await project(req, res)) return
    const { rows } = await query(
      `SELECT id, unit_type_id AS "unitTypeId", label FROM developer_units
        WHERE organization_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
      [req.params.orgId, req.params.projectId]
    )
    res.json(rows)
  }))

  router.post('/:orgId/projects/:projectId/units', wrap(async (req, res) => {
    if (!await membership(req, res, EDITORS)) return
    if (!await project(req, res)) return
    const { label, unitTypeId } = req.body || {}
    if (!validName(label, 80) || typeof unitTypeId !== 'string' || !UUID_RE.test(unitTypeId)) {
      return res.status(400).json({ error: 'invalid unit' })
    }
    const { rows: count } = await query(
      `SELECT count(*)::int AS n FROM developer_units
        WHERE organization_id = $1 AND project_id = $2`,
      [req.params.orgId, req.params.projectId]
    )
    if (count[0].n >= MAX_UNITS_PER_PROJECT) {
      return res.status(409).json({ error: 'unit limit reached' })
    }
    const id = randomUUID()
    // The SELECT and composite FK both enforce that the type belongs to this
    // exact tenant/project; a guessed type ID from another org cannot be used.
    const result = await query(
      `WITH free_slot AS (
         SELECT slots.slot FROM generate_series(1, $6::int) AS slots(slot)
          WHERE NOT EXISTS (
            SELECT 1 FROM developer_units u
             WHERE u.project_id = $3 AND u.unit_slot = slots.slot
          ) ORDER BY slots.slot LIMIT 1
       )
       INSERT INTO developer_units (id, organization_id, project_id, unit_type_id, label, unit_slot)
       SELECT $1, t.organization_id, t.project_id, t.id, $5, free_slot.slot
         FROM developer_unit_types t CROSS JOIN free_slot
        WHERE t.organization_id = $2 AND t.project_id = $3 AND t.id = $4
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [id, req.params.orgId, req.params.projectId, unitTypeId, label.trim(), MAX_UNITS_PER_PROJECT]
    )
    if (!result.rowCount) return res.status(409).json({ error: 'unit unavailable or label already used' })
    res.status(201).json({ id, unitTypeId, label: label.trim() })
  }))

  return router
}
