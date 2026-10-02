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

const orgs = '/api/orgs'

const createOrg = async (agent, name) => {
  const res = await agent.post(orgs).send({ name })
  expect(res.status).toBe(201)
  return res.body.id
}

const createProject = async (agent, orgId, name) => {
  const res = await agent.post(`${orgs}/${orgId}/projects`).send({ name })
  expect(res.status).toBe(201)
  return res.body.id
}

describe('developer tenant boundaries', () => {
  it('requires login and keeps personal designs out of the organization workspace', async () => {
    expect((await request(app).get(orgs)).status).toBe(401)
    expect((await request(app).post(orgs).send({ name: 'No session' })).status).toBe(401)
    const alice = await signedUpAgent(app, { tag: 'org-legacy' })
    await alice.agent.post('/api/designs').send({ id: 'legacy-personal', name: 'private room' })
    const orgId = await createOrg(alice.agent, 'Embercrest')
    expect((await alice.agent.get('/api/designs/legacy-personal')).status).toBe(200)
    expect((await alice.agent.get(`${orgs}/${orgId}/projects`)).body).toEqual([])
    const { rows } = await query(`SELECT user_id FROM designs WHERE id = $1`, ['legacy-personal'])
    expect(rows[0].user_id).toBe(alice.user.id)
  })

  it('denies guessed cross-tenant project and member IDs without revealing records', async () => {
    const alice = await signedUpAgent(app, { tag: 'org-alice' })
    const bob = await signedUpAgent(app, { tag: 'org-bob' })
    const aliceOrg = await createOrg(alice.agent, 'Alice Homes')
    const bobOrg = await createOrg(bob.agent, 'Bob Homes')
    const aliceProject = await createProject(alice.agent, aliceOrg, 'Secret Tower')
    const bobProject = await createProject(bob.agent, bobOrg, 'Bob Tower')

    expect((await bob.agent.get(`${orgs}/${aliceOrg}`)).status).toBe(404)
    expect((await bob.agent.get(`${orgs}/${aliceOrg}/members`)).status).toBe(404)
    expect((await bob.agent.get(`${orgs}/${aliceOrg}/projects/${aliceProject}`)).status).toBe(404)
    expect((await bob.agent.post(`${orgs}/${aliceOrg}/projects`).send({ name: 'Intrusion' })).status).toBe(404)
    expect((await bob.agent.get(`${orgs}/${bobOrg}/projects/${aliceProject}`)).status).toBe(404)
    expect((await alice.agent.get(`${orgs}/${aliceOrg}/projects/${bobProject}`)).status).toBe(404)
    expect((await bob.agent.get(orgs)).body.map((o) => o.id)).toEqual([bobOrg])
  })

  it('enforces roles and revocation on the next request using the same session', async () => {
    const owner = await signedUpAgent(app, { tag: 'org-owner' })
    const editor = await signedUpAgent(app, { tag: 'org-editor' })
    const sales = await signedUpAgent(app, { tag: 'org-sales' })
    const orgId = await createOrg(owner.agent, 'Roles Project')
    const projectId = await createProject(owner.agent, orgId, 'Duplex')
    for (const [person, role] of [[editor, 'editor'], [sales, 'sales']]) {
      expect((await owner.agent.post(`${orgs}/${orgId}/members`).send({ userId: person.user.id, role })).status).toBe(201)
    }
    expect((await editor.agent.get(`${orgs}/${orgId}/projects/${projectId}`)).status).toBe(200)
    expect((await editor.agent.post(`${orgs}/${orgId}/projects`).send({ name: 'No' })).status).toBe(403)
    expect((await sales.agent.post(`${orgs}/${orgId}/projects/${projectId}/unit-types`).send({ name: 'No' })).status).toBe(403)
    expect((await owner.agent.post(`${orgs}/${orgId}/members`).send({ userId: sales.user.id, role: 'owner' })).status).toBe(400)
    expect((await owner.agent.delete(`${orgs}/${orgId}/members/${owner.user.id}`)).status).toBe(404)
    expect((await owner.agent.delete(`${orgs}/${orgId}/members/${editor.user.id}`)).status).toBe(200)
    expect((await editor.agent.get(`${orgs}/${orgId}/projects/${projectId}`)).status).toBe(404)
    expect((await editor.agent.get(`${orgs}/${orgId}/members`)).status).toBe(404)
  })

  it('scopes unit types and units to their exact project and organization', async () => {
    const alice = await signedUpAgent(app, { tag: 'org-unit-alice' })
    const bob = await signedUpAgent(app, { tag: 'org-unit-bob' })
    const aliceOrg = await createOrg(alice.agent, 'Alice Units')
    const bobOrg = await createOrg(bob.agent, 'Bob Units')
    const aliceProject = await createProject(alice.agent, aliceOrg, 'A')
    const otherAliceProject = await createProject(alice.agent, aliceOrg, 'A2')
    const bobProject = await createProject(bob.agent, bobOrg, 'B')
    const type = await alice.agent.post(`${orgs}/${aliceOrg}/projects/${aliceProject}/unit-types`).send({ name: 'Duplex' })
    expect(type.status).toBe(201)
    const unitPath = `${orgs}/${aliceOrg}/projects/${aliceProject}/units`
    const unit = await alice.agent.post(unitPath).send({ unitTypeId: type.body.id, label: 'D-101' })
    expect(unit.status).toBe(201)
    expect((await alice.agent.get(unitPath)).body).toEqual([{ id: unit.body.id, unitTypeId: type.body.id, label: 'D-101' }])
    expect((await alice.agent.post(`${orgs}/${aliceOrg}/projects/${otherAliceProject}/units`).send({ unitTypeId: type.body.id, label: 'D-102' })).status).toBe(409)
    expect((await bob.agent.post(`${orgs}/${bobOrg}/projects/${bobProject}/units`).send({ unitTypeId: type.body.id, label: 'D-101' })).status).toBe(409)
    expect((await bob.agent.get(unitPath)).status).toBe(404)
    expect((await alice.agent.post(unitPath).send({ unitTypeId: type.body.id, label: 'D-101' })).status).toBe(409)
  })

  it('rejects malformed writes and caps organizations per owner', async () => {
    const person = await signedUpAgent(app, { tag: 'org-limits' })
    expect((await person.agent.post(orgs).send({ name: 3 })).status).toBe(400)
    expect((await person.agent.post(orgs).send({ name: 'x'.repeat(121) })).status).toBe(400)
    for (let i = 0; i < 10; i++) await createOrg(person.agent, `Org ${i}`)
    expect((await person.agent.post(orgs).send({ name: 'Eleventh' })).status).toBe(409)
    expect((await person.agent.get(orgs)).body).toHaveLength(10)
  })

  it('enforces the final organization slot when two creates race', async () => {
    const person = await signedUpAgent(app, { tag: 'org-race' })
    for (let i = 0; i < 9; i++) await createOrg(person.agent, `Before race ${i}`)
    const [a, b] = await Promise.all([
      person.agent.post(orgs).send({ name: 'Racer A' }),
      person.agent.post(orgs).send({ name: 'Racer B' }),
    ])
    expect([a.status, b.status].sort()).toEqual([201, 409])
    expect((await person.agent.get(orgs)).body).toHaveLength(10)
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM organizations WHERE owner_user_id = $1`,
      [person.user.id]
    )
    expect(rows[0].n).toBe(10)
  })
})
