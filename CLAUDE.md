# Roomio — engineering rulebook

Rules for any agent or human writing code here. `docs/agent-orientation.md` says
**where** things live; this file says **how** to change them.

Roomio was built fast by many parallel agents. That shows: the tests and the
comments are unusually good, the module boundaries are not. These rules exist to
keep the first two and steadily repair the third.

---

## 0. Non-negotiables

1. **The green bar must be green before you hand work back.** Not "should pass" —
   run it.
   ```
   npm run typecheck     # tsc -b --noEmit
   npm test              # full vitest workspace: root + 6 islands (725 tests)
   npm run build         # tsc -b && vite build
   npm run lint          # ESLint; 0 errors required (warnings are pre-existing debt)
   npm run check:size    # bundle budget — fails if the 3D engine lands in first load
   npm test --prefix server   # 68 tests; needs a local Postgres
   ```
   If you cannot run a gate, say so explicitly. Never report "tests pass" for a
   suite you did not execute.

2. **Never commit to `main`.** `.githooks/pre-commit` blocks it. Branch, then PR.

3. **Never weaken a security control to make a test pass.** If a test fails
   against a new control, the test encodes the old behaviour — fix the test and
   say why in the diff.

4. **Track work in beads (`bd`), not in ad-hoc TODO lists.** See §6.

---

## 1. Comments: explain *why*, and name the failure

This repo's best asset is that its comments record the bug each decision
prevents. Match that. A comment that restates the code is noise; a comment that
records the failure mode is what stops the next agent from "simplifying" a load-
bearing line.

Do this — a real example from `vite.config.ts`:

```ts
// Rollup/Vite VIRTUAL helper modules (\0vite/preload-helper…) are shared by eager
// and lazy chunks alike. Left unassigned, Rollup may colocate them INSIDE a lazy
// chunk (observed: preload-helper landed in r3f), which makes the entry statically
// import that chunk — un-splitting the bundle. Pin them to the eager vendor chunk.
```

It names the mechanism, the observed symptom, and the consequence. Not this:

```ts
// assign virtual modules to the vendor chunk
```

**Rule:** any line whose removal would silently reintroduce a bug gets a comment
naming that bug. Especially: ordering constraints, caps and limits, `dedupe`
entries, `unref()`, cache keys, and anything with the word "race" near it.

---

## 2. Security rules

These are the rules the current hardening pass established. Breaking one is a
release blocker, not a review nit.

**Input and trust**
- Every SQL statement stays parameterised (`$1`, `$2`). There is no string-built
  SQL anywhere in `server/` — keep it that way.
- Validate the *type* before the *value*: `typeof x !== 'string'` first, then the
  regex. A regex test against a non-string is a coercion bug waiting to happen.
- Any id that reaches the filesystem is matched against `ID_RE` first. Path
  traversal in `/api/detect/:id` is one missing check away.
- Never trust `X-Forwarded-For` unless `TRUST_PROXY` says a proxy is really in
  front. Trusting it with no proxy lets any caller forge their IP past the rate
  limiters.

**Output**
- **No `dangerouslySetInnerHTML`.** It was removed from `Flythrough.tsx`; do not
  reintroduce it. If you need a bold lead-in, use JSX (`<b>{label}</b> {body}`).
  The old code was not exploitable *only* because the strings were literals — one
  interpolated room or listing name would have made it an XSS.
- Never put a user-controlled string into `innerHTML`, `eval`, `new Function`, or
  a `<script>`/`<style>` body.
- API error messages say what is wrong, never how the internals work. No stack
  traces, SQL text, or file paths in a response body.

**Authentication and sessions**
- Session ids come from `randomUUID()`. Never `Math.random()`, never a counter,
  never a hash of user data.
- The session cookie stays `httpOnly` + `SameSite=Lax` + `Secure` in production.
  These three are tested in `server/test/auth.test.js` — if you change cookie
  handling, that suite is the contract.
- Login returns **one** generic 401 for both "no such user" and "wrong password".
  Never split them, however much nicer the UX would be.
- Password bounds are min 8 characters and max 72 **bytes** (bcrypt's real input
  limit — measure with `Buffer.byteLength`, not `.length`).
- `BCRYPT_ROUNDS` is 12 in production. Lower it only in test config.

**Resource limits — every unauthenticated or user-driven write needs a ceiling**
Each of these exists because its absence is a way to fill the disk, the database,
or the event loop:
  - per-IP rate limit (`authLimiter`, `detectLimiter`, `globalLimiter`)
  - request body cap (2 MB global, 15 MB for `/api/detect` only)
  - decoded-byte cap (`DETECT_MAX_BYTES`) and queue ceiling (`DETECT_MAX_PENDING`)
  - per-user row cap (`MAX_DESIGNS_PER_USER`)

  **When you add a route that writes anything, add its ceiling in the same PR.**

**Secrets**
- No credentials, tokens, or connection strings in the tree. Everything is an env
  var, documented in `server/.env.example`. `.env` is gitignored.
- Committing personal data counts as committing a secret. See §5.

**Dependencies**
- `npm audit --omit=dev` must be clean for anything that ships to users. Dev-only
  advisories get a ticket, not a release block.

---

## 3. TypeScript and code style

- `strict` is on. Do not add `any` to get past an error — model the type, or use
  `unknown` plus a narrowing check (`coerceSummaries` in `src/repository.ts` is
  the pattern to copy).
- Match the surrounding file. This codebase uses no semicolons, single quotes,
  2-space indent, and arrow consts for helpers. There is no formatter yet, so
  *reading the neighbouring lines* is the style guide.
- Prefer a named helper over a clever expression. `toEpochMs`, `publicUser`,
  `intEnv` in `server/app.js` are the right granularity.
- Data validated at a boundary gets a coercion function, not a cast. Anything
  crossing `localStorage`, the network, or a JSON file is untrusted input —
  `coerceDesign` exists for exactly this and cloud reads go through it too.
- Keep exported functions documented with a JSDoc block that states the contract,
  including what `null` means versus what throws.

---

## 4. Testing

- **Every behaviour a security control provides gets a test**, because nothing in
  the product visibly depends on it and it will otherwise be refactored away.
  `server/test/hardening.test.js` is the model.
- Test the boundary, not just the happy path: exactly-at-the-limit, one-past,
  wrong type, and the multi-byte case.
- A bug fix lands with the test that would have caught it. The repo already does
  this well (`collision.test.ts`, the designs upsert race) — keep it up.
- Tests run offline with no network, no daemon, and no fixtures to download. The
  root workspace must stay runnable with nothing but `npm ci`.
- Server tests need Postgres and therefore stay **out of** `vitest.workspace.ts`.
  CI gates them in a separate job. This is deliberate — do not "fix" it by adding
  them to the workspace.
- Adding a workspace with tests? Register it in `vitest.workspace.ts` or CI will
  not gate it.

---

## 5. Data and privacy

`public/listings.json` holds **real scraped Facebook rental posts**, including
phone numbers of real people and permalinks to their posts.

- Treat it as production personal data, not as fixtures.
- **Do not add more scraped personal data to the tree.**
- Nothing that identifies a real person may reach a public deployment without an
  explicit decision to publish it. Before launch this data must be anonymised or
  replaced with synthetic listings (tracked in beads).
- `scripts/fb-cookies.*` are gitignored. Keep it that way.

---

## 6. Working with beads (`bd`)

Issue tracking lives in beads, backed by Dolt in `.beads/`.

```bash
bd ready                 # what is unblocked right now
bd show <id>             # full detail
bd update <id> --claim   # take it
bd close <id>            # finish it
bd create "title" -t bug -p 1 -d "..."
```

- File a bead for follow-up work you discover but do not do. "I noticed X" with
  no bead means X is lost.
- Link real dependencies with `bd dep` so `bd ready` stays honest.
- Hooks live in `.githooks/` (canonical, committed) and source
  `.githooks/_beads.sh`. `bd init` writes a competing copy into `.beads/hooks/`
  and repoints `core.hooksPath` at it — if that happens again, run
  `git config core.hooksPath .githooks`. Note that `bd init` appends its
  integration block *after* the existing `exit 0`, where it never runs; the
  bridge in `.githooks/` is what actually wires beads up.

---

## 7. Architecture: the island layout

`camera-flythrough/ lighting/ multi-room/ persistence/ rendering/ texturing/` are
sibling "islands", each with its own `package.json`, vite and vitest config, and
each imported by the app in `src/`.

This is scaffolding from the parallel-agent build, not a design. Rules while it
exists:

- **Do not add a new island.** New work goes in `src/` or `shared/lib/`.
- Cross-island imports must be listed in `vite.config.ts`'s `resolve.dedupe`, or
  a second copy of React/three loads and you get *"Hooks can only be used within
  the Canvas component"* at runtime with a clean typecheck.
- Shared logic belongs in `shared/lib/`, never copy-pasted between islands.
- Island `dist/` directories are build output. Never import from one.

---

## 8. Performance budget

The 3D payload is the product, but it is also the bounce rate. Current first
load is ~600 KB gzipped of JS.

- The engine must stay behind `React.lazy` / dynamic import. If a change makes
  the entry statically import `three`, the split is broken — check the build
  output chunk list, not just that it compiled.
- `canvas-record` / `h264-mp4-encoder` (video export) and `three-gpu-pathtracer`
  (beauty shot) must stay in their own dynamic-import-only chunks. They are large
  and most sessions never touch them.
- Three.js resources are cached deliberately (`furnitureTextures.ts` keys its
  cache to bound VRAM). Adding an uncached `new Texture` per render is a leak.
- Run `npm run build` and read the chunk sizes before claiming a perf change.

---

## 9. Verifying visual work

Typecheck and unit tests cannot see a black screen. For anything that changes
rendering, run the real app:

```bash
npm run verify:route -- '/?stage=furnish&seed=1'
npm run verify:smoke
```

Deep links (`?stage=`, `?preset=`, `?listing=`, `?seed=`) skip the wizard.
`docs/verify-harness.md` has the three-line recipe for a custom check. Attach the
screenshot or the render verdict — "it should work" is not verification.

---

## 10. Definition of done

- [ ] Green bar run and actually green (§0)
- [ ] New behaviour has tests; security behaviour definitely has tests
- [ ] Every load-bearing line has a *why* comment (§1)
- [ ] New write path has a resource ceiling (§2)
- [ ] No new personal data in the tree (§5)
- [ ] Follow-up work filed as beads (§6)
- [ ] Visual change verified in the running app (§9)
- [ ] Branch + PR, never a direct push to `main`
