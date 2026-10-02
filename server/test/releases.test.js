import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { query } from '../db.js'
import { closeDb, freshDb, signedUpAgent, testApp } from './helpers.js'

let app
beforeAll(async () => { await freshDb(); app = testApp() })
afterAll(async () => { await closeDb() })

const design = (id = 'draft') => {
  const room = {
    id: `${id}-room`, name: 'Living', unit: 'cm', shape: 'rect',
    corners: [{ x: 0, z: 0 }, { x: 400, z: 0 }, { x: 400, z: 300 }, { x: 0, z: 300 }],
    wallHeight: 270, wallThickness: 12, materials: { wallColor: '#fff', floorTexture: 'oak' },
    openings: [], furniture: [], createdAt: 1, updatedAt: 1,
  }
  return { ...room, id, name: 'Synthetic Duplex', privateStaffNote: 'DO NOT LEAK',
    house: { version: 1, activeId: room.id, homeId: null,
      levels: [{ label: 'Ground', elevationCm: 0 }],
      rooms: [{ id: room.id, type: 'living', level: 0, design: room, staffNote: 'ROOM SECRET' }],
      viewMode: 'house', levelFilter: 'all',
      lighting: { version: '1.0', timeOfDay: 0.5, northOffsetDeg: 0,
        barVisible: false, northVisible: false, lightMode: false,
        sun: { enabled: true, maxElevationDeg: 60, warmthShift: true, intensityScale: 1, domeRadiusM: 30 },
        shadow: { mapSize: 2048, bias: 0, normalBias: 0, type: 'PCFSoft' },
        rooms: {}, fillScale: 1 },
    } }
}
const sourceBody = () => ({
  sourceRevision: 'SYNTHETIC-REV-1',
  documents: [{ id: 'plan', title: 'Synthetic plan', revision: 'v1',
    reference: 'PRIVATE-SOURCE-REF', rightsScope: 'public-display' }],
  sourceRights: { holder: 'Synthetic fixture', approvalRef: 'PRIVATE-RIGHTS-REF',
    scope: 'public-display' },
  claims: [{ id: 'title', label: 'Home', value: 'Synthetic Duplex',
    sourceDocumentId: 'plan', sourceRevision: 'SYNTHETIC-REV-1',
    approvalRef: 'PRIVATE-CLAIM-REF', rightsScope: 'public-display' }],
})
const approvedBody = () => ({ sourcePackageId: randomUUID() })
const workspace = async (person, label) => {
  const org = await person.agent.post('/api/orgs').send({ name: `${label} Org` })
  expect(org.status).toBe(201)
  const project = await person.agent.post(`/api/orgs/${org.body.id}/projects`).send({ name: label })
  expect(project.status).toBe(201)
  const type = await person.agent.post(`/api/orgs/${org.body.id}/projects/${project.body.id}/unit-types`).send({ name: 'Duplex' })
  expect(type.status).toBe(201)
  const homes = `/api/orgs/${org.body.id}/projects/${project.body.id}/unit-types/${type.body.id}/homes`
  const created = await person.agent.post(homes).send({ design: design(label) })
  expect(created.status).toBe(201)
  const homeId = created.body.id
  return { orgId: org.body.id, projectId: project.body.id, typeId: type.body.id, homeId,
    homeUrl: `${homes}/${homeId}`,
    base: `/api/orgs/${org.body.id}/projects/${project.body.id}/homes/${homeId}` }
}
const approve = async (agent, path) => {
  const reviewer = await signedUpAgent(app, { tag: 'source-reviewer' })
  const orgId = path.split('/')[3]
  expect((await agent.post(`/api/orgs/${orgId}/members`)
    .send({ userId: reviewer.user.id, role: 'admin' })).status).toBe(201)
  const packages = `${path}/source-packages`
  const created = await agent.post(packages).send(sourceBody())
  expect(created.status).toBe(201)
  expect((await agent.post(`${packages}/${created.body.id}/submit`)
    .send({ revision: 1 })).status).toBe(200)
  expect((await reviewer.agent.post(`${packages}/${created.body.id}/review`)
    .send({ decision: 'approved', reviewRef: 'SYNTHETIC-REVIEW' })).status).toBe(201)
  return agent.post(`${path}/approvals`).send({ sourcePackageId: created.body.id })
}
const publish = (agent, path, approvalId) => agent.post(`${path}/releases`).send({ approvalId })

/** A synthetic stored version avoids network fixtures and tests the release gate. */
const addAssetVersion = async (w, userId, rights = 'private-review,public-display') => {
  const assetId = randomUUID()
  const versionId = randomUUID()
  const bytes = Buffer.from('glTF')
  const { rows: slots } = await query(`SELECT COALESCE(MAX(asset_slot), 0) + 1 AS slot
    FROM developer_assets WHERE project_id = $1`, [w.projectId])
  const { rows: versionSlots } = await query(`SELECT COALESCE(MAX(project_version_slot), 0) + 1 AS slot
    FROM developer_asset_versions WHERE project_id = $1`, [w.projectId])
  await query(`INSERT INTO developer_assets
    (id, organization_id, project_id, name, asset_slot, created_by)
    VALUES ($1, $2, $3, 'Test chair', $4, $5)`, [assetId, w.orgId, w.projectId, slots[0].slot, userId])
  await query(`INSERT INTO developer_asset_versions
    (id, organization_id, project_id, asset_id, version_slot, project_version_slot, status,
     rights_holder, rights_scope, rights_evidence_ref,
     measured_width_cm, measured_depth_cm, measured_height_cm, measurement_source,
     glb_bytes, sha256, byte_count, triangle_count, texture_count,
     decoded_texture_bytes, uploaded_by, approved_by, approved_at, created_by)
    VALUES ($1,$2,$3,$4,1,$10,'approved','Fixture holder',$5,'fixture-license',
      80,60,70,'fixture ruler',$6,$7,$8,1,0,0,$9,$9,now(),$9)`,
    [versionId, w.orgId, w.projectId, assetId, rights, bytes,
      'a'.repeat(64), bytes.length, userId, versionSlots[0].slot])
  return versionId
}

const updateHome = async (person, w, next, revision = 1) => person.agent.put(w.homeUrl)
  .set('X-Home-Revision', String(revision)).send({ design: next })

describe('immutable release boundary', () => {
  it('publishes only a reviewed synthetic snapshot and hides private fields and evidence', async () => {
    const owner = await signedUpAgent(app, { tag: 'release-owner' })
    const w = await workspace(owner, 'Safe')
    const approval = await approve(owner.agent, w.base)
    expect(approval.status).toBe(201)
    const release = await publish(owner.agent, w.base, approval.body.id)
    expect(release.status).toBe(201)
    const publicUrl = `/api/releases/${release.body.id}`
    const publicResponse = await request(app).get(publicUrl)
    expect(publicResponse.status).toBe(200)
    expect(publicResponse.headers['cache-control']).toBe('no-store')
    expect(publicResponse.body.home.house.rooms).toHaveLength(1)
    expect(JSON.stringify(publicResponse.body)).not.toMatch(/PRIVATE|staffNote|sourceDesignId|approvalRef|approved_by/)
    expect((await publish(owner.agent, w.base, approval.body.id)).status).toBe(409)
    expect((await request(app).get('/api/releases/not-an-id')).status).toBe(404)
  })

  it('keeps old links reproducible across edits, rejects stale approval, and retires/restores links', async () => {
    const owner = await signedUpAgent(app, { tag: 'release-history' })
    const w = await workspace(owner, 'History')
    const firstApproval = await approve(owner.agent, w.base)
    const firstRelease = await publish(owner.agent, w.base, firstApproval.body.id)
    expect(firstRelease.status).toBe(201)
    const changed = design('History')
    changed.name = 'Updated draft'
    expect((await updateHome(owner, w, changed)).status).toBe(200)
    const oldLink = `/api/releases/${firstRelease.body.id}`
    expect((await request(app).get(oldLink)).body.home.name).toBe('Synthetic Duplex')
    expect((await publish(owner.agent, w.base, firstApproval.body.id)).status).toBe(409)
    const secondApproval = await approve(owner.agent, w.base)
    expect(secondApproval.status).toBe(201)
    const secondRelease = await publish(owner.agent, w.base, secondApproval.body.id)
    expect(secondRelease.status).toBe(201)
    expect((await request(app).get(`/api/releases/${secondRelease.body.id}`)).body.home.name).toBe('Updated draft')
    const manage = `/api/orgs/${w.orgId}/projects/${w.projectId}/releases/${firstRelease.body.id}`
    const inventory = `/api/orgs/${w.orgId}/projects/${w.projectId}/releases`
    expect((await owner.agent.get(inventory)).body.find((item) => item.id === firstRelease.body.id).state).toBe('published')
    expect((await owner.agent.post(`${manage}/retire`)).status).toBe(200)
    expect((await request(app).get(oldLink)).status).toBe(404)
    expect((await owner.agent.get(inventory)).body.find((item) => item.id === firstRelease.body.id).state).toBe('retired')
    expect((await owner.agent.post(`${manage}/restore`)).status).toBe(200)
    expect((await request(app).get(oldLink)).status).toBe(200)
    expect((await owner.agent.get(inventory)).body.find((item) => item.id === firstRelease.body.id).state).toBe('published')
    const audit = await query(`SELECT action FROM developer_release_events WHERE release_id = $1 ORDER BY id`, [firstRelease.body.id])
    expect(audit.rows.map((r) => r.action)).toEqual(['publish', 'retire', 'restore'])
  })

  it('rejects role, tenant and known unapproved Embercrest prototype', async () => {
    const owner = await signedUpAgent(app, { tag: 'release-owner-roles' })
    const editor = await signedUpAgent(app, { tag: 'release-editor' })
    const sales = await signedUpAgent(app, { tag: 'release-sales' })
    const outsider = await signedUpAgent(app, { tag: 'release-outsider' })
    const w = await workspace(owner, 'Roles')
    const other = await workspace(outsider, 'Other')
    for (const [person, role] of [[editor, 'editor'], [sales, 'sales']]) {
      expect((await owner.agent.post(`/api/orgs/${w.orgId}/members`).send({ userId: person.user.id, role })).status).toBe(201)
    }
    expect((await request(app).post(`${w.base}/approvals`).send(approvedBody())).status).toBe(401)
    expect((await editor.agent.post(`${w.base}/approvals`).send(approvedBody())).status).toBe(403)
    expect((await sales.agent.post(`${w.base}/approvals`).send(approvedBody())).status).toBe(403)
    expect((await outsider.agent.post(`${w.base}/approvals`).send(approvedBody())).status).toBe(404)
    expect((await owner.agent.post(`${other.base}/approvals`).send(approvedBody())).status).toBe(404)
    const marker = design('Roles')
    marker.house.homeId = 'embercrest'
    expect((await updateHome(owner, w, marker)).status).toBe(200)
    expect((await approve(owner.agent, w.base)).status).toBe(409)
    expect((await request(app).get(`/api/releases/${randomUUID()}`)).status).toBe(404)
  })

  it('serves only approved, same-project, public-rights versions pinned to an active release', async () => {
    const owner = await signedUpAgent(app, { tag: 'release-asset' })
    const w = await workspace(owner, 'Assets')
    const versionId = await addAssetVersion(w, owner.user.id)
    const next = design('Assets')
    next.house.rooms[0].design.furniture.push({ id: 'chair', archetype: 'chair', category: 'chair',
      name: 'Chair', x: 100, z: 100, rotation: 0, w: 80, d: 60, h: 70,
      color: '#fff', assetRef: { assetVersionId: versionId } })
    expect((await updateHome(owner, w, next)).status).toBe(200)
    const approval = await approve(owner.agent, w.base)
    expect(approval.status).toBe(201)
    const release = await publish(owner.agent, w.base, approval.body.id)
    expect(release.status).toBe(201)
    const url = `/api/releases/${release.body.id}/assets/${versionId}`
    expect((await request(app).get(url)).status).toBe(200)
    expect((await request(app).get(`/api/releases/${release.body.id}/assets/${randomUUID()}`)).status).toBe(404)
    const other = await signedUpAgent(app, { tag: 'release-other-asset' })
    const foreign = await workspace(other, 'Foreign asset')
    const foreignVersion = await addAssetVersion(foreign, other.user.id)
    const altered = design('Assets')
    altered.house.rooms[0].design.furniture.push({ ...next.house.rooms[0].design.furniture[0],
      assetRef: { assetVersionId: foreignVersion } })
    expect((await updateHome(owner, w, altered, 2)).status).toBe(200)
    expect((await approve(owner.agent, w.base)).status).toBe(409)
    const privateVersion = await addAssetVersion({ ...foreign, orgId: w.orgId, projectId: w.projectId }, owner.user.id, 'private-review')
    altered.house.rooms[0].design.furniture[0].assetRef.assetVersionId = privateVersion
    expect((await updateHome(owner, w, altered, 3)).status).toBe(200)
    expect((await approve(owner.agent, w.base)).status).toBe(409)
    expect((await request(app).get(url)).status).toBe(200)
    const manage = `/api/orgs/${w.orgId}/projects/${w.projectId}/releases/${release.body.id}`
    expect((await owner.agent.post(`${manage}/retire`)).status).toBe(200)
    expect((await request(app).get(url)).status).toBe(404)
  })
})
