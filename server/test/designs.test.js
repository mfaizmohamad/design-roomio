// test/designs.test.js — per-user designs CRUD: auth gating, round-trip
// fidelity, malformed payloads, cross-user isolation (403/404), delete
// idempotency, and the upsert ownership race (regression: the route used to
// answer { ok: true } even when the ON CONFLICT ... WHERE ownership re-check
// silently suppressed the write).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

import { query } from '../db.js'
import { closeDb, freshDb, signedUpAgent, testApp } from './helpers.js'

let app

const makeDesign = (id, extra = {}) => ({
  id,
  name: 'Bedroom',
  shape: 'rect',
  corners: [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
    { x: 4, z: 3 },
    { x: 0, z: 3 },
  ],
  furniture: [{ kind: 'bed', x: 1, z: 1, rot: 0 }],
  ...extra,
})

const makeHouse = (id, count = 1) => {
  const rooms = Array.from({ length: count }, (_, index) => {
    const roomId = `${id}-room-${index}`
    return { id: roomId, type: 'bedroom', level: 0, design: {
      ...makeDesign(roomId), name: `Bedroom ${index}`, wallHeight: 270,
      wallThickness: 12, materials: { wallColor: '#fff', floorTexture: 'oak' },
      openings: [], furniture: [],
    } }
  })
  return {
    ...rooms[0].design, id, name: 'Duplex', house: {
      version: 1, activeId: rooms[0].id, homeId: null,
      levels: [{ label: 'Ground', elevationCm: 0 }], rooms,
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

beforeAll(async () => {
  await freshDb()
  app = testApp()
})

afterAll(async () => {
  await closeDb()
})

describe('auth gating', () => {
  it('every designs route is 401 without a session', async () => {
    expect((await request(app).get('/api/designs')).status).toBe(401)
    expect((await request(app).post('/api/designs').send(makeDesign('d-noauth'))).status).toBe(401)
    expect((await request(app).get('/api/designs/d-noauth')).status).toBe(401)
    expect((await request(app).delete('/api/designs/d-noauth')).status).toBe(401)
  })
})

describe('CRUD round trip', () => {
  it('saves, lists, and loads a design back verbatim', async () => {
    const { agent } = await signedUpAgent(app, { tag: 'crud' })
    const design = makeDesign('d-roundtrip')

    const save = await agent.post('/api/designs').send(design)
    expect(save.status).toBe(200)
    expect(save.body).toEqual({ ok: true, id: 'd-roundtrip' })

    const list = await agent.get('/api/designs')
    expect(list.status).toBe(200)
    expect(list.body).toHaveLength(1)
    expect(list.body[0]).toEqual({
      id: 'd-roundtrip',
      name: 'Bedroom',
      shape: 'rect',
      updatedAt: expect.any(Number),
      createdAt: expect.any(Number),
    })

    const load = await agent.get('/api/designs/d-roundtrip')
    expect(load.status).toBe(200)
    expect(load.body).toEqual(design) // full JSON, exactly as stored
  })

  it('upserting the same id updates in place (no duplicate rows)', async () => {
    const { agent } = await signedUpAgent(app, { tag: 'upsert' })
    await agent.post('/api/designs').send(makeDesign('d-upsert', { name: 'v1' }))
    const second = await agent
      .post('/api/designs')
      .send(makeDesign('d-upsert', { name: 'v2', furniture: [] }))
    expect(second.status).toBe(200)

    const list = await agent.get('/api/designs')
    expect(list.body.filter((d) => d.id === 'd-upsert')).toHaveLength(1)

    const load = await agent.get('/api/designs/d-upsert')
    expect(load.body.name).toBe('v2')
    expect(load.body.furniture).toEqual([])
  })

  it('lists designs newest-first', async () => {
    const { agent } = await signedUpAgent(app, { tag: 'order' })
    await agent.post('/api/designs').send(makeDesign('d-older'))
    await agent.post('/api/designs').send(makeDesign('d-newer'))
    const list = await agent.get('/api/designs')
    expect(list.body.map((d) => d.id)).toEqual(['d-newer', 'd-older'])
  })

  it('GET of a nonexistent design is 404', async () => {
    const { agent } = await signedUpAgent(app, { tag: 'missing' })
    const res = await agent.get('/api/designs/never-saved')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'not found' })
  })

  it('deletes an owned design (and stays idempotent on repeat)', async () => {
    const { agent } = await signedUpAgent(app, { tag: 'delete' })
    await agent.post('/api/designs').send(makeDesign('d-delete'))

    const del = await agent.delete('/api/designs/d-delete')
    expect(del.status).toBe(200)
    expect(del.body).toEqual({ ok: true })
    expect((await agent.get('/api/designs/d-delete')).status).toBe(404)

    // Second delete of the same id is still ok (idempotent by design).
    expect((await agent.delete('/api/designs/d-delete')).status).toBe(200)
  })
})

describe('malformed payloads', () => {
  it('rejects designs without a string id with 400', async () => {
    const { agent } = await signedUpAgent(app, { tag: 'malformed' })

    expect((await agent.post('/api/designs').send({})).status).toBe(400)
    expect((await agent.post('/api/designs').send({ id: 42, name: 'nope' })).status).toBe(400)
    expect((await agent.post('/api/designs').send([1, 2, 3])).status).toBe(400)

    const named = await agent.post('/api/designs').send({ name: 'no id at all' })
    expect(named.status).toBe(400)
    expect(named.body).toEqual({ error: 'design with string id required' })
  })
})

describe('whole-home validation and revision protection', () => {
  it('requires a revision precondition for homes, including initial creation', async () => {
    const { agent } = await signedUpAgent(app, { tag: 'home-precondition' })
    const home = makeHouse('home-precondition')
    expect((await agent.post('/api/designs').send(home)).status).toBe(428)
    const created = await agent.post('/api/designs').set('X-Design-Revision', '0').send(home)
    expect(created.status).toBe(200)
    expect(created.headers['x-design-revision']).toBe('1')
    const loaded = await agent.get('/api/designs/home-precondition')
    expect(loaded.body).toEqual(home)
    expect(loaded.headers['x-design-revision']).toBe('1')
    const legacyOverwrite = await agent.post('/api/designs').send(makeDesign(home.id, { name: 'Old client overwrite' }))
    expect(legacyOverwrite.status).toBe(428)
    expect((await agent.get('/api/designs/home-precondition')).body).toEqual(home)
  })

  it('rejects malformed nested rooms and caps exactly one past each collection ceiling', async () => {
    const { agent } = await signedUpAgent(app, { tag: 'home-validation' })
    const valid = makeHouse('home-valid', 100)
    expect((await agent.post('/api/designs').set('X-Design-Revision', '0').send(valid)).status).toBe(200)
    const tooMany = makeHouse('home-too-many', 101)
    expect((await agent.post('/api/designs').set('X-Design-Revision', '0').send(tooMany)).status).toBe(400)
    const duplicate = makeHouse('home-duplicate', 2)
    duplicate.house.rooms[1].id = duplicate.house.rooms[0].id
    expect((await agent.post('/api/designs').set('X-Design-Revision', '0').send(duplicate)).status).toBe(400)
    const nested = makeHouse('home-nested')
    nested.house.rooms[0].design.house = nested.house
    expect((await agent.post('/api/designs').set('X-Design-Revision', '0').send(nested)).status).toBe(400)
    const badLevel = makeHouse('home-level')
    badLevel.house.rooms[0].level = 1
    expect((await agent.post('/api/designs').set('X-Design-Revision', '0').send(badLevel)).status).toBe(400)
    const badNumber = makeHouse('home-number')
    badNumber.house.rooms[0].design.corners[0].x = '0'
    expect((await agent.post('/api/designs').set('X-Design-Revision', '0').send(badNumber)).status).toBe(400)
    for (const [id, house] of [['home-null', null], ['home-array', []]]) {
      expect((await agent.post('/api/designs').set('X-Design-Revision', '0').send({ ...makeDesign(id), house })).status).toBe(400)
    }
    const levelLimit = makeHouse('home-level-limit')
    levelLimit.house.levels = Array.from({ length: 20 }, (_, index) => ({ label: `Level ${index}`, elevationCm: index * 300 }))
    expect((await agent.post('/api/designs').set('X-Design-Revision', '0').send(levelLimit)).status).toBe(200)
    levelLimit.id = 'home-level-over'
    levelLimit.house.levels.push({ label: 'Too high', elevationCm: 6000 })
    expect((await agent.post('/api/designs').set('X-Design-Revision', '0').send(levelLimit)).status).toBe(400)
    const furnitureLimit = makeHouse('home-furniture-limit')
    furnitureLimit.house.rooms[0].design.furniture = Array.from({ length: 100 }, (_, index) => ({
      id: `f${index}`, archetype: 'chair', category: 'chair', name: 'Chair',
      x: 1, z: 1, rotation: 0, w: 50, d: 50, h: 80, color: '#fff',
    }))
    expect((await agent.post('/api/designs').set('X-Design-Revision', '0').send(furnitureLimit)).status).toBe(200)
    furnitureLimit.id = 'home-furniture-over'
    furnitureLimit.house.rooms[0].design.furniture.push({
      id: 'f100', archetype: 'chair', category: 'chair', name: 'Chair',
      x: 1, z: 1, rotation: 0, w: 50, d: 50, h: 80, color: '#fff',
    })
    expect((await agent.post('/api/designs').set('X-Design-Revision', '0').send(furnitureLimit)).status).toBe(400)
  })

  it('lets one simultaneous save win and rejects the stale one without losing either payload', async () => {
    const { agent } = await signedUpAgent(app, { tag: 'home-race' })
    const id = 'home-race'
    const initial = makeHouse(id)
    expect((await agent.post('/api/designs').set('X-Design-Revision', '0').send(initial)).status).toBe(200)
    const a = { ...initial, name: 'Tab A' }
    const b = { ...initial, name: 'Tab B' }
    const results = await Promise.all([
      agent.post('/api/designs').set('X-Design-Revision', '1').send(a),
      agent.post('/api/designs').set('X-Design-Revision', '1').send(b),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const loaded = await agent.get(`/api/designs/${id}`)
    expect(loaded.headers['x-design-revision']).toBe('2')
    expect(['Tab A', 'Tab B']).toContain(loaded.body.name)
    expect((await agent.post('/api/designs').send(initial)).status).toBe(428)
    expect((await agent.post('/api/designs').set('X-Design-Revision', '0').send(initial)).status).toBe(409)
  })

  it('accepts the exact document byte ceiling and rejects one byte more', async () => {
    const { agent } = await signedUpAgent(app, { tag: 'home-bytes' })
    const home = makeHouse('home-size0')
    const bytesWithEmptyPadding = Buffer.byteLength(JSON.stringify({ ...home, padding: '' }))
    home.padding = 'x'.repeat(1_500_000 - bytesWithEmptyPadding)
    expect(Buffer.byteLength(JSON.stringify(home))).toBe(1_500_000)
    expect((await agent.post('/api/designs').set('X-Design-Revision', '0').send(home)).status).toBe(200)
    home.id = 'home-size1'
    home.padding += 'x'
    expect((await agent.post('/api/designs').set('X-Design-Revision', '0').send(home)).status).toBe(413)
  })
})

describe('cross-user isolation', () => {
  it("a user cannot read, overwrite, or delete another user's design", async () => {
    const alice = await signedUpAgent(app, { tag: 'alice' })
    const mallory = await signedUpAgent(app, { tag: 'mallory' })
    const design = makeDesign('d-owned-by-alice', { name: 'Alice room' })
    await alice.agent.post('/api/designs').send(design)

    // Read: invisible to another account.
    expect((await mallory.agent.get('/api/designs/d-owned-by-alice')).status).toBe(404)
    const malloryList = await mallory.agent.get('/api/designs')
    expect(malloryList.body).toEqual([])

    // Overwrite: refused with 403, and Alice's data is untouched.
    const overwrite = await mallory.agent
      .post('/api/designs')
      .send(makeDesign('d-owned-by-alice', { name: 'HIJACKED' }))
    expect(overwrite.status).toBe(403)
    expect(overwrite.body).toEqual({ error: 'forbidden' })

    // Delete: no-ops on someone else's row.
    await mallory.agent.delete('/api/designs/d-owned-by-alice')
    const still = await alice.agent.get('/api/designs/d-owned-by-alice')
    expect(still.status).toBe(200)
    expect(still.body.name).toBe('Alice room')
  })
})

describe('upsert ownership race (regression)', () => {
  it('reports an error — not { ok: true } — when a concurrent insert steals the id between check and upsert', async () => {
    // Interpose on the app's query function: the moment the route issues its
    // upsert (after its ownership pre-check has already passed), simulate a
    // concurrent request by inserting the contested id under another user.
    const hooks = { beforeUpsert: null }
    const hookedQuery = async (text, params) => {
      if (hooks.beforeUpsert && /ON CONFLICT \(id\) DO UPDATE/.test(text)) {
        const fn = hooks.beforeUpsert
        hooks.beforeUpsert = null
        await fn()
      }
      return query(text, params)
    }
    const raceApp = testApp({ query: hookedQuery })

    const alice = await signedUpAgent(raceApp, { tag: 'race-alice' })
    const bob = await signedUpAgent(raceApp, { tag: 'race-bob' })
    const contestedId = 'd-contested'

    hooks.beforeUpsert = async () => {
      await query(
        `INSERT INTO designs (id, user_id, name, shape, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [contestedId, bob.user.id, 'Bob won', 'rect', makeDesign(contestedId, { name: 'Bob won' })]
      )
    }

    const res = await alice.agent
      .post('/api/designs')
      .send(makeDesign(contestedId, { name: 'Alice tried' }))

    // The write was suppressed by the ON CONFLICT ... WHERE ownership re-check;
    // the response must say so instead of lying with { ok: true }.
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'forbidden' })
    expect(res.body.ok).toBeUndefined()

    // Bob's row survived untouched — Alice's payload was NOT saved anywhere.
    const { rows } = await query(`SELECT user_id, name FROM designs WHERE id = $1`, [contestedId])
    expect(rows).toHaveLength(1)
    expect(rows[0].user_id).toBe(bob.user.id)
    expect(rows[0].name).toBe('Bob won')
  })
})
