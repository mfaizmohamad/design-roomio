import { Router } from 'express'
import { requireAuth } from './auth.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const validId = (value) => typeof value === 'string' && UUID_RE.test(value)
const wrap = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next)

/** Lists project release state for current members; never returns a private manifest. */
export function workspaceReadRoutes(query) {
  const router = Router()
  router.use(requireAuth)

  router.get('/:orgId/projects/:projectId/releases', wrap(async (req, res) => {
    const { orgId, projectId } = req.params
    if (!validId(orgId) || !validId(projectId)) return res.status(404).json({ error: 'not found' })
    const { rows: membership } = await query(
      `SELECT 1 FROM developer_projects p
         JOIN organization_memberships m ON m.organization_id = p.organization_id
        WHERE p.organization_id = $1 AND p.id = $2 AND m.user_id = $3`,
      [orgId, projectId, req.user.id]
    )
    if (!membership[0]) return res.status(404).json({ error: 'not found' })
    // Recheck membership in the data statement: revocation between the scope
    // check and this read must not reveal a release history.
    const { rows } = await query(
      `SELECT r.id, r.home_id AS "homeId", r.published_at AS "createdAt",
              CASE WHEN latest.action IN ('publish', 'restore') THEN 'published'
                   ELSE 'retired' END AS state
         FROM developer_releases r
         JOIN organization_memberships m ON m.organization_id = r.organization_id
         JOIN LATERAL (
           SELECT action FROM developer_release_events e WHERE e.release_id = r.id
            ORDER BY e.id DESC LIMIT 1
         ) latest ON true
        WHERE r.organization_id = $1 AND r.project_id = $2 AND m.user_id = $3
        ORDER BY r.published_at DESC, r.id DESC LIMIT 100`,
      [orgId, projectId, req.user.id]
    )
    res.set('Cache-Control', 'no-store')
    res.json(rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })))
  }))

  return router
}
