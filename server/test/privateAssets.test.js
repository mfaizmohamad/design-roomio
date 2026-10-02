import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

import { query } from '../db.js'
import { MAX_GLB_BYTES, validatePrivateGlb } from '../privateAssetValidation.js'
import { closeDb, freshDb, signedUpAgent, testApp } from './helpers.js'

let app
beforeAll(async () => {
  await freshDb()
  app = testApp()
})
afterAll(async () => { await closeDb() })

const glb = (document, bin = Buffer.alloc(12)) => {
  const raw = Buffer.from(JSON.stringify(document))
  const json = Buffer.concat([raw, Buffer.alloc((4 - raw.length % 4) % 4, 0x20)])
  const binary = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)])
  const bytes = Buffer.alloc(20 + json.length + 8 + binary.length)
  bytes.write('glTF', 0)
  bytes.writeUInt32LE(2, 4)
  bytes.writeUInt32LE(bytes.length, 8)
  bytes.writeUInt32LE(json.length, 12)
  bytes.writeUInt32LE(0x4e4f534a, 16)
  json.copy(bytes, 20)
  bytes.writeUInt32LE(binary.length, 20 + json.length)
  bytes.writeUInt32LE(0x004e4942, 24 + json.length)
  binary.copy(bytes, 28 + json.length)
  return bytes
}

const baseDocument = () => ({
  asset: { version: '2.0' },
  buffers: [{ byteLength: 12 }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  nodes: [{ mesh: 0 }],
  scenes: [{ nodes: [0] }],
  scene: 0,
})
const VALID_GLB = glb(baseDocument())
const metadata = {
  rightsHolder: 'Fixture owner',
  rightsScope: 'private-review,public-display',
  rightsEvidenceRef: 'RIGHTS-001',
  measuredWidthCm: 82.86,
  measuredDepthCm: 57.18,
  measuredHeightCm: 68.74,
  measurementSource: 'Fixture specification',
}

const createProject = async (agent, label) => {
  const org = await agent.post('/api/orgs').send({ name: label })
  expect(org.status).toBe(201)
  const project = await agent.post(`/api/orgs/${org.body.id}/projects`).send({ name: 'Project' })
  expect(project.status).toBe(201)
  return { orgId: org.body.id, projectId: project.body.id }
}
const assetPath = ({ orgId, projectId }) =>
  `/api/orgs/${orgId}/projects/${projectId}/assets`
const binaryParser = (response, done) => {
  const chunks = []
  response.on('data', (chunk) => chunks.push(chunk))
  response.on('end', () => done(null, Buffer.concat(chunks)))
  response.on('error', done)
}

describe('private GLB validator', () => {
  it('accepts a self-contained triangle and rejects external resources', () => {
    expect(validatePrivateGlb(VALID_GLB)).toMatchObject({ triangles: 1, textures: 0 })
    const externalBuffer = baseDocument()
    externalBuffer.buffers[0].uri = 'https://example.invalid/secret.bin'
    expect(() => validatePrivateGlb(glb(externalBuffer))).toThrow(/external/)
    const externalImage = baseDocument()
    externalImage.images = [{ uri: 'data:image/png;base64,AAAA' }]
    expect(() => validatePrivateGlb(glb(externalImage))).toThrow(/external/)
    const extension = baseDocument()
    extension.extensionsUsed = ['KHR_draco_mesh_compression']
    expect(() => validatePrivateGlb(glb(extension))).toThrow(/extensions/)
  })

  it('rejects malformed headers, over-budget triangles, textures and bytes', () => {
    expect(() => validatePrivateGlb(Buffer.from('glTF'))).toThrow(/header/)
    const manyTriangles = baseDocument()
    manyTriangles.accessors[0].count = 300_003
    expect(() => validatePrivateGlb(glb(manyTriangles))).toThrow(/triangle budget/)
    const tooManyImages = baseDocument()
    tooManyImages.images = Array.from({ length: 17 }, () => ({ bufferView: 0, mimeType: 'image/png' }))
    expect(() => validatePrivateGlb(glb(tooManyImages))).toThrow(/texture count/)
    expect(() => validatePrivateGlb(Buffer.alloc(MAX_GLB_BYTES + 1))).toThrow(/too large/)
    expect(() => validatePrivateGlb(Buffer.alloc(MAX_GLB_BYTES))).toThrow(/header/)
  })
})

describe('private project asset routes', () => {
  it('requires membership, separates two tenants and revokes access on the next request', async () => {
    const owner = await signedUpAgent(app, { tag: 'asset-owner' })
    const editor = await signedUpAgent(app, { tag: 'asset-editor' })
    const stranger = await signedUpAgent(app, { tag: 'asset-stranger' })
    const one = await createProject(owner.agent, 'Assets One')
    const two = await createProject(stranger.agent, 'Assets Two')
    const path = assetPath(one)
    expect((await request(app).get(path)).status).toBe(401)
    expect((await stranger.agent.get(path)).status).toBe(404)
    expect((await stranger.agent.post(path).send({ name: 'Stolen' })).status).toBe(404)
    expect((await owner.agent.post(`/api/orgs/${one.orgId}/members`).send({ userId: editor.user.id, role: 'editor' })).status).toBe(201)
    const asset = await editor.agent.post(path).send({ name: 'Chair', brand: 'Fixture' })
    expect(asset.status).toBe(201)
    const vpath = `${path}/${asset.body.id}/versions`
    const reservation = await editor.agent.post(vpath).send(metadata)
    expect(reservation.status).toBe(201)
    const content = `${vpath}/${reservation.body.id}/content`
    expect((await editor.agent.put(content).set('Content-Type', 'model/gltf-binary').send(VALID_GLB)).status).toBe(200)
    expect((await editor.agent.get(content)).status).toBe(404)
    expect((await stranger.agent.get(content)).status).toBe(404)
    expect((await stranger.agent.get(`${assetPath(two)}/${asset.body.id}/versions`)).status).toBe(404)
    expect((await editor.agent.post(`${vpath}/${reservation.body.id}/approve`)).status).toBe(403)
    expect((await owner.agent.post(`${vpath}/${reservation.body.id}/approve`)).status).toBe(200)
    const approved = await editor.agent.get(content).buffer(true).parse(binaryParser)
    expect(approved.status).toBe(200)
    expect(approved.body).toEqual(VALID_GLB)
    expect(approved.headers['cache-control']).toBe('private, no-store')
    expect((await editor.agent.put(content).set('Content-Type', 'model/gltf-binary').send(VALID_GLB)).status).toBe(409)
    expect((await owner.agent.delete(`/api/orgs/${one.orgId}/members/${editor.user.id}`)).status).toBe(200)
    expect((await editor.agent.get(content)).status).toBe(404)
    const { rows } = await query(`SELECT status, sha256 FROM developer_asset_versions WHERE id = $1`, [reservation.body.id])
    expect(rows[0].status).toBe('approved')
    expect(rows[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    await expect(query(
      `UPDATE developer_asset_versions SET rights_scope = 'private-review' WHERE id = $1`,
      [reservation.body.id]
    )).rejects.toThrow(/immutable/)
  })

  it('rejects invalid metadata, raw content type, malformed GLB and upload replay', async () => {
    const owner = await signedUpAgent(app, { tag: 'asset-validation' })
    const project = await createProject(owner.agent, 'Validation')
    const path = assetPath(project)
    expect((await owner.agent.post(path).send({ name: '' })).status).toBe(400)
    const asset = await owner.agent.post(path).send({ name: 'Sofa' })
    expect(asset.status).toBe(201)
    const vpath = `${path}/${asset.body.id}/versions`
    expect((await owner.agent.post(vpath).send({ ...metadata, measuredWidthCm: '82.86' })).status).toBe(400)
    expect((await owner.agent.post(vpath).send({ ...metadata, rightsScope: 'no-public-display' })).status).toBe(400)
    const reserved = await owner.agent.post(vpath).send(metadata)
    expect(reserved.status).toBe(201)
    const content = `${vpath}/${reserved.body.id}/content`
    expect((await owner.agent.put(content).send({ glb: VALID_GLB.toString('base64') })).status).toBe(415)
    expect((await owner.agent.put(content).set('Content-Type', 'model/gltf-binary').send(Buffer.from('bad'))).status).toBe(400)
    expect((await owner.agent.get(content)).status).toBe(404)
    expect((await owner.agent.put(content).set('Content-Type', 'model/gltf-binary').send(VALID_GLB)).status).toBe(200)
    expect((await owner.agent.put(content).set('Content-Type', 'model/gltf-binary').send(VALID_GLB)).status).toBe(409)
  })

  it('enforces the database version-slot boundary', async () => {
    const owner = await signedUpAgent(app, { tag: 'asset-cap' })
    const project = await createProject(owner.agent, 'Version cap')
    const asset = await owner.agent.post(assetPath(project)).send({ name: 'Chair' })
    expect(asset.status).toBe(201)
    const versions = `${assetPath(project)}/${asset.body.id}/versions`
    for (let i = 0; i < 20; i++) {
      expect((await owner.agent.post(versions).send(metadata)).status).toBe(201)
    }
    expect((await owner.agent.post(versions).send(metadata)).status).toBe(409)
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM developer_asset_versions WHERE asset_id = $1`,
      [asset.body.id]
    )
    expect(rows[0].n).toBe(20)
  })
})
