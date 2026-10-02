// Build config for the PUBLIC DEMO: a static site (landing page + one unbranded 3D
// duplex tour) with no API, no login and no listings. Output: dist-demo/, deployed
// to Cloudflare Pages (docs/public-demo.md).
//
//   npm run dev:demo      local dev server
//   npm run build:demo    build + leak check + size budget
//
// It reuses vite.config.ts (dedupe + manualChunks matter just as much here) and
// changes four things: entry, public dir, module swaps and the CSP.
import { resolve } from 'node:path'
import { defineConfig, loadEnv, mergeConfig, type Plugin } from 'vite'
import { analyticsBeacon, buildDemoCsp } from './scripts/lib/demo-csp.mjs'
import base from './vite.config'

const r = (p: string) => resolve(__dirname, p)

// Modules the shared 3D code imports that carry data which must not be public:
// the client-named home registry and two tables keyed by scraped Facebook post ids.
// Swapping by RESOLVED path (not by import specifier) catches every spelling of
// the import ('../data/homes', './homes/index', …); a specifier alias would miss
// one sooner or later and silently ship the original. scripts/demo-leak-check.mjs
// is the backstop if a new module starts carrying such data.
const SWAPS: Record<string, string> = {
  [r('src/data/homes/index.ts')]: r('src/demo/homes.ts'),
  [r('src/data/listingFlats.ts')]: r('src/demo/stubs/listingFlats.ts'),
  [r('src/data/inferredScenes.ts')]: r('src/demo/stubs/inferredScenes.ts'),
}

// The CSP itself lives in scripts/lib/demo-csp.mjs (shared with the post-build
// check). Build-only, because the dev server injects an inline React-refresh
// script that script-src 'self' would (correctly) block. It is a <meta> rather
// than only a _headers rule so `vite preview` enforces it too and a violation
// shows up in local verification before production.
const CSP_MARKER = /<!--DEMO_CSP[^>]*-->/

function publicDemo(csp: string): Plugin {
  return {
    name: 'roomio-public-demo',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved) return null
      const swap = SWAPS[resolved.id.split('?')[0]]
      // The stubs re-export TYPES from the originals; never swap an import that
      // comes from the replacement itself or we would point it back at itself.
      if (swap && importer !== swap) return swap
      return null
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        // Dev server: leave the marker, no CSP. Test ctx.server, NOT ctx.bundle — in
        // the 'pre' phase ctx.bundle is undefined during builds too, which silently
        // shipped a build without a CSP.
        if (ctx.server) return html
        if (!CSP_MARKER.test(html)) throw new Error('demo.html lost its <!--DEMO_CSP--> marker; refusing to build without a CSP')
        return html.replace(CSP_MARKER, `<meta http-equiv="Content-Security-Policy" content="${csp}" />`)
      },
    },
    // Rollup names the page after its input (demo.html); static hosts serve index.html.
    // order 'post': vite's own HTML plugin emits the page during generateBundle,
    // so a normal-order hook runs before the page exists and renames nothing.
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const page = bundle['demo.html']
        if (!page) throw new Error('demo build emitted no demo.html')
        page.fileName = 'index.html'
      },
    },
    // Dev only: serve demo.html for the landing page and the tour route, mirroring
    // Cloudflare Pages' fallback to index.html for unknown paths.
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = (req.url ?? '/').split('?')[0]
        if (path === '/' || path === '/index.html' || /^\/tour\/?$/.test(path)) req.url = '/demo.html'
        next()
      })
    },
  }
}

/**
 * Cloudflare Web Analytics beacon, appended to the BUILT page only so local dev
 * visits are never counted. Order 'post' so vite's own HTML pipeline has already
 * run and never treats the external module script as something to bundle. The CSP
 * (scripts/lib/demo-csp.mjs) allows exactly this script and its report origin, and
 * scripts/demo-leak-check.mjs fails the build if the beacon goes missing.
 */
function webAnalytics(): Plugin {
  return {
    name: 'roomio-demo-web-analytics',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.server) return html
        if (!html.includes('</body>')) throw new Error('demo page has no </body>; cannot add the analytics beacon')
        return html.replace('</body>', `  ${analyticsBeacon()}\n  </body>`)
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  // VITE_SENTRY_DSN comes from the environment (CI: the SENTRY_DSN repo variable)
  // or a local .env file. It decides whether the CSP allows the Sentry origin; the
  // DSN is public by design (it can only submit events), so it is not a secret.
  const env = loadEnv(mode, __dirname, 'VITE_')
  const csp = buildDemoCsp({ sentryDsn: env.VITE_SENTRY_DSN })
  return mergeConfig(base, {
  plugins: [publicDemo(csp), webAnalytics()],
  // Only the files listed in demo/public are copied. The app's public/ holds the
  // scraped listings, their mirrored photos and listing renders, which must never
  // be deployed with the demo.
  publicDir: r('demo/public'),
  build: {
    outDir: r('dist-demo'),
    emptyOutDir: true,
    rollupOptions: { input: r('demo.html') },
  },
  })
})
