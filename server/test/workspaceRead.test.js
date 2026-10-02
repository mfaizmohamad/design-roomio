import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { query } from '../db.js'
import { closeDb, freshDb, signedUpAgent, testApp } from './helpers.js'

let app
beforeAll(async () => { await freshDb(); app = testApp() })
afterAll(async () => { await closeDb() })

describe('developer release list', () => {
  it('requires live project membership and returns no private release data', async () => {
    const owner = await signedUpAgent(app, { tag: 'workspace-owner' })
    const outsider = await signedUpAgent(app, { tag: 'workspace-outsider' })
    const colleague = await signedUpAgent(app, { tag: 'workspace-colleague' })
    const org = await owner.agent.post('/api/orgs').send({ name: 'Synthetic org' })
    expect(org.status).toBe(201)
    const project = await owner.agent.post(`/api/orgs/${org.body.id}/projects`)
      .send({ name: 'Synthetic project' })
    expect(project.status).toBe(201)
    const scope = await query(`SELECT p.id, m.user_id FROM developer_projects p
      JOIN organization_memberships m ON m.organization_id = p.organization_id
      WHERE p.organization_id = $1 AND p.id = $2 AND m.user_id = $3`,
    [org.body.id, project.body.id, owner.user.id])
    expect(scope.rows).toHaveLength(1)
    const url = `/api/orgs/${org.body.id}/projects/${project.body.id}/releases`
    expect((await request(app).get(url)).status).toBe(401)
    expect((await outsider.agent.get(url)).status).toBe(404)
    const listed = await owner.agent.get(url)
    expect(listed.status).toBe(200)
    expect(listed.body).toEqual([])
    expect(listed.headers['cache-control']).toBe('no-store')
    expect((await owner.agent.post(`/api/orgs/${org.body.id}/members`)
      .send({ userId: colleague.user.id, role: 'sales' })).status).toBe(201)
    expect((await colleague.agent.get(url)).status).toBe(200)
    expect((await owner.agent.delete(`/api/orgs/${org.body.id}/members/${colleague.user.id}`)).status).toBe(200)
    expect((await colleague.agent.get(url)).status).toBe(404)
    expect((await owner.agent.get(`/api/orgs/bad/projects/${project.body.id}/releases`)).status).toBe(404)
  })
})
