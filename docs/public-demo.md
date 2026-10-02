# Public demo: 3D duplex tour

A static website that anyone can open: a landing page at `/` and an interactive 3D
tour of a sample 3 BHK duplex at `/tour`. It has no backend, no login, no database
and no listings. It is the public face of the rendering engine; the full app stays
private until the launch plan (`docs/LAUNCH_PLAN.md`) is done.

```bash
npm run dev:demo       # local dev server (http://localhost:5180)
npm run build:demo     # build to dist-demo/ + leak check + size budget
npm run preview:demo   # serve the built dist-demo/ locally (CSP enforced)
npm run deploy:demo    # build:demo, then upload to Cloudflare Pages
```

## What is and is not in it

| In the demo | Kept out, and how |
| --- | --- |
| The duplex geometry we modelled, as **"Sample Duplex"** | The client's name, source documents and area claims. `src/demo/homes.ts` builds the home from `EMBERCREST_LEVELS` (geometry only), and the build swaps in that registry instead of `src/data/homes/index.ts` |
| Procedural furniture and finishes | The third-party sample chair GLB (`assetRef` removed) |
| Landing page, 3D view, floor plan, room list | The editor, login, listings, photo scan, developer workspace and every `/api` call. The demo has its own entry (`demo.html` → `src/demo/main.tsx`) that never imports `App` |
| `demo/public/` (favicon, `_headers`) | The app's `public/`: scraped listings, their photos and listing renders. `publicDir` points at `demo/public` |
| | Tables keyed by scraped Facebook post ids (`listingFlats`, `inferredScenes`), replaced by the stubs in `src/demo/stubs/` |

`npm run build:demo` fails if any of that leaks back in (`scripts/demo-leak-check.mjs`,
rules in `scripts/lib/demo-leaks.mjs`). The check scans the build output for the
client's name and source citations, Facebook URLs and post ids, every id, phone
number and permalink in `public/listings.json`, and the app's listing paths. It
also fails if `index.html` ships without its CSP. Without the module swaps the
check reports the client's name plus 18 post ids. If it fails, remove the import
that caused it. Do not loosen the rule.

## Deploying to Cloudflare Pages

**Automatic (the normal path).** Every merge to `main` runs
`.github/workflows/deploy-demo.yml`. It runs `npm run build:demo`, which includes
the typecheck, leak check and size budget, and then publishes `dist-demo/` as
the **production** deployment at https://roomio-demo.pages.dev. If any gate
fails, nothing is uploaded and the previous version stays live. To redeploy
without a merge, use Actions → "Deploy public demo" → Run workflow.

One-time setup: add two repository secrets (Settings → Secrets and variables →
Actions):

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Shown by `npx wrangler@4 whoami` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token, permission **Account › Cloudflare Pages › Edit**, scoped to this account |

**Production branch.** The Pages project was created with its production branch
set to `roomio-main`, so the workflow deploys with `--branch roomio-main`. Pages
compares that flag to the project setting: a match publishes to production, and
anything else is only a preview. If you change the setting in the dashboard
(roomio-demo → Settings → Builds & deployments), change the flag in the workflow
to match.

**Manual previews.** Run `npm run deploy:demo` from a feature branch (after
`npx wrangler@4 login` once). It uploads a preview at
`https://<branch>.roomio-demo.pages.dev` and does not touch production.

**Rollback.** Every deployment is kept. In the dashboard, open roomio-demo →
Deployments, pick an older one, then choose ⋯ → Rollback.

## Analytics, errors and the footer

**Visitor analytics: Cloudflare Web Analytics.** No cookies, no personal data,
free. To turn it on, go to the Cloudflare dashboard → Workers & Pages →
roomio-demo → Metrics → Web Analytics → **Enable**. Pages then injects the
beacon into every page itself, with no code change. The CSP already allows
exactly its two origins (`static.cloudflareinsights.com` for the script,
`cloudflareinsights.com` for reports). Visits, top pages, countries and Core Web
Vitals appear under that project's Metrics tab.

**Error tracking: Sentry (optional).** Set the repository *variable*
`SENTRY_DSN` (Settings → Secrets and variables → Actions → Variables) to the DSN
of a Sentry "Browser JavaScript" project. A DSN is public by design, so it is a
variable, not a secret. The next merge to `main` builds it in. If it is unset,
the demo ships no Sentry code and no Sentry origin in its CSP.
- `src/demo/errorBuffer.ts` loads with the page and catches uncaught errors,
  unhandled rejections, render errors caught by an ErrorBoundary, and WebGL
  context loss.
- It sends at most **10 distinct errors per page view**, and repeats are
  dropped. A crash inside the 3D render loop fires every frame, and without this
  cap one bad GPU could use up the free quota (5,000 errors/month) in minutes.
- `src/demo/monitoring.ts` (Sentry SDK, about 31 KB gzip) loads only after the
  page has loaded and the browser is idle, then sends whatever was captured.
- Sent: the error, its stack, browser/OS, the GPU string (tag `gpu`), the kind
  (tag `kind`) and the release (git SHA). Not sent: IP address, cookies,
  headers, query strings, session replay or performance traces
  (`dataCollection` in `monitoring.ts`). For extra safety, also enable
  Sentry → Project Settings → Security & Privacy → "Prevent Storing of IP
  Addresses".
- CSP: connect-src gets exactly the DSN's own origin, never `*.sentry.io`.
  A malformed DSN fails the build (`scripts/lib/demo-csp.mjs`).

**Footer.** `© <year> Roomio`, plus Contact (mailto) and LinkedIn links from
`src/demo/site.ts`. A link whose value is empty or invalid is not shown, so the
footer degrades to just the © line.

**Routing.** There is no `404.html`, so Pages serves `index.html` for unknown
paths. That is what makes a direct link or a reload on `/tour` work. Adding a
`404.html` to `demo/public/` would break `/tour`.

**Headers.** `demo/public/_headers` blocks framing, sets `nosniff` and a
referrer policy, and caches the content-hashed `/assets/*` for a year. The main
CSP is a `<meta>` injected at build time (`vite.demo.config.ts`), so local
`preview:demo` enforces the same policy as production.

**Custom domain.** In the Pages project, go to Custom domains → Set up a domain.

## Verified

On 2026-10-01 the built site was served with `preview:demo` and driven in headless
Chromium at desktop (1440×900) and phone (390×844) sizes. Results: the landing page
links into the tour, the 3D render is not blank, all 20 rooms are listed, and the
floor plan works. There were no console errors, page errors or failed requests
with the CSP enforced, and the page text never mentions the client. First load is
51.6 KB gzipped; the 3D engine loads only when the tour opens.
