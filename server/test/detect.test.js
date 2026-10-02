// test/detect.test.js — the unauthenticated photo-detection handoff:
// upload validation, magic-byte sniffing, atomic file writes into an isolated
// temp dir (never the real shared/requests), the decoded-size cap (413), the
// pending-queue ceiling (429), path-traversal defense on the poll route, and
// result passthrough.

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

import { closeDb, freshDb, testApp, TINY_JPEG, TINY_PNG } from './helpers.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let tmpRoot
let requestsDir
let resultsDir
let app

beforeAll(async () => {
  await freshDb() // detect routes don't touch the DB, but keep setup uniform
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'roomio-detect-'))
  requestsDir = path.join(tmpRoot, 'requests')
  resultsDir = path.join(tmpRoot, 'results')
  await mkdir(resultsDir, { recursive: true }) // where tests drop fake watcher results
  app = testApp({ requestsDir, resultsDir })
})

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
  await closeDb()
})

describe('POST /api/detect', () => {
  it('accepts a data-URL PNG, writes image + sidecar atomically, and returns a uuid', async () => {
    const res = await request(app)
      .post('/api/detect')
      .send({ imageBase64: `data:image/png;base64,${TINY_PNG.toString('base64')}` })

    expect(res.status).toBe(200)
    const id = res.body.request_id
    expect(id).toMatch(UUID_RE)

    // Magic bytes win over the data-URL mime: the file is named .png.
    const imageBytes = await readFile(path.join(requestsDir, `${id}.png`))
    expect(Buffer.compare(imageBytes, TINY_PNG)).toBe(0)

    const sidecar = JSON.parse(
      await readFile(path.join(requestsDir, `${id}.request.json`), 'utf8')
    )
    expect(sidecar).toEqual({ request_id: id, image_path: `shared/requests/${id}.png` })

    // tmp+rename left no .tmp stragglers behind.
    const names = await readdir(requestsDir)
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('sniffs the real format from magic bytes (JPEG bytes -> .jpg)', async () => {
    const res = await request(app)
      .post('/api/detect')
      .send({ imageBase64: TINY_JPEG.toString('base64') })
    expect(res.status).toBe(200)
    await expect(
      readFile(path.join(requestsDir, `${res.body.request_id}.jpg`))
    ).resolves.toBeDefined()
  })

  it('rejects missing, empty, and undecodable payloads with 400', async () => {
    expect((await request(app).post('/api/detect').send({})).status).toBe(400)
    expect((await request(app).post('/api/detect').send({ imageBase64: '   ' })).status).toBe(400)
    expect((await request(app).post('/api/detect').send({ imageBase64: '!!!' })).status).toBe(400)
    expect((await request(app).post('/api/detect').send({ imageBase64: 42 })).status).toBe(400)
  })

  it('rejects images above the decoded-size cap with 413 and writes nothing', async () => {
    const cappedDir = path.join(tmpRoot, 'capped-requests')
    const capped = testApp({
      requestsDir: cappedDir,
      resultsDir,
      maxDetectBytes: 16, // TINY_PNG decodes to ~70 bytes
    })
    const res = await request(capped)
      .post('/api/detect')
      .send({ imageBase64: TINY_PNG.toString('base64') })
    expect(res.status).toBe(413)
    expect(res.body).toEqual({ error: 'image too large' })
    await expect(readdir(cappedDir)).rejects.toThrow() // dir never even created
  })

  it('refuses new uploads once the pending queue is full, and recovers when results land', async () => {
    const qDir = path.join(tmpRoot, 'queue-requests')
    const qResults = path.join(tmpRoot, 'queue-results')
    await mkdir(qResults, { recursive: true })
    const queued = testApp({
      requestsDir: qDir,
      resultsDir: qResults,
      maxPendingDetects: 2,
    })
    const png = { imageBase64: TINY_PNG.toString('base64') }

    const first = await request(queued).post('/api/detect').send(png)
    const second = await request(queued).post('/api/detect').send(png)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    const blocked = await request(queued).post('/api/detect').send(png)
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'detection queue full, try again later' })

    // The watcher answers one request -> a slot frees up.
    await writeFile(
      path.join(qResults, `${first.body.request_id}.result.json`),
      JSON.stringify({ status: 'done', detections: [] })
    )
    const afterResult = await request(queued).post('/api/detect').send(png)
    expect(afterResult.status).toBe(200)
  })
})

describe('GET /api/detect/:id', () => {
  it('returns pending while no result file exists', async () => {
    const res = await request(app).get('/api/detect/unknown-request-id')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'pending' })
  })

  it('rejects path-traversal and otherwise unsafe ids with 400', async () => {
    const traversal = await request(app).get('/api/detect/..%2F..%2Fetc%2Fpasswd')
    expect(traversal.status).toBe(400)
    expect(traversal.body).toEqual({ error: 'invalid id' })

    const dotted = await request(app).get('/api/detect/looks.like.a.file')
    expect(dotted.status).toBe(400)
  })

  it('returns the watcher result JSON verbatim once written', async () => {
    const result = {
      status: 'done',
      detections: [{ kind: 'sofa', confidence: 0.91 }],
    }
    await writeFile(path.join(resultsDir, 'req-done-1.result.json'), JSON.stringify(result))
    const res = await request(app).get('/api/detect/req-done-1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(result)
  })

  it('treats a half-written (invalid JSON) result file as still pending', async () => {
    await writeFile(path.join(resultsDir, 'req-torn-1.result.json'), '{"status": "do')
    const res = await request(app).get('/api/detect/req-torn-1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'pending' })
  })
})
