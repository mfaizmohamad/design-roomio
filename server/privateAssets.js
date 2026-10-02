import { createHash, randomUUID } from 'node:crypto'
import express, { Router } from 'express'
import { requireAuth } from './auth.js'
import { AssetValidationError, MAX_GLB_BYTES, validatePrivateGlb } from './privateAssetValidation.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EDITORS = new Set(['owner', 'admin', 'editor'])
const REVIEWERS = new Set(['owner', 'admin', 'publisher'])
const wrap = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next)
const validId = (value) => typeof value === 'string' && UUID_RE.test(value)
const validText = (value, max) =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
const optionalText = (value, max) =>
  value === undefined || value === null || (typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max)
const measured = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 2000 &&
  Math.abs(Math.round(value * 100) - value * 100) < 1e-7
const validRightsScope = (value) =>
  typeof value === 'string' && /^(private-review|public-display)(,(private-review|public-display))*$/.test(value)

/**
 * Mount private asset routes under /api/orgs. Every operation rechecks current
 * organization membership, including binary reads after session revocation.
 */
export function privateAssetRoutes(query) {
  const router = Router()
  router.use(requireAuth)

  const scope = async (req, res, allowed = null) => {
    if (!validId(req.params.orgId) || !validId(req.params.projectId)) {
      res.status(404).json({ error: 'not found' })
      return false
    }
    const { rows } = await query(
      `SELECT m.role FROM organization_memberships m
         JOIN developer_projects p ON p.organization_id = m.organization_id
        WHERE m.organization_id = $1 AND p.id = $2 AND m.user_id = $3`,
      [req.params.orgId, req.params.projectId, req.user.id]
    )
    if (!rows[0]) {
      res.status(404).json({ error: 'not found' })
      return false
    }
    if (allowed && !allowed.has(rows[0].role)) {
      res.status(403).json({ error: 'forbidden' })
      return false
    }
    return true
  }

  const asset = async (req, res) => {
    if (!validId(req.params.assetId)) {
      res.status(404).json({ error: 'not found' })
      return false
    }
    const { rows } = await query(
      `SELECT id FROM developer_assets
        WHERE organization_id = $1 AND project_id = $2 AND id = $3`,
      [req.params.orgId, req.params.projectId, req.params.assetId]
    )
    if (!rows[0]) {
      res.status(404).json({ error: 'not found' })
      return false
    }
    return true
  }

  const version = async (req, res, includeBytes = false) => {
    if (!validId(req.params.versionId)) {
      res.status(404).json({ error: 'not found' })
      return null
    }
    const { rows } = await query(
      `SELECT id, status, sha256, byte_count AS "byteCount",
              triangle_count AS triangles, texture_count AS textures,
              decoded_texture_bytes AS "decodedTextureBytes",
              measured_width_cm::float8 AS "measuredWidthCm",
              measured_depth_cm::float8 AS "measuredDepthCm",
              measured_height_cm::float8 AS "measuredHeightCm",
              measurement_source AS "measurementSource",
              rights_holder AS "rightsHolder", rights_scope AS "rightsScope",
              rights_evidence_ref AS "rightsEvidenceRef", created_by AS "createdBy",
              uploaded_by AS "uploadedBy", approved_by AS "approvedBy",
              approved_at AS "approvedAt"${includeBytes ? ', glb_bytes AS "glbBytes"' : ''}
         FROM developer_asset_versions
        WHERE organization_id = $1 AND project_id = $2
          AND asset_id = $3 AND id = $4`,
      [req.params.orgId, req.params.projectId, req.params.assetId, req.params.versionId]
    )
    if (!rows[0]) {
      res.status(404).json({ error: 'not found' })
      return null
    }
    return rows[0]
  }

  router.get('/:orgId/projects/:projectId/assets', wrap(async (req, res) => {
    if (!await scope(req, res)) return
    const { rows } = await query(
      `SELECT id, name, brand, sku FROM developer_assets
        WHERE organization_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
      [req.params.orgId, req.params.projectId]
    )
    res.json(rows)
  }))

  router.post('/:orgId/projects/:projectId/assets', wrap(async (req, res) => {
    if (!await scope(req, res, EDITORS)) return
    const { name, brand, sku } = req.body ?? {}
    if (!validText(name, 120) || !optionalText(brand, 120) || !optionalText(sku, 120)) {
      return res.status(400).json({ error: 'invalid asset identity' })
    }
    const id = randomUUID()
    // A bounded unique slot is the write ceiling even when two creators race.
    const inserted = await query(
      `WITH free_slot AS (
         SELECT slots.slot FROM generate_series(1, 100) AS slots(slot)
          WHERE NOT EXISTS (SELECT 1 FROM developer_assets a
            WHERE a.project_id = $3 AND a.asset_slot = slots.slot)
          ORDER BY slots.slot LIMIT 1
       )
       INSERT INTO developer_assets
         (id, organization_id, project_id, name, brand, sku, asset_slot, created_by)
       SELECT $1, $2, $3, $4, $5, $6, slot, $7 FROM free_slot
       ON CONFLICT DO NOTHING RETURNING id`,
      [id, req.params.orgId, req.params.projectId, name.trim(), brand?.trim() ?? null, sku?.trim() ?? null, req.user.id]
    )
    if (!inserted.rowCount) return res.status(409).json({ error: 'asset limit reached' })
    res.status(201).json({ id, name: name.trim() })
  }))

  router.get('/:orgId/projects/:projectId/assets/:assetId/versions', wrap(async (req, res) => {
    if (!await scope(req, res) || !await asset(req, res)) return
    const { rows } = await query(
      `SELECT id, status, sha256, byte_count AS "byteCount",
              triangle_count AS triangles, texture_count AS textures,
              measured_width_cm::float8 AS "measuredWidthCm",
              measured_depth_cm::float8 AS "measuredDepthCm",
              measured_height_cm::float8 AS "measuredHeightCm",
              approved_at AS "approvedAt"
         FROM developer_asset_versions
        WHERE organization_id = $1 AND project_id = $2 AND asset_id = $3
        ORDER BY version_slot`,
      [req.params.orgId, req.params.projectId, req.params.assetId]
    )
    res.json(rows)
  }))

  router.post('/:orgId/projects/:projectId/assets/:assetId/versions', wrap(async (req, res) => {
    if (!await scope(req, res, EDITORS) || !await asset(req, res)) return
    const { rightsHolder, rightsScope, rightsEvidenceRef, measuredWidthCm,
      measuredDepthCm, measuredHeightCm, measurementSource } = req.body ?? {}
    if (!validText(rightsHolder, 120) || !validRightsScope(rightsScope) ||
        !validText(rightsEvidenceRef, 200) || !validText(measurementSource, 200) ||
        !measured(measuredWidthCm) || !measured(measuredDepthCm) || !measured(measuredHeightCm)) {
      return res.status(400).json({ error: 'rights and measured dimensions required' })
    }
    const id = randomUUID()
    const inserted = await query(
      `WITH free_slot AS (
         SELECT slots.slot FROM generate_series(1, 20) AS slots(slot)
          WHERE NOT EXISTS (SELECT 1 FROM developer_asset_versions v
            WHERE v.asset_id = $4 AND v.version_slot = slots.slot)
          ORDER BY slots.slot LIMIT 1
       ), project_slot AS (
         SELECT slots.slot FROM generate_series(1, 100) AS slots(slot)
          WHERE NOT EXISTS (SELECT 1 FROM developer_asset_versions v
            WHERE v.project_id = $3 AND v.project_version_slot = slots.slot)
          ORDER BY slots.slot LIMIT 1
       )
       INSERT INTO developer_asset_versions
         (id, organization_id, project_id, asset_id, version_slot, project_version_slot,
          rights_holder, rights_scope, rights_evidence_ref,
          measured_width_cm, measured_depth_cm, measured_height_cm,
          measurement_source, created_by)
       SELECT $1, $2, $3, $4, free_slot.slot, project_slot.slot,
              $5, $6, $7, $8, $9, $10, $11, $12
         FROM free_slot CROSS JOIN project_slot
       ON CONFLICT DO NOTHING RETURNING id`,
      [id, req.params.orgId, req.params.projectId, req.params.assetId,
        rightsHolder.trim(), rightsScope.trim(), rightsEvidenceRef.trim(),
        measuredWidthCm, measuredDepthCm, measuredHeightCm,
        measurementSource.trim(), req.user.id]
    )
    if (!inserted.rowCount) return res.status(409).json({ error: 'asset version limit reached' })
    res.status(201).json({ id, status: 'reserved' })
  }))

  router.get('/:orgId/projects/:projectId/assets/:assetId/versions/:versionId', wrap(async (req, res) => {
    if (!await scope(req, res) || !await asset(req, res)) return
    const found = await version(req, res)
    if (found) res.json(found)
  }))

  router.put('/:orgId/projects/:projectId/assets/:assetId/versions/:versionId/content',
    // A binary content type bypasses the app's 2 MB JSON parser. This parser
    // bounds the request before Buffer allocation; the validator caps decoded
    // resources before anything becomes an approved version.
    express.raw({ type: 'model/gltf-binary', limit: MAX_GLB_BYTES }),
    wrap(async (req, res) => {
      if (!await scope(req, res, EDITORS) || !await asset(req, res)) return
      if (req.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'model/gltf-binary') {
        return res.status(415).json({ error: 'GLB content type required' })
      }
      if (!validId(req.params.versionId)) return res.status(404).json({ error: 'not found' })
      let metrics
      try { metrics = validatePrivateGlb(req.body) } catch (error) {
        if (error instanceof AssetValidationError) return res.status(error.status).json({ error: error.message })
        throw error
      }
      const sha256 = createHash('sha256').update(req.body).digest('hex')
      const updated = await query(
        `UPDATE developer_asset_versions
            SET glb_bytes = $5, sha256 = $6, byte_count = $7,
                triangle_count = $8, texture_count = $9,
                decoded_texture_bytes = $10, uploaded_by = $11, status = 'draft'
          WHERE organization_id = $1 AND project_id = $2 AND asset_id = $3
            AND id = $4 AND status = 'reserved'
          RETURNING id`,
        [req.params.orgId, req.params.projectId, req.params.assetId,
          req.params.versionId, req.body, sha256, metrics.bytes, metrics.triangles,
          metrics.textures, metrics.decodedTextureBytes, req.user.id]
      )
      if (!updated.rowCount) return res.status(409).json({ error: 'version unavailable or already uploaded' })
      res.json({ id: req.params.versionId, status: 'draft', sha256, ...metrics })
    })
  )

  router.post('/:orgId/projects/:projectId/assets/:assetId/versions/:versionId/approve', wrap(async (req, res) => {
    if (!await scope(req, res, REVIEWERS) || !await asset(req, res)) return
    const found = await version(req, res)
    if (!found) return
    if (found.status !== 'draft') return res.status(409).json({ error: 'version is not ready for review' })
    // A separate reviewer is necessary because rights and physical dimensions
    // are human evidence; structural GLB validation cannot certify either.
    if (found.uploadedBy === req.user.id) return res.status(403).json({ error: 'independent reviewer required' })
    const updated = await query(
      `UPDATE developer_asset_versions
          SET status = 'approved', approved_by = $5, approved_at = now()
        WHERE organization_id = $1 AND project_id = $2 AND asset_id = $3
          AND id = $4 AND status = 'draft' AND uploaded_by <> $5
        RETURNING id, sha256, approved_at AS "approvedAt"`,
      [req.params.orgId, req.params.projectId, req.params.assetId, req.params.versionId, req.user.id]
    )
    if (!updated.rowCount) return res.status(409).json({ error: 'version is not ready for review' })
    res.json({ ...updated.rows[0], status: 'approved' })
  }))

  router.get('/:orgId/projects/:projectId/assets/:assetId/versions/:versionId/content', wrap(async (req, res) => {
    if (!await scope(req, res) || !await asset(req, res)) return
    const found = await version(req, res, true)
    if (!found) return
    if (found.status !== 'approved') return res.status(404).json({ error: 'not found' })
    res.set('Cache-Control', 'private, no-store')
    res.set('Content-Disposition', 'attachment; filename="asset.glb"')
    res.set('ETag', `"${found.sha256}"`)
    res.type('model/gltf-binary').send(found.glbBytes)
  }))

  return router
}
