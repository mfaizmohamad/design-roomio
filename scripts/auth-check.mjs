// End-to-end auth + persistence: signup → me → save design → list → logout →
// login → reopen (full scene graph round-trips through Postgres) → cleanup.
//
// Needs the backend on :5181 AND Postgres. Uses the verification harness:
// Chrome resolved via CHROME/candidates (PIPE-3), and an ephemeral dev server
// (whose /api proxies to :5181) on a free port (PIPE-5). Set BASE to reuse one.
import { withBrowser, openPage } from './lib/browser.mjs'
import { withDevServer } from './lib/dev-server.mjs'

const run = (BASE) =>
  withBrowser(async (browser) => {
    let fails = 0
    const check = (n, ok, e = '') => (ok ? console.log('  ✓', n) : (fails++, console.log('  ✗', n, e)))

    const { page, pageErrors } = await openPage(browser, BASE, { settleMs: 1200 })

    const email = `e2e${Date.now()}@roomio.test`
    const password = 'secret123'

    // Drive auth + repository directly through the app's modules via fetch.
    const signup = await page.evaluate(async (email, password) => {
      const r = await fetch('/api/auth/signup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: 'E2E' }),
      })
      return { status: r.status, body: await r.json() }
    }, email, password)
    check('signup returns user', signup.status === 200 && signup.body.user?.email === email, JSON.stringify(signup))

    // me
    const me = await page.evaluate(async () => {
      const r = await fetch('/api/auth/me', { credentials: 'include' })
      return { status: r.status, body: await r.json() }
    })
    check('me authed after signup', me.status === 200, JSON.stringify(me))

    // Save a design through the server
    const design = {
      id: 'e2e-room-1',
      name: 'E2E Living Room',
      unit: 'ft',
      shape: 'l',
      corners: [{ x: 0, z: 0 }, { x: 600, z: 0 }, { x: 600, z: 400 }, { x: 0, z: 400 }],
      wallHeight: 270,
      wallThickness: 12,
      openings: [],
      materials: { wallColor: '#f4f1ea', floorTexture: 'walnut' },
      furniture: [{ id: 'f1', archetype: 'sofa-3', category: 'sofa', name: 'Sofa', x: 300, z: 320, rotation: 0, w: 210, d: 92, h: 84, color: '#7d8a99', locked: true }],
      createdAt: 1, updatedAt: 1,
    }
    const save = await page.evaluate(async (d) => {
      const r = await fetch('/api/designs', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })
      return { status: r.status, body: await r.json() }
    }, design)
    check('save design to server', save.status === 200 && save.body.ok, JSON.stringify(save))

    // List
    const list = await page.evaluate(async () => {
      const r = await fetch('/api/designs', { credentials: 'include' })
      return r.json()
    })
    check('server lists the saved design', Array.isArray(list) && list.some((d) => d.id === 'e2e-room-1'), JSON.stringify(list))

    // Logout
    const logout = await page.evaluate(async () => {
      const r = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      return r.status
    })
    check('logout ok', logout === 200)
    const meAfter = await page.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'include' })).status)
    check('me 401 after logout', meAfter === 401, `status=${meAfter}`)

    // Login again
    const login = await page.evaluate(async (email, password) => {
      const r = await fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      return r.status
    }, email, password)
    check('login again ok', login === 200)

    // Reopen the design — full scene graph round-trips through Postgres
    const reopened = await page.evaluate(async () => {
      const r = await fetch('/api/designs/e2e-room-1', { credentials: 'include' })
      return { status: r.status, body: await r.json() }
    })
    const d = reopened.body
    check(
      'reopen restores full scene graph from PG',
      reopened.status === 200 && d.shape === 'l' && d.furniture?.length === 1 && d.furniture[0].locked === true && d.materials.floorTexture === 'walnut',
      JSON.stringify(d).slice(0, 200),
    )

    // cleanup
    await page.evaluate(async () => fetch('/api/designs/e2e-room-1', { method: 'DELETE', credentials: 'include' }))

    check('no page errors', pageErrors.length === 0, pageErrors.join(' | '))

    console.log(`\n==== auth/persistence: ${fails === 0 ? 'ALL PASSED ✓' : fails + ' failed ❌'} ====`)
    return fails
  }, { windowSize: '1680,1000' })

const fails = process.env.BASE ? await run(process.env.BASE) : await withDevServer(({ url }) => run(url))
process.exit(fails ? 1 : 0)
