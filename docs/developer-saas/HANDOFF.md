# Agent handoff — developer SaaS research and implementation

Updated 2026-10-01 UTC. Start with this file; the index is [README.md](README.md).

## Fourth implementation checkpoint — 2026-10-01

The user asked three parallel agents to take the next three handoff items. They
implemented an authenticated staff workspace under `/developer`, independently
reviewed source packages in migration 007, and consented buyer enquiries with a
durable outbox in migration 008. The root agent integrated routes and viewer UI,
closed a release-list UUID bug and an auth boot bug found by browser review, and
ran the combined tests. These are implementation slices, not approval to use the
real Embercrest property or real buyer contact data.

`src/developer/DeveloperWorkspace.tsx` lets authorized staff choose an
organization/project/unit type, create units, explicitly import a personal
whole-home design, reserve/upload/review private GLBs and inspect release state.
`server/workspaceRead.js` supplies a tenant-scoped release summary without
private manifest or evidence payloads. Source package submission/review uses
private API routes; there is no staff review screen yet. Release approval now
requires an approved package bound to the exact home revision/hash, replacing
publisher self-attestation for synthetic homes. The real Embercrest fixture
remains blocked. `src/viewer/EnquiryForm.tsx` collects contact and separate
marketing consent for a published release; the backend stores one logical
enquiry plus an outbox intent, with tenant-scoped sales access and deletion.

Migration 007 intentionally makes old self-attested release rows unavailable
through the public GET after rollout, even if they were previously published.
An operator must inventory those links and communicate retirement or re-review
before deploying it. Metadata references in a source package are not proof of
document authenticity; the reviewer must inspect the actual access-controlled
originals outside this API. Migration 008 holds enquiry contact data in the
database; the production pilot still needs a developer-specific privacy notice,
retention schedule and downstream delivery worker before enabling real traffic.
Buyer withdrawal deletes database contact fields but cannot retract information
already sent by a future CRM connector. The browser retains the withdrawal
capability only for its session; later deletion requires developer staff action.

## User intent and scope

The user asked for research and an implementation plan written to Markdown so
another agent can continue efficiently. They confirmed **India, starting with
Embercrest**, with the first paid pilot intended to **sell homes through an
interactive duplex**. They also asked to avoid wasteful research/token usage.
The initial assignment produced specifications. A later user request authorized
four rounds of three implementation tracks. No procurement, outreach,
publication, commit or push was requested or performed.

## Recommendation to carry forward

Build a branded browser sales experience using approved project information,
measured/reviewed furniture, reproducible shared configurations and reliable sales
enquiries. Use licensed existing/manual furniture models first; photo-generated
assets remain drafts until reviewed. A single picture does not establish actual
dimensions or hidden geometry. Compare providers only with the bounded protocol
in [03-furniture-from-photos.md](03-furniture-from-photos.md).

The original audit found that Save persisted only the active room. S02 now snapshots
the whole home in one design record. Its new frontend round-trip test restores all
20 Embercrest rooms, levels, lighting and view state after an in-memory reset.
Scoped organization access has a backend foundation. A second round added
whole-home validation/revisions, a local illustrative GLB and a source-evidence
ledger. A third round added tenant-scoped project homes, private asset versions
and an immutable release foundation. The fourth round added the staff workspace,
reviewed source-package gate and a durable enquiry intake. Original Embercrest
approval, CRM delivery and real-pilot privacy operations remain open.

## Where to resume

After the fourth round, the next three bounded implementation tracks are:

1. **Staff review and sales workflow:** add a source-package review screen and
   release preparation flow in `/developer`, plus a tenant-scoped sales enquiry
   queue. The current source review and sales APIs are only accessible directly.
   Keep source documents private and require a different reviewer.
2. **Buyer choices and durable delivery (S07):** save only allowed furnished-state
   choices against an immutable release, then make the outbox worker retry and
   acknowledge a CRM handoff idempotently. Define retention/deletion propagation
   and a developer-specific contact notice before real buyers submit details.
3. **Pilot operations (S09):** verify approved Embercrest originals and measured
   furniture, real mobile/touch behavior, backup restore, rollback, performance,
   production data isolation and India-specific approved sales copy. Resolve the
   production dependency advisory and the optional lock probe noted below.

Read the relevant packets in [05-implementation-plan.md](05-implementation-plan.md),
the [furniture contract](03-furniture-from-photos.md), and the repository audit.
Do not add photo-generation providers until approved asset ingestion and review
have been proven with a real measured object.

## Implementation checkpoint — 2026-09-29

| Track | Implemented | Remaining before packet acceptance |
| --- | --- | --- |
| S02 whole-home save | Wizard saves all rooms/floors, lighting and view in one existing design record; StartScreen reopens it; legacy room designs still open; dirty state includes inactive-room moves and storage errors surface | Production project ownership model; server validation/revision work is recorded in the second checkpoint below |
| S03 developer access foundation | New server migration and routes for organizations, memberships, projects, unit types and units; membership/role checks on requests, revocation and database-enforced slot ceilings; personal design routes unchanged | Home/asset/job/release/lead/export ownership and cross-tenant tests, migration/runtime role separation and complete production security review |
| S05 local buyer showcase | `/showcase/embercrest` has a read-only 3D view, whole/lower/upper selection, room navigation, 2D plan, reset and responsive mobile layout | Approved release manifest, reviewed source/claims, furnished-state choices, device/touch accessibility and release-grade fallback; no public sales link or lead capture yet |

## Second implementation checkpoint — 2026-09-29

| Track | Implemented | Remaining before packet acceptance |
| --- | --- | --- |
| S01 evidence | `src/data/homes/embercrestEvidence.ts` maps reported plan values, inferred geometry and illustrative staging; validation rejects unsupported claims and publication blockers stay nonempty | Recover original plan/version, rights, jurisdiction and architect/developer sign-off; validate against as-built and approved sales copy |
| S02 save hardening | Migration 003 adds row revisions; whole-home writes require a revision and pass nested/byte limits; cloud editor keeps revision token and reports conflicts without discarding work | Run PostgreSQL-backed tests; production project ownership and migration remain S03 work |
| S04 local GLB slice | Pinned, licensed Khronos sample chair appears in the Embercrest fixture; mesh bounds drive placement; missing or mismatched asset has a labeled procedural fallback | This sample explicitly is not a real product; mesh bounds are not measured physical dimensions. Private ingestion, reviewer approval, immutable storage and exact-product controls remain |

The sample asset attribution and limits are in
[`public/assets/furniture/README.md`](../../public/assets/furniture/README.md).
The source review gate is in [EMBERCREST-EVIDENCE.md](EMBERCREST-EVIDENCE.md).

## Third implementation checkpoint — 2026-09-30

| Track | Implemented | Remaining before production acceptance |
| --- | --- | --- |
| Project homes | Migration 004 and `server/projectHomes.js`: explicit owner-only import from a personal design into a unit type, tenant-scoped reads/writes, live role checks, revision CAS, database-backed project cap; personal source remains private | Staff workspace UI, operational migration/recovery, permission audit and production monitoring |
| Private asset versions | Migration 005 and `server/privateAssets.js`: private bounded GLB ingestion with embedded-resource checks, rights and measured-dimension fields, separate reviewer, immutable approved versions and tenant-scoped delivery | Real customer rights evidence and independently measured product, object-storage operations, malware/content pipeline and production asset review |
| Immutable releases | Migration 006 and `server/releases.js`: approval tied to a home revision, copied allowlisted manifest, published-only reads, pinned public GLB delivery, retire/restore events and `/release/:id` viewer | Independent source/claim verification, Embercrest approvals, real-device buyer QA, lead capture and launch operations |

## Fourth implementation details — 2026-10-01

| Track | Implemented | Remaining before production acceptance |
| --- | --- | --- |
| Staff workspace | Lazy authenticated `/developer` route, organization/project/type/unit selection, deliberate whole-home import, private GLB reserve/upload/review, release inventory; `server/workspaceRead.js` returns only tenant-scoped release summaries | Staff source-review and sales queue UI, editor-to-project save flow, usability and actual operator trials |
| Source approval | Migration 007, `server/sourcePackages.js`, exact home revision/hash binding, separate reviewer, immutable submitted metadata, 100-package project cap; release approval and public reads require approved package | Original documents, custody verification, reviewer workflow UI, legacy-link rollout and real Embercrest sign-offs |
| Enquiries | Migration 008, `server/enquiries.js`, viewer form, explicit contact/marketing consent, idempotent intake, per-IP and database limits, outbox intent, staff role checks, withdrawal/deletion | Developer notice and retention policy, CRM delivery/acknowledgement, deletion propagation, buyer choices and live-pilot QA |

These remain foundations, not a claim that Embercrest is ready for public sales.
The release API explicitly rejects the current `embercrest` prototype marker.
The third checkpoint's publisher attestations were replaced in the fourth
checkpoint by a separate reviewer of source-package metadata. The API still
cannot establish that a referenced original document is authentic or approved;
that is the named reviewer's responsibility outside the API.

The original three tracks were deliberately independent: S02 changed editor
persistence, S03 changed server organization primitives, and S05 used a local
Embercrest fixture. The new `/release/:id` viewer now consumes a published
project-home snapshot. The local `/showcase/embercrest` remains an unreleased
prototype. Do not infer end-to-end SaaS readiness from either viewer.

Original plans, project jurisdiction/registration, branding, rights and developer
approval are not established by this research. `Duplex.pptx` was referenced in
existing code/review but not independently recovered. The current source review
distinguishes 148.57 m² carpet from 173.42 m² including balconies; never revive the
old contradictory carpet label. Use synthetic/private fixtures for work awaiting
approval. Do not invent customer answers, provider quality scores or revenue uplift.

## Workspace and issue tracking

Base HEAD: `63330c7217b2497a2883bb40a3b8dcaceaa8a9bc`.
Branch at research start: `fix/wall-seams-dimension-review`. Many source files and
Embercrest assets already had uncommitted changes. Preserve them; never blanket
stash/reset/clean this checkout. Research changes are `docs/developer-saas/` and
one discoverability link in `docs/agent-orientation.md`. Recheck current status
before choosing a branch/worktree for implementation. The later implementation
added code under `src/` and `server/`; the working tree remains heavily modified.
`CLAUDE.md` is authoritative.

`bd` and `dolt` were unavailable on PATH and not located in the common tool
directories inspected. `.beads/metadata.json` identifies the existing Dolt-server
database. No beads were created/closed and no tracker state was fabricated.
S01–S10 are specification references only. When the tool/database are available:

1. Run `bd ready`, `bd list` and inspect `roomio-pnc` plus referenced launch beads.
   Their live statuses were not verified in this session.
2. Check `bd create --help` and `bd dep --help` for the installed version.
3. Create or reuse an epic titled **Developer SaaS: Embercrest interactive sales
   pilot**. Put the README and implementation-spec paths in its description.
4. Register S01–S10 as linked work, reusing existing launch issues where they match.
   Copy each packet's acceptance criteria and dependencies into its bead; record
   the resulting real IDs in the specification. Record partial S01/S02/S03/S04/S05 work
   and open acceptance gaps without marking those packets complete.
5. Link real prerequisite dependencies, claim the selected work, and maintain task
   status in beads. Do not run `bd init` over the existing database or repoint hooks.

## Verification performed

Local runtime check on 2026-10-01: the app was started at
`http://localhost:5180/` with the API at `http://localhost:5181/`, backed by
an isolated `roomio_dev_test` database migrated through 008. The API health
endpoint and frontend root both returned HTTP 200. A real headless browser rendered
`/showcase/embercrest` with no critical console, page or request errors;
`verify-out/harness/live-embercrest-2026-10-01.png` is the screenshot. A guest
visiting `/developer` saw the authentication screen, as expected. These
processes were left running for local review; future agents should check process
state before assuming the URLs are still live. No new product implementation
was started in this run.

For the fourth checkpoint, root typecheck, 837/837 workspace tests across 81
files, the full PostgreSQL-backed server suite (102/102 across 13 files), lint
(0 errors, 16 pre-existing warnings), production build and `git diff --check`
passed. The size budget passed at 104.7 KiB eager JS / 120 KiB and 1005.7 KiB
total JS / 1100 KiB. New server syntax checks passed. Browser screenshots from
synthetic, intercepted API fixtures are
`verify-out/harness/developer-desktop.png`, `developer-mobile.png`,
`release-enquiry-desktop.png` and `release-enquiry-mobile.png` in the same folder.
Both routes rendered on desktop/mobile without horizontal overflow or page
exceptions; a benign desktop 404 console message was observed. The browser
fixture checks layout and client behavior, while the PostgreSQL suite checks
the real API. No real Embercrest source or buyer PII was used. Real-device touch
and end-to-end deployment tests remain open. A current production-dependency
audit still reports the same moderate transitive `fflate@0.6.10` advisory;
deployment remains gated on resolving and retesting it.

The third implementation checkpoint was verified against a local PostgreSQL 18
test database. The full server suite passed 92/92 tests across 10 files,
including fresh migrations, tenant isolation, revocation, asset approval and
release access. Root typecheck, 832/832 tests across 80 files, lint (0 errors;
16 existing warnings), production build and `git diff --check` passed. The
bundle size check passed: 104.6 KiB eager JS against 120 KiB and 999.1 KiB
total JS against 1100 KiB. A live browser opened a synthetic two-level published
home at `/release/11111111-1111-4111-8111-111111111111` and captured
`verify-out/harness/release-11111111-1111-4111-8111-111111111111.png`.
The page rendered its floors, controls, room links and claim; the harness
reported `render:ok` and no critical page, console or network errors. The
fixture was isolated in a local `roomio_visual` test database, not published.
`npm audit --omit=dev --audit-level=moderate` found one pre-existing moderate
advisory in transitive `three-stdlib` → `fflate@0.6.10` (ZIP64 malformed-input
loop). Resolve and retest this dependency before any public launch.
An additional legacy UI probe, `npm run check:lock`, failed because its
`?stage=furnish&seed=1` click sequence selected no furniture; later assertions
then crashed on the absent selection. The required green-bar suites above pass,
but this probe needs a deterministic seed/selector and a fresh lock interaction
check before relying on it. No bead was filed because `bd`/Dolt are unavailable.

The table below records the original research checkpoint, before the code
tracks. For the second implementation checkpoint, root typecheck, 827/827 tests
across 78 files, build, lint (0 errors; 16 warnings) and size budget passed
(104.5 KiB first-load JS / 120 budget; 996.6 KiB total / 1100 budget).
`node --check` passed for the changed server modules. The new server database
tests could not start because PostgreSQL refused `127.0.0.1:5432`; do not treat
their presence as an executed security verification. The GLB fixture's
hash/embedded-resource/bounds and save/reopen contract are checked in root tests.
The live room screenshot is `verify-out/illustrative-chair-living.png`: the
locally hosted GLB returned HTTP 200, rendered at floor scale, and the browser
reported no page/request errors. That check also exposed a buyer-room bug: the
preview hid all furniture when entering a room. `RoomView` now uses the
read-only `RoomFurniture` path from `HouseView`. The default route harness still
times out waiting for `networkidle0` under WebGL, so direct Chromium navigation
with `domcontentloaded` was used for the render verdict.

For the first implementation checkpoint, root typecheck, 818/818 tests,
build, lint (0 errors; 16 warnings) and size budget passed. The live showcase
rendered on desktop, and its upper-floor plan had no mobile horizontal overflow;
screenshots are `verify-out/embercrest-buyer-desktop.png` and
`verify-out/embercrest-buyer-mobile.png`. `npm test --prefix server` could not start:
PostgreSQL refused `127.0.0.1:5432`, so the new database-backed organization tests
remain unverified here. The default `verify:route` wait for `networkidle0` timed
out under WebGL; the agent used the repository browser harness with a 5-second
settle and checked page/console/request errors. A real phone/touch trial remains.
`verify:smoke` captured five rendered routes, but all were marked failed because
the unavailable PostgreSQL-backed `/api/health` returned HTTP 500. This is an
environment-dependent smoke failure, not a clean smoke pass.

Original research checks ran against the then-existing working tree; those
documents changed no executable application behavior.

| Check | Actual result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | Passed: 73 files, 810 tests across the workspace |
| `npm run build` | Passed; existing large-chunk advisory remains |
| `npm run lint` | Passed: 0 errors, 16 warnings |
| `npm run check:size` | Passed: 102.7 KiB eager JS / 120 budget; 978.1 KiB total / 1100 budget |
| `npm test --prefix server` | Could not start: unresolved `pg` dependency; no server tests executed |
| Visual evidence | Inspected existing `verify-out/builder-all-floors.png`; no new live-browser/device benchmark |
| Research documents | All 9 Markdown files checked for relative links/whitespace; 24 primary-source entries counted |

The original research checkpoint lacked PostgreSQL; the current checkpoint
resolved that by using a local rootless PostgreSQL test instance. Original
command logs are under `/tmp/roomio-developer-research-checks/`; this summary
is the durable record.

No customer interviews, paid generations, mobile trials, production security audit
or legal approval occurred. The 24-source ledger distinguishes official technical/
legal material from vendor claims; prices, versions and terms must be rechecked
when they become actionable. Avoid repeating generic research without a decision
it would change.
