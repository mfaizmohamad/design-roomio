# Roomio — plan to publish

The sequenced version of the beads launch epic (`roomio-pnc`). Beads holds the
detail and the current state; this file holds the ordering and the reasoning.

```bash
bd show roomio-pnc      # the epic
bd ready                # what is unblocked right now
```

---

## The one hard blocker

**`roomio-pnc.1` — the repo ships real people's personal data.**

`public/listings.json` carries 36 scraped Facebook rental posts: 21 with real
phone numbers, all 36 with permalinks to the original post and the full post
text, plus mirrored photos in `public/images/`.

Private repo, local app — fine. Public website — that is republishing strangers'
contact details to anyone with the URL, with no consent and no way for them to
ask us to stop. It is a problem under India's DPDP Act and against Meta's terms
for the source.

Nothing else in this plan matters until it is resolved. The 3D replica work —
which is the genuinely impressive part — does not depend on the listings being
real, so synthetic listings are likely both the safest and the cheapest answer.

---

## Phase 0 — Decide (no code)

Three decisions gate most of the other work.

| Decision | Bead | Why it gates things |
| --- | --- | --- |
| What happens to the listings data | `roomio-pnc.1` | Launch blocker |
| Where this is hosted, and same- vs split-origin | `roomio-pnc.3` | Blocks 6 other beads |
| Whether photo-scan ships at all | `roomio-pnc.2` | It cannot work as built |

On **same- vs split-origin**: serving the API under the SPA's own domain keeps
the `SameSite=Lax` cookie and the new CSRF origin check working with zero
configuration. Split-origin means setting `ALLOWED_ORIGINS` and re-testing the
whole auth flow. Prefer same-origin unless there is a reason not to.

On **photo-scan** (`roomio-pnc.2`): `POST /api/detect` writes uploads to
`shared/requests/` on local disk and polls `shared/results/` for a file that a
separate Python watcher writes. On a container host the filesystem is ephemeral
and the watcher is not deployed, so on launch day this endpoint would accept
uploads and then silently never return a result. Disabling it behind a flag with
an honest "not available" message is the right launch answer; a real queue is the
right answer later.

## Phase 1 — Make it deployable

- `roomio-zhs.4` — real migrations. **Done.** `initDb()` is gone; the schema is
  `server/migrations/*.sql`, applied by a ~120-line runner with no new
  dependency. Two consequences for the deploy:
    - **`npm run migrate` (in `server/`) is now a deploy step**, and it must run
      and succeed *before* the new app process starts. The app refuses to boot
      against a schema that is behind the code, so a forgotten migrate fails the
      deploy loudly instead of 500ing every request.
    - Set `MIGRATION_DATABASE_URL` to a role with DDL rights and leave
      `DATABASE_URL` on a role with **DML only** (`SELECT/INSERT/UPDATE/DELETE`,
      including on `schema_migrations`, which the boot check reads). That split
      is the point of the ticket: with DDL on the app role, one SQL injection
      anywhere in the API is a `DROP TABLE`. Unset, it falls back to
      `DATABASE_URL`, which is what local dev wants.
  Existing databases are adopted, not rebuilt: migration `001` is the old
  `initDb()` DDL verbatim, so applying it to a database the old boot path created
  adds only the `schema_migrations` tracking table.
- `roomio-pnc.4` — build/deploy pipeline with a rollback. Must invoke the
  migrate step; note that rollback is **code-only** — a `001`-era database is
  compatible with both, but a future migration will need its own down-path plan.
- `roomio-pnc.5` — production env vars. The ones whose defaults are only safe on
  localhost: `NODE_ENV=production`, `PGSSLMODE=require`, `TRUST_PROXY=1`.
  `TRUST_PROXY` deserves care — too low breaks per-IP rate limiting, too high
  lets a client forge its own IP past the limiters.

## Phase 2 — Make it safe to leave running

- `roomio-pnc.7` — error tracking and uptime. Today a production error goes to a
  log nobody reads. WebGL context loss on unfamiliar GPUs is the likely top
  crash and we currently have no way to see it happen.
- `roomio-pnc.10` — backups, **and an actual restore test**. An untested backup
  is not a backup.
- `roomio-xfk.1` — `npm audit` + secret scanning in CI. The current advisories
  were found by hand; nothing would have surfaced them automatically.
- `roomio-pnc.6` — privacy policy, terms, takedown contact. Note there is no
  "delete my account" path in the product yet.

## Phase 3 — Make it good for a stranger

- `roomio-pnc.8` — the first 30 seconds. A cold visitor has no account and no
  idea the 3D features exist. The deep links (`?stage=`, `?preset=`, `?listing=`)
  are excellent demo material and are currently undiscoverable.
- `roomio-pnc.9` — phones and low-end GPUs. ~600 KB gzipped of JS before the
  engine loads, on an India-first audience that will mostly arrive on mobile.
  Check whether the unmerged `fix/responsive-mobile` branch still applies.
- `roomio-pnc.11` / `roomio-pnc.12` — load test and cost guardrails.

---

## Already done

Schema migrations (`roomio-zhs.4`), described in Phase 1 above.

Landed on `chore/beads-tooling-and-hardening`, recorded in `roomio-xfk.8`:
trust-proxy config, helmet headers, CSRF origin guard, global rate limit,
per-user design quota, password bounds, bcrypt cost 12, Postgres TLS, pool
bounds, graceful shutdown, and removal of the `dangerouslySetInnerHTML` sink —
with 16 tests pinning all of it.

## Deliberately not blocking launch

`roomio-xfk.3` (Express 5), `roomio-xfk.2` (vitest major — critical advisory but
dev-only), `roomio-xfk.5` (email verification), `roomio-xfk.4` (native bcrypt),
`roomio-zhs.5` (dissolving the island layout). Each is real work with a real
reason to wait; see the bead.
