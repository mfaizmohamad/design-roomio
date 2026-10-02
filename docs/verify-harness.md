# Verification harness (`scripts/lib/harness.mjs`)

A small, reusable toolkit so fix agents stop re-writing the same puppeteer +
dev-server boilerplate on every task. Drive a route, screenshot it, collect the
console/page/network errors, and get a pixel-level "is this render actually
real" verdict — in three lines.

## 1. The common work (surveyed across every existing verification script)

Every ad-hoc puppeteer script under `scripts/*.mjs` and
`.claude/worktrees/agent-*/**/*.mjs` re-implements the same primitives, usually
by copy-paste:

| Primitive | Where it's duplicated | Problem it caused |
| --- | --- | --- |
| **Chrome path** | `browser/auth/lock-check` hardcode `/Applications/Google Chrome.app/...`; `regen-screenshots` has a better candidate list; glazing/tv-spawn scripts hardcode it too | **PIPE-3** — dies on any non-default install; no `CHROME` override in half of them |
| **Chrome launch flags** | `--no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist [--window-size]` pasted into ~8 scripts | drift; someone forgets `--enable-unsafe-swiftshader` and WebGL silently fails |
| **Spawn dev server + wait-until-ready** | `regen-screenshots` (`:5191`/`PORT`), `shoot-listing-replica` (`:5191`), responsive (`:5306`), tv-spawn (`:5313`), glazing (`:5314`) | **PIPE-5** — hardcoded ports collide (5180/5191/5312/5314/5317 were all live during this task); `stdio:'ignore'` **swallows vite's stderr**, so a failed boot looks like a timeout with no reason |
| **Navigate + settle a WebGL scene** | `page.goto(..., {waitUntil})` then `sleep(1200…9000)`; sometimes `waitForSelector('canvas')` | timing folklore copied around; SwiftShader needs generous settles (path tracer's first sample ≈ 20s) |
| **Collect console / pageerror / failed requests** | `page.on('console'|'pageerror'|'requestfailed')` + a noise filter (`favicon\|401\|404\|DevTools\|Failed to load resource`) | every script re-derives the same noise regex, inconsistently |
| **Screenshot to a dir** | `mkdirSync(recursive)` + `page.screenshot({path})` / `{clip}` | fine, but paired with... |
| **"Is the shot real?" check** | *nothing formal* — `regen`'s "keep old image on FAIL", `shoot-listing`'s `hideChrome()` | blank/black/HUD-contaminated shots can publish silently |
| **Teardown** | `try/finally { browser.close(); server.kill() }` | leaked chrome/vite processes when someone forgets |
| **Store bridge** | `window.__roomio.getState()` (exposed at `src/store.ts:604`) | app-specific, left to callers |

Known-good facts baked into the harness defaults (from `shared/LEARNINGS.md`):
- Chrome flags above are the verified SwiftShader-headless set.
- Spawn a **fresh** dev server per run with `--strictPort`; never drive a
  long-running HMR'd server via in-page `import('/src/...')` (dual-store gotcha).
- Give WebGL scenes a long settle; frame-count animations run seconds-per-frame
  under SwiftShader.
- The listings page scrolls an **inner container**, not `window` — lazy images
  below the fold read as "broken" unless you scroll the container or fetch URLs.

## 2. API surface (`scripts/lib/`)

Split into pure-logic files (no puppeteer, unit-tested) + a browser file:

- **`chrome.mjs`** — `resolveChrome({env,exists,candidates}?)` (honors
  `CHROME`/`CHROME_PATH`, else candidate fallback, else throws listing every
  path it tried), `CHROME_FLAGS`, `CHROME_CANDIDATES`. *(fixes PIPE-3)*
- **`net.mjs`** — `getFreePort()`, `waitForServer(url,{timeoutMs})`,
  `isValidPort(p)`. *(free ports fix PIPE-5)*
- **`png.mjs`** — dependency-free PNG decoder (`decodePng`), `pngStats`, and
  `assertRenderQuality(pngPathOrBuffer,{notBlank,notBlack,noHudCorners,...})`
  returning `{ok, failures[], stats, corners}`.
- **`dev-server.mjs`** — `startDevServer({port?,cwd?})` → picks a FREE port when
  none given, launches vite `--strictPort`, **surfaces captured stderr on
  failure**, waits for a real HTTP response, returns `{url, port, stop()}`;
  `withDevServer(fn)`. *(fixes PIPE-5 + the swallowed-stderr trap)*
- **`browser.mjs`** — `launchBrowser({chrome?,windowSize?})`, `withBrowser(fn)`,
  `openPage(browser, url, {viewport,waitForCanvas,settleMs,ignore})` →
  `{page, consoleErrors, pageErrors, failedRequests, critical()}`, and
  `shoot(page, outPath, {clip})`.
- **`harness.mjs`** — barrel that re-exports all of the above.

CLI + npm scripts (`scripts/verify.mjs`):
- `npm run verify:route -- '/?preset=gamer' [more routes…]` — starts an
  ephemeral dev server, opens each route, screenshots to `verify-out/harness/`,
  prints console/page/network errors + a quality verdict, exits non-zero on any
  critical error or blank/black shot. `BASE=http://…` reuses a running server.
- `npm run verify:smoke` — the curated route set (`/`, step1/2, furnish,
  listings) through the same path.

## 3. How a future fix agent uses it (3 lines)

```js
import { withDevServer, withBrowser, openPage, shoot, assertRenderQuality } from './lib/harness.mjs'
await withDevServer(async ({ url }) => withBrowser(async (browser) => {
  const { page, critical } = await openPage(browser, `${url}/?stage=furnish&seed=1`, { waitForCanvas: true, settleMs: 3500 })
  const buf = await shoot(page, 'verify-out/furnish.png')
  console.log(assertRenderQuality(buf, { notBlank: true, notBlack: true }), critical())
}))
```

Or skip the code entirely: `npm run verify:route -- '/?stage=furnish&seed=1'`.

## 4. Migration (proves the harness, kills PIPE-3/5/6)

Refactored to consume the harness (Chrome resolver + ephemeral/env ports):
`browser-check.mjs`, `auth-check.mjs`, `lock-check.mjs`, `detect-check.mjs`,
`regen-screenshots.mjs`. Each now: uses `resolveChrome()` (no hardcoded path),
starts an ephemeral dev server when `BASE` isn't given (no hardcoded port), and
surfaces vite stderr on a failed boot.

- **PIPE-3** — fixed: no script hardcodes the macOS Chrome path anymore.
- **PIPE-5** — fixed: dev servers pick a free port (or honor `BASE`/`PORT`).
- **PIPE-6** — fixed in `regen-screenshots.mjs`: the `KEEP=1` flag is now real.
  Captured shots run through `assertRenderQuality` (notBlank/notBlack); a
  blank/black capture is treated like a FAIL and the old image is kept, **unless
  `KEEP=1`**, which writes the new capture anyway (for debugging a bad shot).

### Deliberately NOT touched
`scripts/shoot-listing-replica.mjs` is owned by another agent on
`fix/render-pipeline-verify`. The harness API is intentionally shaped so that
script can adopt it later with no behavior change: its inline Chrome path →
`resolveChrome()`, its `:5191` spawn+poll → `startDevServer()`, its
`hideChrome()` + screenshot → `shoot()` + `assertRenderQuality({noHudCorners})`.

`src/`, `server/`, `public/renders/` are out of scope for this task.
