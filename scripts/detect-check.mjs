// Verifies the /api/detect endpoints against the committed fixtures.
// Requires the auth/designs server (with detect endpoints) running on :5181.
//   DETECT_BASE=http://host:port npm run check:detect   # point at another backend
import { waitForServer } from './lib/harness.mjs'

const BASE = process.env.DETECT_BASE || process.env.API_BASE || 'http://localhost:5181'
if (!(await waitForServer(BASE, { timeoutMs: 3000 }))) {
  console.error(`✗ backend not reachable at ${BASE} — start it (\`npm --prefix server start\`) or set DETECT_BASE.`)
  process.exit(2)
}
let fails = 0
const chk = (n, ok, e = '') => (ok ? console.log('  ✓', n) : (fails++, console.log('  ✗', n, e)))

async function j(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data }
}

// 1) GET a committed fixture → full result with proposals
const fx = await j('GET', '/api/detect/living-room-demo')
chk('GET fixture living-room-demo returns proposals', fx.status === 200 && fx.data?.status === 'ok' && Array.isArray(fx.data.proposals) && fx.data.proposals.length >= 2, JSON.stringify(fx.data)?.slice(0, 160))
chk('fixture proposals carry archetype_id + color', fx.data?.proposals?.[0]?.archetype_id && /^#[0-9a-fA-F]{6}$/.test(fx.data.proposals[0].color_hex || ''), JSON.stringify(fx.data?.proposals?.[0]))

// 2) GET unknown id → pending (never a crash)
const pend = await j('GET', '/api/detect/nonexistent-xyz-123')
chk('GET unknown id → status pending', pend.status === 200 && pend.data?.status === 'pending', JSON.stringify(pend.data))

// 3) POST a tiny image → request_id + files written
const onePxPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const post = await j('POST', '/api/detect', { imageBase64: onePxPng })
chk('POST /api/detect returns request_id', post.status === 200 && typeof post.data?.request_id === 'string', JSON.stringify(post.data))
if (post.data?.request_id) {
  const got = await j('GET', `/api/detect/${post.data.request_id}`)
  chk('new request GET → pending (no watcher running)', got.status === 200 && got.data?.status === 'pending', JSON.stringify(got.data))
}

console.log(`\n==== detect endpoints: ${fails === 0 ? 'ALL PASSED ✓' : fails + ' FAILED ❌'} ====`)
process.exit(fails ? 1 : 0)
