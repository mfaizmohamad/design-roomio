import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { query } from '../db.js'
import { closeDb, freshDb, signedUpAgent, testApp } from './helpers.js'

let app
beforeAll(async () => { await freshDb(); app = testApp() })
afterAll(async () => { await closeDb() })

const design = (name = 'Synthetic') => {
  const room = { id: 'living', name, unit: 'cm', shape: 'rect',
    corners: [{ x: 0, z: 0 }, { x: 400, z: 0 }, { x: 400, z: 300 }, { x: 0, z: 300 }],
    wallHeight: 270, wallThickness: 12, openings: [], furniture: [],
    materials: { wallColor: '#fff', floorTexture: 'oak' }, createdAt: 1, updatedAt: 1 }
  return { ...room, house: { version: 1, activeId: room.id, homeId: null,
    levels: [{ label: 'Ground', elevationCm: 0 }],
    rooms: [{ id: room.id, type: 'living', level: 0, design: room }],
    viewMode: 'house', levelFilter: 'all', lighting: { version: '1.0', timeOfDay: 0.5,
      northOffsetDeg: 0, barVisible: false, northVisible: false, lightMode: false,
      sun: { enabled: true, maxElevationDeg: 60, warmthShift: true, intensityScale: 1, domeRadiusM: 30 },
      shadow: { mapSize: 2048, bias: 0, normalBias: 0, type: 'PCFSoft' },
      rooms: {}, fillScale: 1 } } }
}
const evidence = () => ({
  sourceRevision: 'plan-v1',
  documents: [{ id: 'floor-plan', title: 'Synthetic floor plan', revision: 'v1',
    reference: 'PRIVATE-PLAN-REF', rightsScope: 'public-display' }],
  sourceRights: { holder: 'Synthetic holder', approvalRef: 'PRIVATE-RIGHTS-REF',
    scope: 'public-display' },
  claims: [{ id: 'title', label: 'Home', value: 'Synthetic Duplex',
    sourceDocumentId: 'floor-plan', sourceRevision: 'plan-v1',
    approvalRef: 'PRIVATE-CLAIM-REF', rightsScope: 'public-display' }],
})
const workspace = async (owner) => {
  const org = await owner.agent.post('/api/orgs').send({ name: 'Source Org' })
  const project = await owner.agent.post(`/api/orgs/${org.body.id}/projects`).send({ name: 'Synthetic' })
  const type = await owner.agent.post(`/api/orgs/${org.body.id}/projects/${project.body.id}/unit-types`).send({ name: 'Duplex' })
  const homeBase = `/api/orgs/${org.body.id}/projects/${project.body.id}/unit-types/${type.body.id}/homes`
  const home = await owner.agent.post(homeBase).send({ design: design() })
  expect(home.status).toBe(201)
  return { orgId: org.body.id, projectId: project.body.id, homeId: home.body.id,
    homeUrl: `${homeBase}/${home.body.id}`,
    base: `/api/orgs/${org.body.id}/projects/${project.body.id}/homes/${home.body.id}`,
    packages: `/api/orgs/${org.body.id}/projects/${project.body.id}/homes/${home.body.id}/source-packages` }
}
const reviewerFor = async (owner, orgId) => {
  const reviewer = await signedUpAgent(app, { tag: 'evidence-reviewer' })
  expect((await owner.agent.post(`/api/orgs/${orgId}/members`)
    .send({ userId: reviewer.user.id, role: 'admin' })).status).toBe(201)
  return reviewer
}

describe('private source evidence', () => {
  it('requires a separate live reviewer and binds release claims to one exact home revision', async () => {
    const owner = await signedUpAgent(app, { tag: 'evidence-owner' })
    const outsider = await signedUpAgent(app, { tag: 'evidence-outsider' })
    const w = await workspace(owner)
    const reviewer = await reviewerFor(owner, w.orgId)
    expect((await request(app).get(w.packages)).status).toBe(401)
    expect((await outsider.agent.get(w.packages)).status).toBe(404)
    expect((await owner.agent.post(`${w.base}/approvals`).send({ sourcePackageId: randomUUID() })).status).toBe(409)
    const created = await owner.agent.post(w.packages).send(evidence())
    expect(created.status).toBe(201)
    const id = created.body.id
    expect((await owner.agent.post(`${w.base}/approvals`).send({ sourcePackageId: id })).status).toBe(409)
    expect((await owner.agent.post(`${w.packages}/${id}/review`)
      .send({ decision: 'approved', reviewRef: 'review' })).status).toBe(409)
    expect((await owner.agent.post(`${w.packages}/${id}/submit`).send({ revision: 1 })).status).toBe(200)
    expect((await owner.agent.post(`${w.packages}/${id}/review`)
      .send({ decision: 'approved', reviewRef: 'review' })).status).toBe(409)
    expect((await outsider.agent.post(`${w.packages}/${id}/review`)
      .send({ decision: 'approved', reviewRef: 'review' })).status).toBe(404)
    expect((await reviewer.agent.post(`${w.packages}/${id}/review`)
      .send({ decision: 'approved', reviewRef: 'review' })).status).toBe(201)
    const approval = await owner.agent.post(`${w.base}/approvals`).send({ sourcePackageId: id,
      claims: [{ id: 'forged', value: 'Forgeries' }] })
    expect(approval.status).toBe(201)
    const release = await owner.agent.post(`${w.base}/releases`).send({ approvalId: approval.body.id })
    expect(release.status).toBe(201)
    const publicData = await request(app).get(`/api/releases/${release.body.id}`)
    expect(publicData.body.claims).toEqual([{ id: 'title', label: 'Home', value: 'Synthetic Duplex' }])
    expect(JSON.stringify(publicData.body)).not.toContain('PRIVATE-')
    const changed = design('Changed')
    expect((await owner.agent.put(w.homeUrl).set('X-Home-Revision', '1')
      .send({ design: changed })).status).toBe(200)
    expect((await owner.agent.post(`${w.base}/approvals`).send({ sourcePackageId: id })).status).toBe(409)
    expect((await owner.agent.post(`${w.base}/releases`).send({ approvalId: approval.body.id })).status).toBe(409)
  })

  it('validates metadata, CAS, immutability and rejection; never exposes documents publicly', async () => {
    const owner = await signedUpAgent(app, { tag: 'evidence-validation' })
    const w = await workspace(owner)
    const reviewer = await reviewerFor(owner, w.orgId)
    const invalid = evidence()
    invalid.claims[0].sourceDocumentId = 'missing'
    expect((await owner.agent.post(w.packages).send(invalid)).status).toBe(400)
    const wrong = evidence()
    wrong.documents[0].rightsScope = 'private-review'
    expect((await owner.agent.post(w.packages).send(wrong)).status).toBe(400)
    const long = evidence()
    long.claims[0].value = 'ø'.repeat(301)
    expect((await owner.agent.post(w.packages).send(long)).status).toBe(400)
    const created = await owner.agent.post(w.packages).send(evidence())
    expect(created.status).toBe(201)
    const id = created.body.id
    expect((await owner.agent.put(`${w.packages}/${id}`)
      .send({ ...evidence(), revision: 999 })).status).toBe(409)
    expect((await owner.agent.put(`${w.packages}/${id}`)
      .send({ ...evidence(), revision: 1 })).status).toBe(200)
    expect((await owner.agent.post(`${w.packages}/${id}/submit`).send({ revision: 1 })).status).toBe(409)
    expect((await owner.agent.post(`${w.packages}/${id}/submit`).send({ revision: 2 })).status).toBe(200)
    expect((await owner.agent.put(`${w.packages}/${id}`)
      .send({ ...evidence(), revision: 3 })).status).toBe(409)
    expect((await reviewer.agent.post(`${w.packages}/${id}/review`)
      .send({ decision: 'rejected', reviewRef: 'Mismatch' })).status).toBe(201)
    expect((await owner.agent.post(`${w.base}/approvals`).send({ sourcePackageId: id })).status).toBe(409)
    await expect(query(`UPDATE developer_source_packages SET claims = $2 WHERE id = $1`,
      [id, JSON.stringify([])])).rejects.toThrow()
    await expect(query(`UPDATE developer_source_reviews SET decision = 'approved' WHERE package_id = $1`,
      [id])).rejects.toThrow()
  })

  it('enforces the per-project package cap in the database', async () => {
    const owner = await signedUpAgent(app, { tag: 'evidence-cap' })
    const w = await workspace(owner)
    // Sequential writes exercise every slot; the database constraint is the
    // race-safe ceiling even when two callers try to take the final slot.
    for (let slot = 1; slot <= 100; slot++) {
      const created = await owner.agent.post(w.packages).send(evidence())
      expect(created.status).toBe(201)
    }
    expect((await owner.agent.post(w.packages).send(evidence())).status).toBe(409)
    const count = await query('SELECT count(*)::int AS count FROM developer_source_packages WHERE project_id = $1',
      [w.projectId])
    expect(count.rows[0].count).toBe(100)
  })

})
