import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

import { query } from '../db.js'
import { closeDb, freshDb, signedUpAgent, testApp } from './helpers.js'

let app

beforeAll(async () => {
  await freshDb()
  app = testApp()
})

afterAll(async () => {
  await closeDb()
})

const makeHome = (id, name = 'Duplex') => {
  const roomId = `${id}-room`
  const room = {
    id: roomId, name: 'Living', shape: 'rect',
    corners: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }],
    wallHeight: 270, wallThickness: 12,
    materials: { wallColor: '#fff', floorTexture: 'oak' },
    openings: [], furniture: [],
  }
  return {
    ...room, id, name,
    house: {
      version: 1, activeId: roomId, homeId: null,
      levels: [{ label: 'Ground', elevationCm: 0 }],
      rooms: [{ id: roomId, type: 'living', level: 0, design: room }],
      viewMode: 'house', levelFilter: 'all',
      lighting: {
        version: '1.0', timeOfDay: 0.5, northOffsetDeg: 0,
        barVisible: false, northVisible: false, lightMode: false,
        sun: { enabled: true, maxElevationDeg: 60, warmthShift: true,
          intensityScale: 1, domeRadiusM: 30 },
        shadow: { mapSize: 2048, bias: 0, normalBias: 0, type: 'PCFSoft' },
        rooms: {}, fillScale: 1,
      },
    },
  }
}

const createWorkspace = async (agent, label) => {
  const org = await agent.post('/api/orgs').send({ name: `${label} Org` })
  expect(org.status).toBe(201)
  const project = await agent.post(`/api/orgs/${org.body.id}/projects`).send({ name: `${label} Project` })
  expect(project.status).toBe(201)
  const type = await agent.post(`/api/orgs/${org.body.id}/projects/${project.body.id}/unit-types`).send({ name: 'Duplex' })
  expect(type.status).toBe(201)
  return {
    orgId: org.body.id, projectId: project.body.id, typeId: type.body.id,
    path: `/api/orgs/${org.body.id}/projects/${project.body.id}/unit-types/${type.body.id}/homes`,
  }
}

describe('project homes', () => {
  it('requires a session and copies only a caller-owned personal home, leaving the source private', async () => {
    const owner = await signedUpAgent(app, { tag: 'home-owner' })
    const other = await signedUpAgent(app, { tag: 'home-other' })
    const workspace = await createWorkspace(owner.agent, 'Import')
    const original = makeHome('personal-import')
    expect((await owner.agent.post('/api/designs').set('X-Design-Revision', '0').send(original)).status).toBe(200)
    expect((await request(app).get(workspace.path)).status).toBe(401)
    expect((await request(app).post(`${workspace.path}/import`).send({ designId: original.id })).status).toBe(401)
    expect((await other.agent.post(`${workspace.path}/import`).send({ designId: original.id })).status).toBe(404)
    const imported = await owner.agent.post(`${workspace.path}/import`).send({ designId: original.id })
    expect(imported.status).toBe(201)
    expect(imported.headers['x-home-revision']).toBe('1')
    const detail = await owner.agent.get(`${workspace.path}/${imported.body.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.design).toEqual(original)
    expect(detail.body.sourceDesignId).toBe(original.id)
    expect((await owner.agent.get(`/api/designs/${original.id}`)).body).toEqual(original)
    expect((await other.agent.get(`/api/designs/${original.id}`)).status).toBe(404)

    const changed = makeHome(original.id, 'Personal changed')
    expect((await owner.agent.post('/api/designs').set('X-Design-Revision', '1').send(changed)).status).toBe(200)
    expect((await owner.agent.get(`${workspace.path}/${imported.body.id}`)).body.design).toEqual(original)
  })

  it('scopes every read/write to the tenant, unit type and live role', async () => {
    const owner = await signedUpAgent(app, { tag: 'home-role-owner' })
    const editor = await signedUpAgent(app, { tag: 'home-role-editor' })
    const sales = await signedUpAgent(app, { tag: 'home-role-sales' })
    const outsider = await signedUpAgent(app, { tag: 'home-role-outsider' })
    const own = await createWorkspace(owner.agent, 'Roles')
    const foreign = await createWorkspace(outsider.agent, 'Foreign')
    for (const [person, role] of [[editor, 'editor'], [sales, 'sales']]) {
      expect((await owner.agent.post(`/api/orgs/${own.orgId}/members`).send({ userId: person.user.id, role })).status).toBe(201)
    }
    const created = await owner.agent.post(own.path).send({ design: makeHome('roles') })
    expect(created.status).toBe(201)
    const homeId = created.body.id
    expect((await editor.agent.get(own.path)).body).toHaveLength(1)
    const editorSave = await editor.agent.put(`${own.path}/${homeId}`)
      .set('X-Home-Revision', '1').send({ design: makeHome('roles', 'Editor saved') })
    expect(editorSave.status).toBe(200)
    expect(editorSave.body.revision).toBe(2)
    expect((await sales.agent.get(`${own.path}/${homeId}`)).status).toBe(200)
    expect((await sales.agent.post(own.path).send({ design: makeHome('sales-denied') })).status).toBe(403)
    expect((await sales.agent.put(`${own.path}/${homeId}`).set('X-Home-Revision', '2').send({ design: makeHome('sales-denied') })).status).toBe(403)
    expect((await sales.agent.delete(`${own.path}/${homeId}`).set('X-Home-Revision', '2')).status).toBe(403)
    const ownerSource = makeHome('owner-source')
    expect((await owner.agent.post('/api/designs').set('X-Design-Revision', '0').send(ownerSource)).status).toBe(200)
    expect((await editor.agent.post(`${own.path}/import`).send({ designId: ownerSource.id })).status).toBe(404)
    const editorSource = makeHome('editor-source')
    expect((await editor.agent.post('/api/designs').set('X-Design-Revision', '0').send(editorSource)).status).toBe(200)
    expect((await editor.agent.post(`${own.path}/import`).send({ designId: editorSource.id })).status).toBe(201)
    expect((await outsider.agent.get(own.path)).status).toBe(404)
    expect((await outsider.agent.get(`${own.path}/${homeId}`)).status).toBe(404)
    expect((await outsider.agent.post(own.path).send({ design: makeHome('foreign') })).status).toBe(404)
    expect((await owner.agent.get(`${foreign.path}/${homeId}`)).status).toBe(404)
    expect((await outsider.agent.get(`${foreign.path}/${homeId}`)).status).toBe(404)
    const wrongType = await owner.agent.post(`/api/orgs/${own.orgId}/projects/${own.projectId}/unit-types`).send({ name: 'Other' })
    const wrongPath = `/api/orgs/${own.orgId}/projects/${own.projectId}/unit-types/${wrongType.body.id}/homes`
    expect((await owner.agent.get(`${wrongPath}/${homeId}`)).status).toBe(404)
    expect((await owner.agent.put(`${wrongPath}/${homeId}`).set('X-Home-Revision', '2').send({ design: makeHome('wrong-type') })).status).toBe(409)
    expect((await owner.agent.delete(`/api/orgs/${own.orgId}/members/${editor.user.id}`)).status).toBe(200)
    expect((await editor.agent.get(own.path)).status).toBe(404)
    expect((await editor.agent.put(`${own.path}/${homeId}`).set('X-Home-Revision', '2').send({ design: makeHome('revoked') })).status).toBe(404)
  })

  it('validates full homes and uses revision compare-and-swap for writes and deletion', async () => {
    const owner = await signedUpAgent(app, { tag: 'home-cas' })
    const { path } = await createWorkspace(owner.agent, 'CAS')
    expect((await owner.agent.post(path).send({ design: { id: 'not-a-home' } })).status).toBe(400)
    const invalid = makeHome('invalid')
    invalid.house.rooms[0].design.corners[0].x = 'bad'
    expect((await owner.agent.post(path).send({ design: invalid })).status).toBe(400)
    expect((await owner.agent.post(path).send({ design: makeHome('huge', 'x'.repeat(1_500_000)) })).status).toBe(413)
    const created = await owner.agent.post(path).send({ design: makeHome('cas') })
    expect(created.status).toBe(201)
    const url = `${path}/${created.body.id}`
    expect((await owner.agent.put(url).send({ design: makeHome('cas') })).status).toBe(428)
    expect((await owner.agent.put(url).set('X-Home-Revision', '0').send({ design: makeHome('cas') })).status).toBe(400)
    const [a, b] = await Promise.all([
      owner.agent.put(url).set('X-Home-Revision', '1').send({ design: makeHome('cas', 'A') }),
      owner.agent.put(url).set('X-Home-Revision', '1').send({ design: makeHome('cas', 'B') }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const detail = await owner.agent.get(url)
    expect(detail.body.revision).toBe(2)
    expect(['A', 'B']).toContain(detail.body.design.name)
    expect((await owner.agent.delete(url).set('X-Home-Revision', '1')).status).toBe(409)
    expect((await owner.agent.delete(url).set('X-Home-Revision', '2')).status).toBe(200)
    expect((await owner.agent.get(url)).status).toBe(404)
  })

  it('enforces the 100-home project slot ceiling when the final slot races', async () => {
    const owner = await signedUpAgent(app, { tag: 'home-cap' })
    const { orgId, projectId, typeId, path } = await createWorkspace(owner.agent, 'Cap')
    const fixture = makeHome('slot-fixture')
    await query(
      `INSERT INTO developer_project_homes
         (id, organization_id, project_id, unit_type_id, name, home_slot, data)
       SELECT 'test-slot-' || slot, $1, $2, $3, 'Fixture', slot, $4::jsonb
         FROM generate_series(1, 99) AS slot`,
      [orgId, projectId, typeId, fixture]
    )
    const [a, b] = await Promise.all([
      owner.agent.post(path).send({ design: makeHome('race-a') }),
      owner.agent.post(path).send({ design: makeHome('race-b') }),
    ])
    expect([a.status, b.status].sort()).toEqual([201, 409])
    expect((await owner.agent.get(path)).body).toHaveLength(100)
    const count = await query(`SELECT count(*)::int AS n FROM developer_project_homes WHERE project_id = $1`, [projectId])
    expect(count.rows[0].n).toBe(100)
  })

  it('returns a conflict instead of deleting a home that has a release approval', async () => {
    const owner = await signedUpAgent(app, { tag: 'home-approved' })
    const { orgId, projectId, path } = await createWorkspace(owner.agent, 'Approved')
    const created = await owner.agent.post(path).send({ design: makeHome('approved') })
    expect(created.status).toBe(201)
    const homeId = created.body.id
    await query(
      `INSERT INTO developer_release_approvals
         (id, organization_id, project_id, home_id, home_revision, home_sha256,
          manifest_sha256, manifest, evidence, approved_by, approval_slot)
       VALUES ($1, $2, $3, $4, 1, $5, $5, '{}'::jsonb, '{}'::jsonb, $6, 1)`,
      ['test-home-approval', orgId, projectId, homeId, 'a'.repeat(64), owner.user.id]
    )
    const deletion = await owner.agent.delete(`${path}/${homeId}`).set('X-Home-Revision', '1')
    expect(deletion.status).toBe(409)
    expect(deletion.body.error).toMatch(/approved|linked/)
    expect((await owner.agent.get(`${path}/${homeId}`)).status).toBe(200)
  })
})
