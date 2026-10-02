/**
 * The public demo's last line of defence against shipping a client's name or
 * scraped personal data (scripts/lib/demo-leaks.mjs). Nothing in the demo
 * visibly depends on this check, so these tests pin each rule.
 */
import { describe, it, expect } from 'vitest'
import { beaconProblem, cspProblem, datasetNeedles, findLeaks } from './lib/demo-leaks.mjs'
import { analyticsBeacon, buildDemoCsp, sentryOrigin } from './lib/demo-csp.mjs'

const js = (text, path = 'assets/index-abc.js') => ({ path, text })

describe('findLeaks', () => {
  it('passes clean engine-like output', () => {
    const clean = 'const a=1e-7,b=0.30000000000000004,c=4294967295;new WebGLRenderer({antialias:!0})'
    expect(findLeaks([js(clean)])).toEqual([])
  })

  it('flags the client name in any case', () => {
    for (const s of ['Embercrest 3BHK', 'EMBERCREST', 'id:"embercrest"']) {
      expect(findLeaks([js(s)]).map((l) => l.rule)).toContain('client name/source')
    }
  })

  it('flags source-document citations', () => {
    expect(findLeaks([js('Duplex.pptx slide 1')])).not.toEqual([])
    expect(findLeaks([js('A/B flat 504')])).not.toEqual([])
  })

  it('flags facebook URLs and post-id-length digit runs', () => {
    expect(findLeaks([js('https://www.facebook.com/groups/x')]).map((l) => l.rule)).toContain('facebook URL')
    expect(findLeaks([js('["4551035318554515"]')]).map((l) => l.rule)).toContain('Facebook-style post id')
  })

  it('does not treat engine number literals or 14-digit strings as post ids', () => {
    // Both of these really occur in the three/r3f chunks.
    expect(findLeaks([js('Number.MAX_SAFE_INTEGER+1===9007199254740992;e=8000000000000000')])).toEqual([])
    expect(findLeaks([js('x="45510353185545"')])).toEqual([])
  })

  it('flags app public/ listing files by path, even when binary', () => {
    const rules = findLeaks([
      { path: 'listings.json', text: '{}' },
      { path: 'images/123/0.jpg', text: null },
      { path: 'renders/default/2BHK.jpg', text: null },
    ]).map((l) => l.path)
    expect(rules).toEqual(['listings.json', 'images/123/0.jpg', 'renders/default/2BHK.jpg'])
  })

  it('flags exact values from the scraped dataset', () => {
    const leaks = findLeaks([js('call 98200 12345 now')], ['98200 12345'])
    expect(leaks).toEqual([{ path: 'assets/index-abc.js', rule: 'scraped dataset value', match: '98200 12345' }])
  })
})

describe('datasetNeedles', () => {
  it('collects ids, permalinks and phones (as written and as bare digits)', () => {
    const needles = datasetNeedles({
      group: { id: '1792860891038652', url: 'https://www.facebook.com/groups/1792860891038652' },
      listings: [{ id: 'L4550924078565639', postId: '4550924078565639', permalink: 'https://fb/x/4550924078565639', phones: ['+91 98200-12345'] }],
    })
    expect(needles).toEqual(expect.arrayContaining([
      '1792860891038652', 'L4550924078565639', '4550924078565639', 'https://fb/x/4550924078565639',
      '+91 98200-12345', '9820012345',
    ]))
  })

  it('drops short values and tolerates a malformed document', () => {
    expect(datasetNeedles({ listings: [{ id: 'ab', phones: ['123', null] }] })).toEqual([])
    expect(datasetNeedles(null)).toEqual([])
    expect(datasetNeedles({ listings: 'nope' })).toEqual([])
  })
})

describe('cspProblem', () => {
  const page = (content) => `<head><meta http-equiv="Content-Security-Policy" content="${content}" /></head>`

  it('accepts the demo policy', () => {
    expect(cspProblem(page("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"))).toBeNull()
  })

  it('rejects a page with no CSP (the hook-ordering regression)', () => {
    expect(cspProblem('<head><!--DEMO_CSP--></head>')).toMatch(/no Content-Security-Policy/)
    expect(cspProblem(undefined)).toMatch(/no Content-Security-Policy/)
  })

  it('rejects a script-src that allows anything beyond the allow-list', () => {
    expect(cspProblem(page("default-src 'self'"))).toMatch(/no script-src/)
    expect(cspProblem(page("script-src 'self' 'unsafe-inline'"))).toMatch(/allows more than/)
    expect(cspProblem(page("script-src 'self' https://cdn.example.com"))).toMatch(/allows more than/)
  })
})

describe('buildDemoCsp / sentryOrigin', () => {
  it('without a DSN allows only self plus the Cloudflare analytics origins', () => {
    const csp = buildDemoCsp()
    expect(csp).toContain("script-src 'self' https://static.cloudflareinsights.com;")
    expect(csp).toContain("connect-src 'self' data: blob: https://cloudflareinsights.com;")
    expect(csp).not.toMatch(/sentry/)
    expect(cspProblem(`<meta http-equiv="Content-Security-Policy" content="${csp}" />`)).toBeNull()
  })

  it('adds exactly the DSN origin to connect-src — never a wildcard', () => {
    const csp = buildDemoCsp({ sentryDsn: 'https://abc123@o4507.ingest.us.sentry.io/4508' })
    expect(csp).toContain('https://o4507.ingest.us.sentry.io')
    expect(csp).not.toContain('*')
    expect(csp).not.toMatch(/script-src[^;]*sentry/)
  })

  it('rejects a malformed or non-https DSN instead of shipping a reporter the CSP blocks', () => {
    expect(sentryOrigin(undefined)).toBeNull()
    expect(sentryOrigin('')).toBeNull()
    expect(() => sentryOrigin('not a url')).toThrow(/valid URL/)
    expect(() => sentryOrigin('http://abc@o1.ingest.sentry.io/1')).toThrow(/https/)
    expect(() => sentryOrigin('https://o1.ingest.sentry.io/1')).toThrow(/https/)
    expect(() => sentryOrigin('https://abc@o1.ingest.sentry.io/not-a-project')).toThrow(/https/)
  })

  it('cspProblem accepts the analytics beacon but nothing else in script-src', () => {
    const page = (c) => `<meta http-equiv="Content-Security-Policy" content="${c}" />`
    expect(cspProblem(page("script-src 'self' https://static.cloudflareinsights.com"))).toBeNull()
    expect(cspProblem(page("script-src 'self' https://static.cloudflareinsights.com https://evil.example"))).toMatch(/evil\.example/)
    expect(cspProblem(page("script-src 'self' 'unsafe-eval'"))).toMatch(/unsafe-eval/)
  })
})

describe('beaconProblem (Cloudflare Web Analytics)', () => {
  it('accepts the beacon the build injects', () => {
    expect(beaconProblem(`<body><div id="root"></div>${analyticsBeacon()}</body>`)).toBeNull()
  })

  it('flags a page where the beacon went missing — the dashboard would silently go flat', () => {
    expect(beaconProblem('<body><div id="root"></div></body>')).toMatch(/no Cloudflare Web Analytics beacon/)
    expect(beaconProblem(undefined)).toMatch(/no Cloudflare Web Analytics beacon/)
  })

  it('flags a wrong token or a beacon loaded from somewhere else', () => {
    expect(beaconProblem(analyticsBeacon('00000000000000000000000000000000'))).toMatch(/token/)
    expect(beaconProblem(analyticsBeacon().replace('static.cloudflareinsights.com', 'evil.example'))).toMatch(/unexpected URL/)
  })
})
