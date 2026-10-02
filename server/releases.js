// Reviewed, immutable project releases. Public reads use only the copied
// allowlisted snapshot, never a live draft or a private source document.
import { createHash, randomUUID } from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from './auth.js'
import { validateWholeHome } from './designValidation.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PUBLISHERS = new Set(['owner', 'admin', 'publisher'])
const MAX_RELEASES = 100
const MAX_ASSETS = 100
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const validId = (id) => typeof id === 'string' && UUID_RE.test(id)
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const hasPublicRights = (value) => typeof value === 'string' &&
  value.split(',').some((token) => token.trim() === 'public-display')

// These projections are intentionally explicit: a future editor field such as
// staff notes or source scans must not become public by object spreading.
const publicRoom = (d) => ({
  id: d.id, name: d.name, unit: d.unit, shape: d.shape,
  corners: d.corners.map(({ x, z }) => ({ x, z })), wallHeight: d.wallHeight,
  wallThickness: d.wallThickness,
  openings: d.openings.map(({ id, kind, style, wallId, t, width, height, sill, frameColor, leafColor, bare }) =>
    ({ id, kind, style, wallId, t, width, height, sill, frameColor, leafColor, bare })),
  materials: { wallColor: d.materials.wallColor, floorTexture: d.materials.floorTexture,
    wallTexture: d.materials.wallTexture },
  furniture: d.furniture.map(({ id, archetype, category, name, x, z, rotation, w, d: depth, h, color, locked, assetRef }) =>
    ({ id, archetype, category, name, x, z, rotation, w, d: depth, h, color, locked,
      assetRef: assetRef ? { assetVersionId: assetRef.assetVersionId } : undefined })),
  view: d.view ? { cam: d.view.cam, target: d.view.target } : undefined,
  roomType: d.roomType,
  ceiling: d.ceiling ? { color: d.ceiling.color, texture: d.ceiling.texture,
    downlight: d.ceiling.downlight } : undefined,
  autoDoorways: d.autoDoorways, isReplica: d.isReplica,
  createdAt: d.createdAt, updatedAt: d.updatedAt,
})

const publicHome = (data) => {
  const base = publicRoom(data)
  const house = data.house
  return { ...base, house: {
    version: 1, activeId: house.activeId, homeId: house.homeId,
    levels: house.levels.map(({ label, elevationCm }) => ({ label, elevationCm })),
    rooms: house.rooms.map(({ id, type, design, pos, level }) =>
      ({ id, type, design: publicRoom(design), pos: pos ? { x: pos.x, z: pos.z } : undefined, level })),
    lighting: {
      version: house.lighting.version, timeOfDay: house.lighting.timeOfDay,
      northOffsetDeg: house.lighting.northOffsetDeg, barVisible: house.lighting.barVisible,
      northVisible: house.lighting.northVisible, lightMode: house.lighting.lightMode,
      sun: { enabled: house.lighting.sun.enabled,
        maxElevationDeg: house.lighting.sun.maxElevationDeg,
        intensityScale: house.lighting.sun.intensityScale,
        domeRadiusM: house.lighting.sun.domeRadiusM,
        warmthShift: house.lighting.sun.warmthShift },
      shadow: { type: house.lighting.shadow.type,
        mapSize: house.lighting.shadow.mapSize,
        bias: house.lighting.shadow.bias,
        normalBias: house.lighting.shadow.normalBias },
      fillScale: house.lighting.fillScale,
      rooms: Object.fromEntries(Object.entries(house.lighting.rooms).map(([id, value]) => [id,
        { lights: value.lights.map(({ id: lightId, type, layer, color, intensity, pos, target }) =>
          ({ id: lightId, type, layer, color, intensity, pos, target })) }])),
    },
    viewMode: house.viewMode, levelFilter: house.levelFilter,
  } }
}

const referencedVersions = (data) => [...new Set(data.house.rooms.flatMap((r) =>
  r.design.furniture.map((item) => item.assetRef?.assetVersionId).filter(Boolean)))].sort()

/** Mount authenticated approval/publication routes beneath /api/orgs. */
export function releaseRoutes(query) {
  const router = Router()
  router.use(requireAuth)
  const base = '/:orgId/projects/:projectId/homes/:homeId'

  const scope = async (req, res) => {
    const { orgId, projectId, homeId } = req.params
    if (![orgId, projectId, homeId].every(validId)) {
      res.status(404).json({ error: 'not found' }); return null
    }
    const { rows } = await query(
      `SELECT h.id, h.revision, h.data, m.role FROM developer_project_homes h
         JOIN organization_memberships m ON m.organization_id = h.organization_id
        WHERE h.organization_id = $1 AND h.project_id = $2 AND h.id = $3 AND m.user_id = $4`,
      [orgId, projectId, homeId, req.user.id]
    )
    if (!rows[0]) { res.status(404).json({ error: 'not found' }); return null }
    if (!PUBLISHERS.has(rows[0].role)) { res.status(403).json({ error: 'forbidden' }); return null }
    return rows[0]
  }

  router.post(`${base}/approvals`, wrap(async (req, res) => {
    const home = await scope(req, res)
    if (!home) return
    const sourcePackageId = req.body?.sourcePackageId
    if (!validId(sourcePackageId)) return res.status(400).json({ error: 'reviewed source package required' })
    if (validateWholeHome(home.data)) return res.status(409).json({ error: 'home needs review' })
    // The bundled Embercrest geometry is a demonstration with no independently
    // verified original documents. A reviewer cannot approve that fixture here.
    if (home.data.house.homeId === 'embercrest') {
      return res.status(409).json({ error: 'source review pending' })
    }
    const { orgId, projectId, homeId } = req.params
    const packageResult = await query(
      `SELECT p.id, p.home_revision, p.home_sha256, p.claims
         FROM developer_source_packages p
         JOIN developer_source_reviews r ON r.package_id = p.id AND r.decision = 'approved'
        WHERE p.organization_id = $1 AND p.project_id = $2 AND p.home_id = $3
          AND p.id = $4 AND p.status = 'submitted'`,
      [orgId, projectId, homeId, sourcePackageId]
    )
    const sourcePackage = packageResult.rows[0]
    if (!sourcePackage || sourcePackage.home_revision !== home.revision ||
        sourcePackage.home_sha256 !== sha(home.data)) {
      return res.status(409).json({ error: 'reviewed source package missing or stale' })
    }
    const claims = sourcePackage.claims
    const versions = referencedVersions(home.data)
    if (versions.length > MAX_ASSETS || versions.some((id) => !validId(id))) {
      return res.status(400).json({ error: 'invalid asset version reference' })
    }
    const assetRows = versions.length ? (await query(
      `SELECT v.id, v.sha256, v.rights_scope, v.measured_width_cm, v.measured_depth_cm,
              v.measured_height_cm, v.measurement_source
         FROM developer_asset_versions v
        WHERE v.organization_id = $1 AND v.project_id = $2 AND v.id = ANY($3::text[])
          AND v.status = 'approved'`, [orgId, projectId, versions])).rows : []
    if (assetRows.length !== versions.length || assetRows.some((a) => !hasPublicRights(a.rights_scope))) {
      return res.status(409).json({ error: 'asset approval or public rights missing' })
    }
    const assetMap = new Map(assetRows.map((a) => [a.id, a]))
    const assets = versions.map((id) => {
      const a = assetMap.get(id)
      return { versionId: id, sha256: a.sha256, measuredCm: {
        w: Number(a.measured_width_cm), d: Number(a.measured_depth_cm), h: Number(a.measured_height_cm) },
        url: `/api/releases/RELEASE_ID/assets/${id}` }
    })
    const manifest = {
      version: 1, projectId, homeId, homeRevision: home.revision,
      home: publicHome(home.data),
      claims: claims.map(({ id, label, value }) => ({ id, label, value })),
      assets,
    }
    const evidence = { sourcePackageId }
    const approvalId = randomUUID()
    const result = await query(
      `WITH free_slot AS (
         SELECT slots.slot FROM generate_series(1, $10::int) AS slots(slot)
          WHERE NOT EXISTS (SELECT 1 FROM developer_release_approvals a
            WHERE a.project_id = $2 AND a.approval_slot = slots.slot)
          ORDER BY slots.slot LIMIT 1)
       INSERT INTO developer_release_approvals
         (id, organization_id, project_id, home_id, home_revision, home_sha256,
          manifest_sha256, manifest, evidence, approved_by, approval_slot, source_package_id)
       SELECT $4, h.organization_id, h.project_id, h.id, h.revision, $5, $6,
              $7::jsonb, $8::jsonb, $9, free_slot.slot, $13
         FROM developer_project_homes h CROSS JOIN free_slot
         JOIN organization_memberships m ON m.organization_id = h.organization_id
        WHERE h.organization_id = $1 AND h.project_id = $2 AND h.id = $3
          AND h.revision = $11 AND h.data = $12::jsonb
          AND EXISTS (SELECT 1 FROM developer_source_packages p
            JOIN developer_source_reviews r ON r.package_id = p.id AND r.decision = 'approved'
            WHERE p.organization_id = h.organization_id AND p.project_id = h.project_id
              AND p.home_id = h.id AND p.id = $13 AND p.status = 'submitted'
              AND p.home_revision = h.revision AND p.home_sha256 = $5)
          AND m.user_id = $9 AND m.role IN ('owner', 'admin', 'publisher')
       ON CONFLICT DO NOTHING RETURNING id`,
      [orgId, projectId, homeId, approvalId, sha(home.data), sha(manifest), manifest,
        evidence, req.user.id, MAX_RELEASES, home.revision, home.data, sourcePackageId]
    )
    if (!result.rowCount) return res.status(409).json({ error: 'home changed or approval limit reached' })
    res.status(201).json({ id: approvalId, homeRevision: home.revision })
  }))

  router.post(`${base}/releases`, wrap(async (req, res) => {
    const home = await scope(req, res)
    if (!home) return
    const approvalId = req.body?.approvalId
    if (!validId(approvalId)) return res.status(400).json({ error: 'valid approval required' })
    const { orgId, projectId, homeId } = req.params
    const approved = await query(
      `SELECT manifest, manifest_sha256, home_revision, home_sha256, source_package_id
         FROM developer_release_approvals WHERE organization_id = $1 AND project_id = $2
           AND home_id = $3 AND id = $4`, [orgId, projectId, homeId, approvalId]
    )
    const approval = approved.rows[0]
    if (!approval) return res.status(404).json({ error: 'not found' })
    // A historical self-attested approval never becomes publishable after the
    // source-review migration, even if it still matches the home revision.
    if (!approval.source_package_id) return res.status(409).json({ error: 'reviewed source package required' })
    if (home.revision !== approval.home_revision || sha(home.data) !== approval.home_sha256) {
      return res.status(409).json({ error: 'home changed since approval' })
    }
    const releaseId = randomUUID()
    const manifest = { ...approval.manifest, id: releaseId,
      assets: approval.manifest.assets.map((a) => ({ ...a, url: `/api/releases/${releaseId}/assets/${a.versionId}` })) }
    const result = await query(
      `WITH free_slot AS (
         SELECT slots.slot FROM generate_series(1, $9::int) AS slots(slot)
          WHERE NOT EXISTS (SELECT 1 FROM developer_releases r
            WHERE r.project_id = $2 AND r.release_slot = slots.slot)
          ORDER BY slots.slot LIMIT 1), inserted AS (
         INSERT INTO developer_releases
           (id, organization_id, project_id, home_id, approval_id, manifest_sha256,
            manifest, published_by, release_slot)
         SELECT $5, a.organization_id, a.project_id, a.home_id, a.id, $6,
                $7::jsonb, $8, free_slot.slot
           FROM developer_release_approvals a
           JOIN developer_project_homes h ON h.organization_id = a.organization_id
             AND h.project_id = a.project_id AND h.id = a.home_id
           JOIN organization_memberships m ON m.organization_id = a.organization_id
           CROSS JOIN free_slot
          WHERE a.organization_id = $1 AND a.project_id = $2 AND a.home_id = $3
            AND a.id = $4 AND a.home_revision = h.revision AND h.data = $10::jsonb
            AND EXISTS (SELECT 1 FROM developer_source_packages p
              JOIN developer_source_reviews sr ON sr.package_id = p.id AND sr.decision = 'approved'
              WHERE p.id = a.source_package_id AND p.organization_id = a.organization_id
                AND p.project_id = a.project_id AND p.home_id = a.home_id
                AND p.home_revision = h.revision AND p.home_sha256 = a.home_sha256)
            AND m.user_id = $8 AND m.role IN ('owner', 'admin', 'publisher')
         ON CONFLICT DO NOTHING RETURNING id)
       INSERT INTO developer_release_events (release_id, event_slot, action, acted_by)
       SELECT id, 1, 'publish', $8 FROM inserted RETURNING release_id`,
      [orgId, projectId, homeId, approvalId, releaseId, sha(manifest), manifest,
        req.user.id, MAX_RELEASES, home.data]
    )
    if (!result.rowCount) return res.status(409).json({ error: 'home changed or release already published' })
    res.status(201).json({ id: releaseId, url: `/release/${releaseId}` })
  }))

  router.post('/:orgId/projects/:projectId/releases/:releaseId/:action', wrap(async (req, res) => {
    const { orgId, projectId, releaseId, action } = req.params
    if (![orgId, projectId, releaseId].every(validId) || !['retire', 'restore'].includes(action)) {
      return res.status(404).json({ error: 'not found' })
    }
    const result = await query(
      `WITH free_slot AS (
         SELECT slots.slot FROM generate_series(2, 100) AS slots(slot)
          WHERE NOT EXISTS (SELECT 1 FROM developer_release_events e
            WHERE e.release_id = $3 AND e.event_slot = slots.slot)
          ORDER BY slots.slot LIMIT 1)
       INSERT INTO developer_release_events (release_id, event_slot, action, acted_by)
       SELECT r.id, free_slot.slot, $4, $5 FROM developer_releases r
         JOIN organization_memberships m ON m.organization_id = r.organization_id
         CROSS JOIN free_slot
        WHERE r.organization_id = $1 AND r.project_id = $2 AND r.id = $3
          AND m.user_id = $5 AND m.role IN ('owner', 'admin', 'publisher')
       ON CONFLICT DO NOTHING RETURNING release_id`, [orgId, projectId, releaseId, action, req.user.id]
    )
    if (!result.rowCount) return res.status(404).json({ error: 'not found' })
    res.json({ id: releaseId, state: action === 'retire' ? 'retired' : 'published' })
  }))

  return router
}

/** Mount public, published-only manifest and pinned GLB routes at /api/releases. */
export function publicReleaseRoutes(query) {
  const router = Router()
  const active = `JOIN developer_release_approvals approval
    ON approval.id = r.approval_id AND approval.organization_id = r.organization_id
      AND approval.project_id = r.project_id
    JOIN developer_source_packages source_package
      ON source_package.id = approval.source_package_id
        AND source_package.organization_id = r.organization_id
        AND source_package.project_id = r.project_id
        AND source_package.home_id = r.home_id
        AND source_package.status = 'submitted'
    JOIN developer_source_reviews source_review
      ON source_review.package_id = source_package.id AND source_review.decision = 'approved'
    JOIN LATERAL (
      SELECT action FROM developer_release_events e WHERE e.release_id = r.id
      ORDER BY e.id DESC LIMIT 1) state ON state.action IN ('publish', 'restore')`
  router.get('/:releaseId', wrap(async (req, res) => {
    if (!validId(req.params.releaseId)) return res.status(404).json({ error: 'not found' })
    const { rows } = await query(
      `SELECT r.manifest FROM developer_releases r ${active} WHERE r.id = $1`,
      [req.params.releaseId]
    )
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    // A retired link must not remain public through a browser/proxy cache.
    res.set('Cache-Control', 'no-store')
    res.json(rows[0].manifest)
  }))
  router.get('/:releaseId/assets/:versionId', wrap(async (req, res) => {
    const { releaseId, versionId } = req.params
    if (!validId(releaseId) || !validId(versionId)) return res.status(404).json({ error: 'not found' })
    const { rows } = await query(
      `SELECT v.glb_bytes, v.sha256 FROM developer_releases r ${active}
         JOIN developer_asset_versions v ON v.organization_id = r.organization_id
          AND v.project_id = r.project_id AND v.id = $2
        WHERE r.id = $1 AND v.status = 'approved'
          AND EXISTS (SELECT 1 FROM regexp_split_to_table(v.rights_scope, ',') AS token
            WHERE btrim(token) = 'public-display')
          AND r.manifest->'assets' @> $3::jsonb`,
      [releaseId, versionId, JSON.stringify([{ versionId }])]
    )
    if (!rows[0]) return res.status(404).json({ error: 'not found' })
    res.set('Cache-Control', 'no-store')
    res.set('Content-Type', 'model/gltf-binary')
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('ETag', `"${rows[0].sha256}"`)
    res.send(rows[0].glb_bytes)
  }))
  return router
}
