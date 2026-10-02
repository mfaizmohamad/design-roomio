import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { query } from '../db.js'
import { closeDb, freshDb, signedUpAgent, testApp } from './helpers.js'

let app
beforeAll(async () => { await freshDb(); app = testApp() })
afterAll(async () => { await closeDb() })

const design = () => {
  const room = { id: 'synthetic-room', name: 'Living', unit: 'cm', shape: 'rect',
    corners: [{ x: 0, z: 0 }, { x: 400, z: 0 }, { x: 400, z: 300 }, { x: 0, z: 300 }],
    wallHeight: 270, wallThickness: 12, materials: { wallColor: '#fff', floorTexture: 'oak' },
    openings: [], furniture: [], createdAt: 1, updatedAt: 1 }
  return { ...room, id: 'synthetic-home', name: 'Synthetic home', house: {
    version: 1, activeId: room.id, homeId: null,
    levels: [{ label: 'Ground', elevationCm: 0 }],
    rooms: [{ id: room.id, type: 'living', level: 0, design: room }],
    viewMode: 'house', levelFilter: 'all', lighting: {
      version: '1.0', timeOfDay: 0.5, northOffsetDeg: 0, barVisible: false,
      northVisible: false, lightMode: false,
      sun: { enabled: true, maxElevationDeg: 60, warmthShift: true,
        intensityScale: 1, domeRadiusM: 30 },
      shadow: { mapSize: 2048, bias: 0, normalBias: 0, type: 'PCFSoft' },
      rooms: {}, fillScale: 1,
    },
  } }
}

const setupRelease = async (tag) => {
  const owner = await signedUpAgent(app, { tag })
  const org = await owner.agent.post('/api/orgs').send({ name: 'Synthetic org' })
  expect(org.status).toBe(201)
  const project = await owner.agent.post(`/api/orgs/${org.body.id}/projects`).send({ name: 'Synthetic project' })
  expect(project.status).toBe(201)
  const unitType = await owner.agent.post(`/api/orgs/${org.body.id}/projects/${project.body.id}/unit-types`)
    .send({ name: 'Duplex' })
  expect(unitType.status).toBe(201)
  const home = await owner.agent.post(`/api/orgs/${org.body.id}/projects/${project.body.id}/unit-types/${unitType.body.id}/homes`)
    .send({ design: design() })
  expect(home.status).toBe(201)
  const base = `/api/orgs/${org.body.id}/projects/${project.body.id}/homes/${home.body.id}`
  const reviewer = await signedUpAgent(app, { tag: 'enquiry-reviewer' })
  expect((await owner.agent.post(`/api/orgs/${org.body.id}/members`)
    .send({ userId: reviewer.user.id, role: 'admin' })).status).toBe(201)
  const packages = `${base}/source-packages`
  const source = await owner.agent.post(packages).send({
    sourceRevision: 'synthetic-plan-v1',
    documents: [{ id: 'floor-plan', title: 'Synthetic floor plan', revision: 'v1',
      reference: 'synthetic-plan-ref', rightsScope: 'public-display' }],
    sourceRights: { holder: 'Synthetic holder', approvalRef: 'synthetic-rights', scope: 'public-display' },
    claims: [{ id: 'title', label: 'Home', value: 'Synthetic home',
      sourceDocumentId: 'floor-plan', sourceRevision: 'synthetic-plan-v1',
      approvalRef: 'synthetic-claim', rightsScope: 'public-display' }],
  })
  expect(source.status).toBe(201)
  expect((await owner.agent.post(`${packages}/${source.body.id}/submit`)
    .send({ revision: 1 })).status).toBe(200)
  expect((await reviewer.agent.post(`${packages}/${source.body.id}/review`)
    .send({ decision: 'approved', reviewRef: 'synthetic-review' })).status).toBe(201)
  const approval = await owner.agent.post(`${base}/approvals`).send({ sourcePackageId: source.body.id })
  expect(approval.status).toBe(201)
  const release = await owner.agent.post(`${base}/releases`).send({ approvalId: approval.body.id })
  expect(release.status).toBe(201)
  return { owner, orgId: org.body.id, projectId: project.body.id, releaseId: release.body.id }
}

const enquiry = (key = randomUUID()) => ({ idempotencyKey: key, name: 'Synthetic Buyer',
  email: 'buyer@example.test', message: 'Please contact me about this home.',
  contactConsent: { accepted: true, noticeVersion: 'pilot-v1' }, marketingConsent: false })
const publicUrl = (releaseId) => `/api/releases/${releaseId}/enquiries`
const staffUrl = (w) => `/api/orgs/${w.orgId}/projects/${w.projectId}/enquiries`

describe('consented buyer enquiries', () => {
  it('stores consent and one outbox event atomically, with retry idempotency', async () => {
    const w = await setupRelease('enquiry-one')
    const key = randomUUID()
    const body = enquiry(key)
    const first = await request(app).post(publicUrl(w.releaseId)).send(body)
    expect(first.status).toBe(201)
    expect(first.body.state).toBe('stored')
    const again = await request(app).post(publicUrl(w.releaseId)).send(body)
    expect(again.status).toBe(200)
    expect(again.body.id).toBe(first.body.id)
    const altered = await request(app).post(publicUrl(w.releaseId)).send({ ...body, name: 'Different' })
    expect(altered.status).toBe(409)
    const rows = await query(`SELECT q.name, q.email, q.marketing_consent, o.state
      FROM developer_enquiries q JOIN developer_enquiry_outbox o ON o.enquiry_id = q.id
      WHERE q.release_id = $1`, [w.releaseId])
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]).toMatchObject({ name: body.name, email: body.email,
      marketing_consent: false, state: 'pending' })
    expect(JSON.stringify(first.body)).not.toContain(body.email)
    expect(JSON.stringify((await request(app).get(`/api/releases/${w.releaseId}`)).body)).not.toContain(body.email)
  })

  it('requires explicit contact consent and rejects unreviewed choices or invalid contact fields', async () => {
    const w = await setupRelease('enquiry-input')
    const url = publicUrl(w.releaseId)
    const cases = [
      { ...enquiry(), contactConsent: { accepted: false, noticeVersion: 'pilot-v1' } },
      { ...enquiry(), contactConsent: { accepted: true, noticeVersion: 'other' } },
      { ...enquiry(), marketingConsent: 'false' },
      { ...enquiry(), email: undefined, phone: undefined },
      { ...enquiry(), email: 'invalid' },
      { ...enquiry(), phone: '9876543210' },
      { ...enquiry(), name: 'x'.repeat(101) },
      { ...enquiry(), message: 'x'.repeat(501) },
      { ...enquiry(), configuration: { geometry: 'tampered' } },
    ]
    for (const body of cases) expect((await request(app).post(url).send(body)).status).toBe(400)
    expect((await request(app).post('/api/releases/invalid/enquiries').send(enquiry())).status).toBe(404)
    expect((await request(app).post(publicUrl(randomUUID())).send(enquiry())).status).toBe(409)
    const manage = `/api/orgs/${w.orgId}/projects/${w.projectId}/releases/${w.releaseId}`
    expect((await w.owner.agent.post(`${manage}/retire`)).status).toBe(200)
    expect((await request(app).post(url).send(enquiry())).status).toBe(409)
  })

  it('rejects enquiries for historical self-attested links hidden by the source-review gate', async () => {
    const w = await setupRelease('enquiry-legacy')
    const legacyApproval = randomUUID()
    const legacyRelease = randomUUID()
    // Migration 007 retains historical rows but public reads now deny them.
    // Contact capture must use the same publication gate, or an old guessed URL
    // could still collect personal data after its buyer view disappeared.
    await query(`INSERT INTO developer_release_approvals
      (id, organization_id, project_id, home_id, home_revision, home_sha256,
       manifest_sha256, manifest, evidence, approved_by, approval_slot)
      SELECT $1, organization_id, project_id, home_id, home_revision, home_sha256,
        manifest_sha256, manifest, evidence, approved_by, 2
      FROM developer_release_approvals WHERE id =
        (SELECT approval_id FROM developer_releases WHERE id = $2)`,
    [legacyApproval, w.releaseId])
    await query(`INSERT INTO developer_releases
      (id, organization_id, project_id, home_id, approval_id, manifest_sha256,
       manifest, published_by, release_slot)
      SELECT $1, organization_id, project_id, home_id, $2, manifest_sha256,
        manifest, published_by, 2 FROM developer_releases WHERE id = $3`,
    [legacyRelease, legacyApproval, w.releaseId])
    await query(`INSERT INTO developer_release_events
      (release_id, event_slot, action, acted_by) VALUES ($1, 1, 'publish', $2)`,
    [legacyRelease, w.owner.user.id])
    expect((await request(app).get(`/api/releases/${legacyRelease}`)).status).toBe(404)
    expect((await request(app).post(publicUrl(legacyRelease)).send(enquiry())).status).toBe(409)
  })

  it('keeps sales records private and supports guarded replay of a failed intent', async () => {
    const w = await setupRelease('enquiry-staff')
    const outsider = await signedUpAgent(app, { tag: 'enquiry-outsider' })
    const buyer = await request(app).post(publicUrl(w.releaseId)).send(enquiry())
    expect(buyer.status).toBe(201)
    expect((await request(app).get(staffUrl(w))).status).toBe(401)
    expect((await outsider.agent.get(staffUrl(w))).status).toBe(404)
    const listed = await w.owner.agent.get(staffUrl(w))
    expect(listed.status).toBe(200)
    expect(listed.body.enquiries[0]).toMatchObject({ id: buyer.body.id,
      email: 'buyer@example.test', deliveryState: 'pending' })
    const base = `${staffUrl(w)}/${buyer.body.id}`
    expect((await w.owner.agent.patch(`${base}/status`).send({ status: 'contacted' })).status).toBe(200)
    expect((await w.owner.agent.post(`${base}/replay`)).status).toBe(409)
    await query(`UPDATE developer_enquiry_outbox SET state = 'failed', attempts = 1,
      last_error = 'synthetic outage' WHERE enquiry_id = $1`, [buyer.body.id])
    expect((await w.owner.agent.get(`${staffUrl(w)}?state=failed`)).body.enquiries).toHaveLength(1)
    const replay = await w.owner.agent.post(`${base}/replay`)
    expect(replay.status).toBe(200)
    expect(replay.body.deliveryState).toBe('pending')
    expect((await outsider.agent.post(`${base}/replay`)).status).toBe(404)
  })

  it('rechecks membership in the PII query when a member is revoked after scope lookup', async () => {
    const w = await setupRelease('enquiry-revoke')
    const sales = await signedUpAgent(app, { tag: 'enquiry-sales' })
    expect((await w.owner.agent.post(`/api/orgs/${w.orgId}/members`)
      .send({ userId: sales.user.id, role: 'sales' })).status).toBe(201)
    expect((await request(app).post(publicUrl(w.releaseId)).send(enquiry())).status).toBe(201)
    let revoked = false
    const raceApp = testApp({ query: async (sql, params) => {
      if (!revoked && sql.includes('FROM developer_enquiries q JOIN developer_enquiry_outbox o')) {
        revoked = true
        await query(`DELETE FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
          [w.orgId, sales.user.id])
      }
      return query(sql, params)
    } })
    const raceSales = request.agent(raceApp)
    expect((await raceSales.post('/api/auth/login').send({
      email: sales.email, password: sales.password,
    })).status).toBe(200)
    const leaked = await raceSales.get(staffUrl(w))
    expect(leaked.status).toBe(200)
    expect(leaked.body.enquiries).toHaveLength(0)
    expect(revoked).toBe(true)
  })

  it('withdraws PII, cancels delivery and cannot resurrect a withdrawn key', async () => {
    const w = await setupRelease('enquiry-withdraw')
    const key = randomUUID()
    const body = enquiry(key)
    const created = await request(app).post(publicUrl(w.releaseId)).send(body)
    expect(created.status).toBe(201)
    const url = `/api/releases/enquiries/${created.body.id}`
    expect((await request(app).delete(url).set('X-Enquiry-Key', randomUUID())).status).toBe(404)
    expect((await request(app).delete(url).set('X-Enquiry-Key', key)).status).toBe(200)
    expect((await request(app).post(publicUrl(w.releaseId)).send(body)).status).toBe(409)
    const rows = await query(`SELECT q.name, q.email, q.phone, q.message, q.status,
      o.state FROM developer_enquiries q JOIN developer_enquiry_outbox o ON o.enquiry_id = q.id
      WHERE q.id = $1`, [created.body.id])
    expect(rows.rows[0]).toMatchObject({ name: null, email: null, phone: null,
      message: null, status: 'withdrawn', state: 'cancelled' })
    expect((await w.owner.agent.get(staffUrl(w))).body.enquiries).toHaveLength(0)
    expect((await w.owner.agent.post(`${staffUrl(w)}/${created.body.id}/replay`)).status).toBe(409)
  })
})
