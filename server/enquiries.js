// Consented public enquiries and tenant-scoped sales operations. The outbox is
// durable delivery intent only; no CRM is contacted from a request handler.
import { createHash, randomUUID } from 'node:crypto'
import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { requireAuth } from './auth.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+[1-9][0-9]{7,14}$/
const NOTICE_VERSION = 'pilot-v1'
const MAX_ENQUIRIES_PER_RELEASE = 500
const SALES_ROLES = new Set(['owner', 'admin', 'publisher', 'sales'])
const MANAGERS = new Set(['owner', 'admin'])
const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
const validId = (value) => typeof value === 'string' && UUID_RE.test(value)
const hash = (value) => createHash('sha256').update(value).digest('hex')
const ownKeys = (value, allowed) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every((key) => allowed.includes(key))
const hasControl = (value, allowLineBreaks = false) => [...value].some((character) => {
  const code = character.charCodeAt(0)
  return code === 127 || (code < 32 && !(allowLineBreaks && [9, 10, 13].includes(code)))
})
const trimmed = (value, max) => typeof value === 'string' && value.trim().length > 0 &&
  value.trim().length <= max && !hasControl(value)

const normalize = (body) => {
  if (!ownKeys(body, ['idempotencyKey', 'name', 'email', 'phone', 'message', 'contactConsent', 'marketingConsent']) ||
      !validId(body.idempotencyKey) || !trimmed(body.name, 100) ||
      !ownKeys(body.contactConsent, ['accepted', 'noticeVersion']) ||
      body.contactConsent.accepted !== true || body.contactConsent.noticeVersion !== NOTICE_VERSION ||
      typeof body.marketingConsent !== 'boolean') return null
  const name = body.name.trim()
  const email = body.email === undefined ? null :
    (typeof body.email === 'string' && body.email.trim().length <= 254 && EMAIL_RE.test(body.email.trim())
      ? body.email.trim().toLowerCase() : undefined)
  const phone = body.phone === undefined ? null :
    (typeof body.phone === 'string' && PHONE_RE.test(body.phone.trim()) ? body.phone.trim() : undefined)
  if (email === undefined || phone === undefined || (!email && !phone)) return null
  const message = body.message === undefined ? null :
    (typeof body.message === 'string' && body.message.trim().length <= 500 &&
     !hasControl(body.message, true)
      ? body.message.trim() : undefined)
  if (message === undefined) return null
  return { name, email, phone, message, noticeVersion: NOTICE_VERSION,
    marketingConsent: body.marketingConsent }
}

/** Public submission/withdrawal routes. The caller retains its random key as a withdrawal capability. */
export function publicEnquiryRoutes(query) {
  const router = Router()
  // The global API limiter is deliberately loose; this additional per-IP budget
  // limits anonymous contact writes even before the database slot cap is reached.
  const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20,
    standardHeaders: true, legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'too many enquiries' }) })
  router.post('/:releaseId/enquiries', submitLimiter, wrap(async (req, res) => {
    const { releaseId } = req.params
    if (!validId(releaseId)) return res.status(404).json({ error: 'not found' })
    const contact = normalize(req.body)
    if (!contact) return res.status(400).json({ error: 'invalid enquiry or consent' })
    const keyHash = hash(req.body.idempotencyKey.toLowerCase())
    const requestHash = hash(JSON.stringify(contact))
    const id = randomUUID()
    const result = await query(
      `WITH active_release AS (
         SELECT r.id, r.organization_id, r.project_id FROM developer_releases r
          JOIN developer_release_approvals a ON a.id = r.approval_id
            AND a.organization_id = r.organization_id AND a.project_id = r.project_id
          JOIN developer_source_packages p ON p.id = a.source_package_id
            AND p.organization_id = r.organization_id AND p.project_id = r.project_id
            AND p.home_id = r.home_id AND p.status = 'submitted'
          JOIN developer_source_reviews review ON review.package_id = p.id
            AND review.decision = 'approved'
          WHERE r.id = $1 AND (SELECT action FROM developer_release_events e
            WHERE e.release_id = r.id ORDER BY e.id DESC LIMIT 1) IN ('publish', 'restore')
       ), free_slot AS (
         SELECT slots.slot FROM generate_series(1, $11::int) AS slots(slot)
          WHERE NOT EXISTS (SELECT 1 FROM developer_enquiries q
            WHERE q.release_id = $1 AND q.enquiry_slot = slots.slot)
          ORDER BY slots.slot LIMIT 1
       ), inserted AS (
         INSERT INTO developer_enquiries
           (id, organization_id, project_id, release_id, enquiry_slot, idempotency_hash,
            request_hash, name, email, phone, message, notice_version, marketing_consent)
         SELECT $2, r.organization_id, r.project_id, r.id, free_slot.slot, $3, $4,
           $5, $6, $7, $8, $9, $10 FROM active_release r CROSS JOIN free_slot
         ON CONFLICT DO NOTHING RETURNING id
       )
       INSERT INTO developer_enquiry_outbox(enquiry_id)
       SELECT id FROM inserted RETURNING enquiry_id`,
      [releaseId, id, keyHash, requestHash, contact.name, contact.email, contact.phone,
        contact.message, contact.noticeVersion, contact.marketingConsent, MAX_ENQUIRIES_PER_RELEASE]
    )
    // The CTE writes both rows atomically. A network retry cannot create a
    // second lead or second outbox event, even with concurrent requests.
    if (result.rowCount) {
      res.set('Cache-Control', 'no-store')
      return res.status(201).json({ id, state: 'stored' })
    }
    const existing = await query(
      `SELECT q.id, q.request_hash, q.status FROM developer_enquiries q
         JOIN developer_releases r ON r.id = q.release_id
        WHERE q.release_id = $1 AND q.idempotency_hash = $2
          AND (SELECT action FROM developer_release_events e WHERE e.release_id = r.id
            ORDER BY e.id DESC LIMIT 1) IN ('publish', 'restore')`,
      [releaseId, keyHash]
    )
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash || existing.rows[0].status === 'withdrawn') {
        return res.status(409).json({ error: 'enquiry key unavailable' })
      }
      res.set('Cache-Control', 'no-store')
      return res.json({ id: existing.rows[0].id, state: 'stored' })
    }
    return res.status(409).json({ error: 'release unavailable or enquiry limit reached' })
  }))

  router.delete('/enquiries/:enquiryId', wrap(async (req, res) => {
    const { enquiryId } = req.params
    const key = req.get('X-Enquiry-Key')
    if (!validId(enquiryId) || !validId(key)) return res.status(404).json({ error: 'not found' })
    const result = await query(
      `WITH withdrawn AS (
         UPDATE developer_enquiries SET name = NULL, email = NULL, phone = NULL,
           message = NULL, status = 'withdrawn', withdrawn_at = now()
          WHERE id = $1 AND idempotency_hash = $2 AND status <> 'withdrawn'
          RETURNING id
       )
       UPDATE developer_enquiry_outbox o SET state = 'cancelled', last_error = NULL,
         updated_at = now() FROM withdrawn WHERE o.enquiry_id = withdrawn.id
       RETURNING o.enquiry_id`,
      [enquiryId, hash(key.toLowerCase())]
    )
    if (!result.rowCount) return res.status(404).json({ error: 'not found' })
    res.set('Cache-Control', 'no-store')
    res.json({ id: enquiryId, state: 'withdrawn' })
  }))
  return router
}

/** Staff queue/status/replay routes; every operation checks live membership and project scope. */
export function enquiryStaffRoutes(query) {
  const router = Router()
  router.use(requireAuth)
  const base = '/:orgId/projects/:projectId/enquiries'
  const scope = async (req, res, roles = SALES_ROLES) => {
    const { orgId, projectId } = req.params
    if (!validId(orgId) || !validId(projectId)) {
      res.status(404).json({ error: 'not found' }); return false
    }
    const found = await query(
      `SELECT m.role FROM developer_projects p JOIN organization_memberships m
         ON m.organization_id = p.organization_id
        WHERE p.organization_id = $1 AND p.id = $2 AND m.user_id = $3`,
      [orgId, projectId, req.user.id]
    )
    if (!found.rows[0]) { res.status(404).json({ error: 'not found' }); return false }
    if (!roles.has(found.rows[0].role)) { res.status(403).json({ error: 'forbidden' }); return false }
    return true
  }
  router.get(base, wrap(async (req, res) => {
    if (!await scope(req, res)) return
    const state = req.query.state
    if (state !== undefined && !['pending', 'failed', 'delivered', 'cancelled'].includes(state)) {
      return res.status(400).json({ error: 'invalid state' })
    }
    const page = req.query.page === undefined ? 1 : Number(req.query.page)
    if (!Number.isInteger(page) || page < 1 || page > 500) {
      return res.status(400).json({ error: 'invalid page' })
    }
    const rows = await query(
      `SELECT q.id, q.release_id AS "releaseId", q.name, q.email, q.phone, q.message,
              q.notice_version AS "noticeVersion", q.marketing_consent AS "marketingConsent",
              q.status, q.created_at AS "createdAt", o.state AS "deliveryState",
              o.attempts, o.last_error AS "lastError"
         FROM developer_enquiries q JOIN developer_enquiry_outbox o ON o.enquiry_id = q.id
        WHERE q.organization_id = $1 AND q.project_id = $2 AND q.status <> 'withdrawn'
          AND ($3::text IS NULL OR o.state = $3)
          AND EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = q.organization_id
            AND m.user_id = $4 AND m.role IN ('owner', 'admin', 'publisher', 'sales'))
        ORDER BY q.created_at DESC, q.id DESC LIMIT 100 OFFSET $5`,
      [req.params.orgId, req.params.projectId, state ?? null, req.user.id, (page - 1) * 100]
    )
    res.set('Cache-Control', 'no-store')
    res.json({ enquiries: rows.rows, page })
  }))
  router.patch(`${base}/:enquiryId/status`, wrap(async (req, res) => {
    if (!await scope(req, res)) return
    const { enquiryId } = req.params
    const status = req.body?.status
    if (!validId(enquiryId) || !['new', 'contacted', 'closed'].includes(status) ||
        !ownKeys(req.body, ['status'])) return res.status(400).json({ error: 'invalid status' })
    const updated = await query(
      `UPDATE developer_enquiries SET status = $4
        WHERE id = $3 AND organization_id = $1 AND project_id = $2 AND status <> 'withdrawn'
          AND EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = developer_enquiries.organization_id
            AND m.user_id = $5 AND m.role IN ('owner', 'admin', 'publisher', 'sales'))
        RETURNING id, status`, [req.params.orgId, req.params.projectId, enquiryId, status, req.user.id]
    )
    if (!updated.rowCount) return res.status(404).json({ error: 'not found' })
    res.json(updated.rows[0])
  }))
  router.post(`${base}/:enquiryId/replay`, wrap(async (req, res) => {
    if (!await scope(req, res, MANAGERS)) return
    if (!validId(req.params.enquiryId)) return res.status(404).json({ error: 'not found' })
    const result = await query(
      `UPDATE developer_enquiry_outbox o SET state = 'pending', last_error = NULL,
         updated_at = now() FROM developer_enquiries q
        WHERE o.enquiry_id = q.id AND q.id = $3 AND q.organization_id = $1
          AND q.project_id = $2 AND q.status <> 'withdrawn' AND o.state = 'failed'
          AND EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = q.organization_id
            AND m.user_id = $4 AND m.role IN ('owner', 'admin'))
        RETURNING q.id`, [req.params.orgId, req.params.projectId, req.params.enquiryId, req.user.id]
    )
    if (!result.rowCount) return res.status(409).json({ error: 'enquiry not replayable' })
    res.json({ id: result.rows[0].id, deliveryState: 'pending' })
  }))
  router.delete(`${base}/:enquiryId`, wrap(async (req, res) => {
    if (!await scope(req, res, MANAGERS)) return
    if (!validId(req.params.enquiryId)) return res.status(404).json({ error: 'not found' })
    const result = await query(
      `WITH withdrawn AS (
         UPDATE developer_enquiries SET name = NULL, email = NULL, phone = NULL,
           message = NULL, status = 'withdrawn', withdrawn_at = now()
          WHERE id = $3 AND organization_id = $1 AND project_id = $2 AND status <> 'withdrawn'
            AND EXISTS (SELECT 1 FROM organization_memberships m WHERE m.organization_id = developer_enquiries.organization_id
              AND m.user_id = $4 AND m.role IN ('owner', 'admin'))
          RETURNING id
       )
       UPDATE developer_enquiry_outbox o SET state = 'cancelled', last_error = NULL,
         updated_at = now() FROM withdrawn WHERE o.enquiry_id = withdrawn.id
       RETURNING o.enquiry_id`, [req.params.orgId, req.params.projectId, req.params.enquiryId, req.user.id]
    )
    if (!result.rowCount) return res.status(404).json({ error: 'not found' })
    res.json({ id: req.params.enquiryId, state: 'withdrawn' })
  }))
  return router
}
